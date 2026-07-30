import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildServer, loadConfig } from "../src/server.js";

function testConfig() {
  return {
    host: "127.0.0.1",
    port: 3000,
    maxFileSizeMb: 1,
    hybrid: "off",
    hybridMode: "full",
    hybridUrl: "http://127.0.0.1:5002",
    hybridTimeout: "0",
    dataDirectory: mkdtempSync(join(tmpdir(), "odl-pdf-api-test-")),
  };
}

test("konfigurasi default memakai hybrid auto untuk CPU-balanced", () => {
  const previousMode = process.env.ODL_HYBRID_MODE;
  delete process.env.ODL_HYBRID_MODE;

  try {
    assert.equal(loadConfig().hybridMode, "auto");
  } finally {
    if (previousMode === undefined) {
      delete process.env.ODL_HYBRID_MODE;
    } else {
      process.env.ODL_HYBRID_MODE = previousMode;
    }
  }
});

function multipartPdf(
  fieldName = "file",
  content = "%PDF-1.7\ntest",
  filename = "test.pdf",
) {
  const boundary = "----odl-pdf-test";
  const body = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"`,
      "Content-Type: application/pdf",
      "",
      content,
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  );

  return {
    payload: body,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length),
    },
  };
}

test("dashboard dan health endpoint tersedia", async (t) => {
  const app = await buildServer({ config: testConfig() });
  t.after(() => app.close());

  const [page, health] = await Promise.all([
    app.inject({ method: "GET", url: "/" }),
    app.inject({ method: "GET", url: "/health" }),
  ]);

  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"], /^text\/html/);
  assert.match(page.body, /PDF siap untuk AI\./);
  assert.match(page.body, /Fetch Data/);
  assert.match(page.body, /data-result-tab="pdf"/);
  assert.match(page.body, /data-result-tab="metadata"/);
  assert.match(page.body, /data-result-tab="markdown"/);
  assert.match(page.body, /DELETE · HAPUS DATA/);
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), {
    status: "ok",
    mode: "local",
    hybridReady: true,
    queue: { queued: 0, processing: 0, completed: 0, failed: 0 },
  });
});

test("job background dapat diunggah, dibaca sebagai Markdown, lalu dihapus", async (t) => {
  const app = await buildServer({
    config: testConfig(),
    extractor: async () => "# Hasil OCR",
  });
  t.after(() => app.close());

  const upload = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    ...multipartPdf(),
  });
  assert.equal(upload.statusCode, 202);
  const jobId = upload.json().job.id;
  assert.equal(upload.headers.location, `/v1/jobs/${jobId}`);
  assert.equal(upload.json().job.jobUrl, `/v1/jobs/${jobId}`);
  assert.equal(upload.json().job.pdfUrl, `/v1/jobs/${jobId}/pdf`);

  await app.jobs.waitForIdle();
  const list = await app.inject({ method: "GET", url: "/v1/jobs" });
  assert.equal(list.json().jobs[0].status, "completed");
  assert.equal(
    list.json().jobs[0].markdownUrl,
    `/v1/jobs/${jobId}/markdown`,
  );

  const pdf = await app.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}/pdf?download=1`,
  });
  assert.equal(pdf.statusCode, 200);
  assert.match(pdf.headers["content-type"], /^application\/pdf/);
  assert.match(pdf.headers["content-disposition"], /attachment/);
  assert.match(pdf.body, /^%PDF-1\.7/);

  const markdown = await app.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}/markdown`,
  });
  assert.equal(markdown.statusCode, 200);
  assert.match(markdown.headers["content-type"], /^text\/markdown/);
  assert.equal(markdown.body, "# Hasil OCR");

  const removed = await app.inject({
    method: "DELETE",
    url: `/v1/jobs/${jobId}`,
  });
  assert.equal(removed.statusCode, 204);

  const missing = await app.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}`,
  });
  assert.equal(missing.statusCode, 404);
});

test("semua job menggunakan satu worker secara berurutan", async (t) => {
  let active = 0;
  let maximumActive = 0;
  const app = await buildServer({
    config: testConfig(),
    extractor: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      active -= 1;
      return "# Selesai";
    },
  });
  t.after(() => app.close());

  await Promise.all([
    app.inject({
      method: "POST",
      url: "/v1/jobs",
      ...multipartPdf("file", "%PDF-1.7\none", "one.pdf"),
    }),
    app.inject({
      method: "POST",
      url: "/v1/jobs",
      ...multipartPdf("file", "%PDF-1.7\ntwo", "two.pdf"),
    }),
  ]);

  await app.jobs.waitForIdle();
  assert.equal(maximumActive, 1);
  assert.equal(app.jobs.stats().completed, 2);
});

test("endpoint sinkron lama tetap mengembalikan Markdown dan membersihkan job", async (t) => {
  let storedPath;
  const app = await buildServer({
    config: testConfig(),
    extractor: async (path) => {
      storedPath = path;
      assert.equal(existsSync(path), true);
      return "# Hasil OCR";
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/extract/markdown",
    ...multipartPdf(),
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /^text\/markdown/);
  assert.equal(response.body, "# Hasil OCR");
  assert.equal(existsSync(storedPath), false);
  assert.equal(app.jobs.list().length, 0);
});

test("field upload selain 'file' ditolak", async (t) => {
  const app = await buildServer({ config: testConfig() });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    ...multipartPdf("document"),
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /field harus 'file'/);
});

test("file tanpa signature PDF ditolak", async (t) => {
  const app = await buildServer({ config: testConfig() });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    ...multipartPdf("file", "not a pdf"),
  });

  assert.equal(response.statusCode, 415);
  assert.match(response.json().error, /bukan PDF/);
  assert.equal(app.jobs.list().length, 0);
});
