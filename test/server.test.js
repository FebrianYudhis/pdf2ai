import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSync } from "otplib";

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
    authEnabled: false,
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

test("konfigurasi TOTP tidak memerlukan APP_PASSWORD", () => {
  const previousPassword = process.env.APP_PASSWORD;
  delete process.env.APP_PASSWORD;

  try {
    const config = loadConfig();
    assert.equal(config.authEnabled, true);
    assert.equal("appPassword" in config, false);
  } finally {
    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
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

  const [page, docs, health] = await Promise.all([
    app.inject({ method: "GET", url: "/" }),
    app.inject({ method: "GET", url: "/docs" }),
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
  assert.equal(docs.statusCode, 200);
  assert.match(docs.headers["content-type"], /^text\/html/);
  assert.match(docs.body, /Integrasikan PDF2AI\./);
  assert.match(docs.body, /X-API-Key/);
  assert.match(docs.body, /\/v1\/jobs/);
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), {
    status: "ok",
    mode: "local",
    hybridReady: true,
    queue: { queued: 0, processing: 0, completed: 0, failed: 0 },
  });
});

test("setup TOTP sekali lalu login hanya memerlukan kode TOTP", async (t) => {
  const config = {
    ...testConfig(),
    authEnabled: true,
    sessionHours: 1,
  };
  config.authFile = join(config.dataDirectory, "auth.json");
  const app = await buildServer({ config });
  t.after(() => app.close());

  const [dashboard, docs, api, setupPage, font, health] = await Promise.all([
    app.inject({
      method: "GET",
      url: "/",
      headers: { accept: "text/html" },
    }),
    app.inject({
      method: "GET",
      url: "/docs",
      headers: { accept: "text/html" },
    }),
    app.inject({ method: "GET", url: "/v1/jobs" }),
    app.inject({ method: "GET", url: "/setup" }),
    app.inject({ method: "GET", url: "/fonts/inter-latin-variable.woff2" }),
    app.inject({ method: "GET", url: "/health" }),
  ]);
  assert.equal(dashboard.statusCode, 302);
  assert.equal(dashboard.headers.location, "/setup");
  assert.equal(docs.statusCode, 302);
  assert.equal(docs.headers.location, "/setup");
  assert.equal(api.statusCode, 401);
  assert.equal(setupPage.statusCode, 200);
  assert.match(setupPage.body, /Aktifkan TOTP/);
  assert.equal(font.statusCode, 200);
  assert.match(font.headers["content-type"], /font\/woff2/);
  assert.equal(health.statusCode, 200);

  const apiKeyManagementWithoutLogin = await app.inject({
    method: "POST",
    url: "/auth/api-key",
  });
  assert.equal(apiKeyManagementWithoutLogin.statusCode, 401);

  const started = await app.inject({
    method: "POST",
    url: "/setup/start",
    payload: {},
  });
  assert.equal(started.statusCode, 200);
  assert.match(started.json().qrCode, /^data:image\/png;base64,/);
  const { secret, setupToken } = started.json();
  const code = generateSync({ secret });
  const wrongCode = code === "000000" ? "000001" : "000000";

  const invalidConfirmation = await app.inject({
    method: "POST",
    url: "/setup/confirm",
    payload: { setupToken, code: wrongCode },
  });
  assert.equal(invalidConfirmation.statusCode, 401);

  const confirmed = await app.inject({
    method: "POST",
    url: "/setup/confirm",
    payload: { setupToken, code },
  });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(existsSync(config.authFile), true);
  assert.match(confirmed.headers["set-cookie"], /HttpOnly/);
  assert.match(confirmed.headers["set-cookie"], /SameSite=Strict/);
  const cookie = confirmed.headers["set-cookie"].split(";", 1)[0];

  const authenticated = await app.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { cookie },
  });
  assert.equal(authenticated.statusCode, 200);

  const authenticatedDocs = await app.inject({
    method: "GET",
    url: "/docs",
    headers: { cookie },
  });
  assert.equal(authenticatedDocs.statusCode, 200);
  assert.match(authenticatedDocs.body, /API Documentation/);

  const initialApiKeyStatus = await app.inject({
    method: "GET",
    url: "/auth/api-key",
    headers: { cookie },
  });
  assert.deepEqual(initialApiKeyStatus.json(), {
    configured: false,
    prefix: null,
    createdAt: null,
  });

  const generated = await app.inject({
    method: "POST",
    url: "/auth/api-key",
    headers: { cookie },
  });
  assert.equal(generated.statusCode, 201);
  const firstApiKey = generated.json().apiKey;
  assert.match(firstApiKey, /^p2ai_[A-Za-z0-9_-]{40,}$/);
  assert.equal(readFileSync(config.authFile, "utf8").includes(firstApiKey), false);

  const externalWithKey = await app.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { "x-api-key": firstApiKey },
  });
  assert.equal(externalWithKey.statusCode, 200);

  const rotated = await app.inject({
    method: "POST",
    url: "/auth/api-key",
    headers: { cookie },
  });
  const secondApiKey = rotated.json().apiKey;
  assert.notEqual(secondApiKey, firstApiKey);

  const oldApiKey = await app.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { "x-api-key": firstApiKey },
  });
  assert.equal(oldApiKey.statusCode, 401);

  const currentApiKey = await app.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { "x-api-key": secondApiKey },
  });
  assert.equal(currentApiKey.statusCode, 200);

  const reloadedWithApiKey = await buildServer({ config });
  const persistedApiKey = await reloadedWithApiKey.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { "x-api-key": secondApiKey },
  });
  assert.equal(persistedApiKey.statusCode, 200);
  await reloadedWithApiKey.close();

  const logout = await app.inject({
    method: "POST",
    url: "/logout",
    headers: { cookie },
  });
  assert.equal(logout.statusCode, 204);
  assert.match(logout.headers["set-cookie"], /Max-Age=0/);

  const expired = await app.inject({
    method: "GET",
    url: "/",
    headers: { cookie, accept: "text/html" },
  });
  assert.equal(expired.statusCode, 302);
  assert.equal(expired.headers.location, "/login");

  const missingCode = await app.inject({
    method: "POST",
    url: "/login",
    payload: {},
  });
  assert.equal(missingCode.statusCode, 400);

  const invalidLogin = await app.inject({
    method: "POST",
    url: "/login",
    payload: { code: wrongCode },
  });
  assert.equal(invalidLogin.statusCode, 401);

  const accepted = await app.inject({
    method: "POST",
    url: "/login",
    payload: { code },
  });
  assert.equal(accepted.statusCode, 200);

  const revoked = await app.inject({
    method: "DELETE",
    url: "/auth/api-key",
    headers: { cookie: accepted.headers["set-cookie"].split(";", 1)[0] },
  });
  assert.equal(revoked.statusCode, 204);

  const apiWithoutKey = await app.inject({
    method: "GET",
    url: "/v1/jobs",
  });
  assert.equal(apiWithoutKey.statusCode, 401);

  const restarted = await buildServer({ config });
  t.after(() => restarted.close());
  const loginAfterRestart = await restarted.inject({
    method: "GET",
    url: "/login",
  });
  assert.equal(loginAfterRestart.statusCode, 200);
  assert.match(loginAfterRestart.body, /Kode TOTP/);
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

test("endpoint sinkron sudah tidak tersedia", async (t) => {
  const app = await buildServer({ config: testConfig() });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/extract/markdown",
    ...multipartPdf(),
  });

  assert.equal(response.statusCode, 404);
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
