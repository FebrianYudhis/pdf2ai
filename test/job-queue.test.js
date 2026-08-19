import assert from "node:assert/strict";
import test from "node:test";
import { createReadStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JobQueue } from "../src/job-queue.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "odl-job-test-"));
  const source = join(root, "source.pdf");
  await writeFile(source, "%PDF-1.7\ntest");
  return { root, source };
}

test("job dan hasil Markdown disimpan persisten", async () => {
  const { root, source } = await fixture();
  const queue = new JobQueue({
    dataDirectory: join(root, "jobs"),
    config: {},
    extractor: async () => "# Persisten",
  });
  await queue.init();

  const job = await queue.create({
    originalName: "dokumen.pdf",
    stream: createReadStream(source),
  });
  await queue.waitForIdle();

  assert.equal(queue.get(job.id).status, "completed");
  assert.equal(await queue.markdown(job.id), "# Persisten");

  const restarted = new JobQueue({
    dataDirectory: join(root, "jobs"),
    config: {},
    extractor: async () => {
      throw new Error("Job selesai tidak boleh diproses ulang.");
    },
  });
  await restarted.init();
  assert.equal(restarted.get(job.id).status, "completed");
  assert.equal(await restarted.markdown(job.id), "# Persisten");
});

test("job processing yang terputus dimasukkan kembali ke antrean", async () => {
  const { root } = await fixture();
  const jobsDirectory = join(root, "jobs");
  const id = "12345678-1234-1234-1234-123456789abc";
  const directory = join(jobsDirectory, id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "input.pdf"), "%PDF-1.7\ntest");
  await writeFile(
    join(directory, "metadata.json"),
    JSON.stringify({
      id,
      originalName: "recovery.pdf",
      size: 13,
      status: "processing",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:01:00.000Z",
      completedAt: null,
      error: null,
    }),
  );

  const queue = new JobQueue({
    dataDirectory: jobsDirectory,
    config: {},
    extractor: async (path) => {
      assert.match(await readFile(path, "utf8"), /^%PDF-/);
      return "# Pulih";
    },
  });
  await queue.init();
  await queue.waitForIdle();

  assert.equal(queue.get(id).status, "completed");
  assert.equal(await queue.markdown(id), "# Pulih");
});

test("pause dan resume antrean bekerja serta status paused persisten saat restart", async () => {
  const { root, source } = await fixture();
  const queue = new JobQueue({
    dataDirectory: join(root, "jobs"),
    config: {},
    extractor: async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "# Hasil";
    },
  });
  await queue.init();
  assert.equal(queue.stats().paused, false);

  await queue.pause();
  assert.equal(queue.stats().paused, true);

  const job1 = await queue.create({
    originalName: "doc1.pdf",
    stream: createReadStream(source),
  });
  const job2 = await queue.create({
    originalName: "doc2.pdf",
    stream: createReadStream(source),
  });

  // Karena paused, job tetap 'queued'
  assert.equal(queue.get(job1.id).status, "queued");
  assert.equal(queue.get(job2.id).status, "queued");

  // Restart queue dalam keadaan paused
  const restarted = new JobQueue({
    dataDirectory: join(root, "jobs"),
    config: {},
    extractor: async () => "# Hasil",
  });
  await restarted.init();
  assert.equal(restarted.stats().paused, true);
  assert.equal(restarted.get(job1.id).status, "queued");

  // Resume antrean
  await restarted.resume();
  assert.equal(restarted.stats().paused, false);
  await restarted.waitForIdle();

  assert.equal(restarted.get(job1.id).status, "completed");
  assert.equal(restarted.get(job2.id).status, "completed");
});

test("cancel job queued dan processing mengubah status menjadi failed", async () => {
  const { root, source } = await fixture();
  let proceedProcessing;
  const processingStarted = new Promise((resolve) => {
    proceedProcessing = resolve;
  });

  const queue = new JobQueue({
    dataDirectory: join(root, "jobs"),
    config: {},
    extractor: async () => {
      proceedProcessing();
      await new Promise((r) => setTimeout(r, 50));
      return "# Hasil";
    },
  });
  await queue.init();
  await queue.pause();

  const jobQueued = await queue.create({
    originalName: "queued.pdf",
    stream: createReadStream(source),
  });
  const jobProcessing = await queue.create({
    originalName: "processing.pdf",
    stream: createReadStream(source),
  });

  // Cancel queued job
  const cancelledQueued = await queue.cancel(jobQueued.id);
  assert.equal(cancelledQueued.status, "failed");
  assert.equal(cancelledQueued.error, "Dibatalkan oleh pengguna.");

  // Lanjutkan pemrosesan agar jobProcessing masuk status processing
  await queue.resume();
  await processingStarted;

  const cancelledProcessing = await queue.cancel(jobProcessing.id);
  assert.equal(cancelledProcessing.status, "failed");
  assert.equal(cancelledProcessing.error, "Dibatalkan oleh pengguna.");

  await queue.waitForIdle();
  assert.equal(queue.get(jobProcessing.id).status, "failed");
  assert.equal(queue.get(jobProcessing.id).error, "Dibatalkan oleh pengguna.");
});

