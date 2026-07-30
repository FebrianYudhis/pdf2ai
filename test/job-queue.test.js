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
