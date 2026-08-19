import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export class JobError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function publicJob(job) {
  const {
    id,
    originalName,
    size,
    status,
    createdAt,
    startedAt,
    completedAt,
    error,
    folderId,
  } = job;

  return {
    id,
    originalName,
    size,
    status,
    createdAt,
    startedAt,
    completedAt,
    folderId: folderId ?? null,
    ...(error ? { error } : {}),
  };
}

function validJobId(id) {
  return /^[0-9a-f-]{36}$/i.test(id);
}

export class JobQueue {
  constructor({ dataDirectory, extractor, config, logger = console }) {
    this.dataDirectory = resolve(dataDirectory);
    this.extractor = extractor;
    this.config = config;
    this.logger = logger;
    this.jobs = new Map();
    this.pending = [];
    this.processing = false;
    this.paused = false;
    this.activeJob = null;
    this.idleWaiters = [];
  }

  async init() {
    await mkdir(this.dataDirectory, { recursive: true });

    try {
      const stateContent = await readFile(this.#queueStatePath(), "utf8");
      const state = JSON.parse(stateContent);
      if (typeof state.paused === "boolean") {
        this.paused = state.paused;
      }
    } catch {
      // Abaikan bila file state belum ada atau corrupt
    }

    const entries = await readdir(this.dataDirectory, { withFileTypes: true });
    const recovered = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !validJobId(entry.name)) {
        continue;
      }

      try {
        const metadata = JSON.parse(
          await readFile(this.#metadataPath(entry.name), "utf8"),
        );
        if (metadata.id !== entry.name || !validJobId(metadata.id)) {
          throw new Error("ID metadata tidak cocok dengan direktori job.");
        }
        if (metadata.status === "processing") {
          metadata.status = "queued";
          metadata.startedAt = null;
          metadata.completedAt = null;
          metadata.error = null;
          await this.#persist(metadata);
        }
        this.jobs.set(metadata.id, metadata);
        if (metadata.status === "queued") {
          recovered.push(metadata);
        }
      } catch (error) {
        this.logger.warn?.(
          { err: error, jobId: entry.name },
          "Metadata job tidak dapat dibaca",
        );
      }
    }

    recovered
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .forEach((job) => this.pending.push(job.id));

    this.#schedule();
  }

  async create({ originalName, stream, validate, folderId = null }) {
    const id = randomUUID();
    const directory = this.#jobDirectory(id);
    const inputPath = join(directory, "input.pdf");
    await mkdir(directory, { recursive: false });

    try {
      await pipeline(stream, createWriteStream(inputPath, { flags: "wx" }));
      await validate?.(inputPath, stream);
      const fileStats = await stat(inputPath);
      const job = {
        id,
        originalName: basename(originalName || "document.pdf"),
        size: fileStats.size,
        status: "queued",
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        error: null,
        folderId,
      };

      await this.#persist(job);
      this.jobs.set(id, job);
      this.pending.push(id);
      this.#schedule();
      return publicJob(job);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  list() {
    return [...this.jobs.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(publicJob);
  }

  get(id) {
    return publicJob(this.#require(id));
  }

  async move(id, folderId) {
    const job = this.#require(id);
    const previousFolderId = job.folderId ?? null;
    job.folderId = folderId ?? null;
    try {
      await this.#persist(job);
    } catch (error) {
      job.folderId = previousFolderId;
      throw error;
    }
    return publicJob(job);
  }

  async clearFolder(folderId) {
    const affected = [...this.jobs.values()].filter(
      (job) => job.folderId === folderId,
    );
    for (const job of affected) {
      job.folderId = null;
      await this.#persist(job);
    }
    return affected.length;
  }

  async pause() {
    this.paused = true;
    await this.#persistQueueState();
    return this.stats();
  }

  async resume() {
    this.paused = false;
    await this.#persistQueueState();
    this.#schedule();
    return this.stats();
  }

  async cancel(id) {
    const job = this.#require(id);
    if (job.status === "completed" || job.status === "failed") {
      throw new JobError(
        409,
        `Job dengan status '${job.status}' tidak dapat dibatalkan.`,
      );
    }

    if (job.status === "queued") {
      this.pending = this.pending.filter((pendingId) => pendingId !== id);
      job.status = "failed";
      job.completedAt = new Date().toISOString();
      job.error = "Dibatalkan oleh pengguna.";
      await this.#persist(job);
      return publicJob(job);
    }

    if (job.status === "processing") {
      if (this.activeJob && this.activeJob.id === id) {
        this.activeJob.cancelled = true;
      }
      job.status = "failed";
      job.completedAt = new Date().toISOString();
      job.error = "Dibatalkan oleh pengguna.";
      await this.#persist(job);
      return publicJob(job);
    }

    return publicJob(job);
  }

  stats() {
    const counts = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };

    for (const job of this.jobs.values()) {
      if (Object.hasOwn(counts, job.status)) {
        counts[job.status] += 1;
      }
    }

    return {
      ...counts,
      paused: this.paused,
    };
  }

  async markdown(id) {
    const job = this.#require(id);
    if (job.status !== "completed") {
      throw new JobError(
        409,
        `Markdown belum tersedia karena status job masih '${job.status}'.`,
      );
    }
    return readFile(this.#resultPath(id), "utf8");
  }

  pdf(id) {
    this.#require(id);
    return createReadStream(join(this.#jobDirectory(id), "input.pdf"));
  }

  async delete(id) {
    const job = this.#require(id);
    if (!TERMINAL_STATUSES.has(job.status)) {
      throw new JobError(
        409,
        "Job yang masih antre atau sedang diproses tidak dapat dihapus.",
      );
    }

    const directory = this.#jobDirectory(id);
    await rm(directory, { recursive: true, force: true });
    this.jobs.delete(id);
  }

  async waitForIdle() {
    if (!this.processing && (this.paused || this.pending.length === 0)) {
      return;
    }
    await new Promise((resolvePromise) => {
      this.idleWaiters.push(resolvePromise);
    });
  }

  #require(id) {
    if (!validJobId(id)) {
      throw new JobError(404, "Job tidak ditemukan.");
    }
    const job = this.jobs.get(id);
    if (!job) {
      throw new JobError(404, "Job tidak ditemukan.");
    }
    return job;
  }

  #jobDirectory(id) {
    const directory = resolve(this.dataDirectory, id);
    if (!directory.startsWith(`${this.dataDirectory}${sep}`)) {
      throw new JobError(400, "ID job tidak valid.");
    }
    return directory;
  }

  #queueStatePath() {
    return join(this.dataDirectory, ".queue-state.json");
  }

  async #persistQueueState() {
    const target = this.#queueStatePath();
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify({ paused: this.paused }, null, 2)}\n`,
      "utf8",
    );
    await rm(target, { force: true });
    await rename(temporary, target);
  }

  #metadataPath(id) {
    return join(this.#jobDirectory(id), "metadata.json");
  }

  #resultPath(id) {
    return join(this.#jobDirectory(id), "result.md");
  }

  async #persist(job) {
    const target = this.#metadataPath(job.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, "utf8");
    await rm(target, { force: true });
    await rename(temporary, target);
  }

  #schedule() {
    if (this.paused || this.processing || this.pending.length === 0) {
      return;
    }

    queueMicrotask(() => {
      this.#drain().catch((error) => {
        this.logger.error?.({ err: error }, "Worker antrean berhenti");
      });
    });
  }

  async #drain() {
    if (this.processing || this.paused) {
      return;
    }
    this.processing = true;

    try {
      while (this.pending.length > 0) {
        if (this.paused) {
          break;
        }

        const id = this.pending.shift();
        const job = this.jobs.get(id);
        if (!job || job.status !== "queued") {
          continue;
        }

        this.activeJob = { id, cancelled: false };
        job.status = "processing";
        job.startedAt = new Date().toISOString();
        job.completedAt = null;
        job.error = null;
        await this.#persist(job);

        try {
          const markdown = await this.extractor(
            join(this.#jobDirectory(id), "input.pdf"),
            this.config,
          );

          if (this.activeJob?.cancelled) {
            job.status = "failed";
            job.completedAt = new Date().toISOString();
            job.error = "Dibatalkan oleh pengguna.";
            await this.#persist(job);
          } else {
            await writeFile(this.#resultPath(id), markdown, "utf8");
            job.status = "completed";
            job.completedAt = new Date().toISOString();
            await this.#persist(job);
          }
        } catch (error) {
          if (this.activeJob?.cancelled) {
            job.status = "failed";
            job.completedAt = new Date().toISOString();
            job.error = "Dibatalkan oleh pengguna.";
            await this.#persist(job);
          } else {
            job.status = "failed";
            job.completedAt = new Date().toISOString();
            job.error = error?.message || "Ekstraksi PDF gagal.";
            await this.#persist(job);
            this.logger.error?.(
              { err: error, jobId: id },
              "Ekstraksi PDF gagal",
            );
          }
        } finally {
          this.activeJob = null;
        }
      }
    } finally {
      this.processing = false;
      const waiters = this.idleWaiters.splice(0);
      waiters.forEach((resolvePromise) => resolvePromise());
      if (!this.paused && this.pending.length > 0) {
        this.#schedule();
      }
    }
  }
}
