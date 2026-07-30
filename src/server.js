import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { convert } from "@opendataloader/pdf";
import Fastify from "fastify";
import { open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ensureJava } from "./app.js";
import { JobError, JobQueue } from "./job-queue.js";
import {
  extractTextLayer,
  plainTextToMarkdown,
  shouldUseTextFallback,
} from "./pdf-text-fallback.js";

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function numberFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} harus berupa angka positif.`);
  }
  return parsed;
}

export function loadConfig() {
  const hybrid = process.env.ODL_HYBRID ?? "docling-fast";
  const hybridMode = process.env.ODL_HYBRID_MODE ?? "auto";

  if (!["off", "docling-fast"].includes(hybrid)) {
    throw new Error("ODL_HYBRID harus 'off' atau 'docling-fast'.");
  }
  if (!["auto", "full"].includes(hybridMode)) {
    throw new Error("ODL_HYBRID_MODE harus 'auto' atau 'full'.");
  }

  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: numberFromEnv("PORT", 3000),
    maxFileSizeMb: numberFromEnv("ODL_MAX_FILE_SIZE_MB", 25),
    hybrid,
    hybridMode,
    hybridUrl: process.env.ODL_HYBRID_URL ?? "http://127.0.0.1:5002",
    hybridTimeout: process.env.ODL_HYBRID_TIMEOUT ?? "0",
    dataDirectory: resolve(
      process.env.ODL_DATA_DIR ??
        join(import.meta.dirname, "..", "data", "jobs"),
    ),
  };
}

export async function checkHybridHealth(baseUrl, timeoutMs = 3_000) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return false;
    }
    const body = await response.json();
    return body.status === "ok";
  } catch {
    return false;
  }
}

async function waitForHybridRecovery(baseUrl, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkHybridHealth(baseUrl, 2_000)) {
      return true;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  return false;
}

async function assertPdfSignature(path) {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 5 || header.toString("ascii") !== "%PDF-") {
      throw new HttpError(415, "File yang dikirim bukan PDF yang valid.");
    }
  } finally {
    await handle.close();
  }
}

export async function extractMarkdown(path, config) {
  ensureJava();

  const convertOnce = (hybridMode) =>
    convert(path, {
      format: "markdown",
      toStdout: true,
      quiet: true,
      imageOutput: "off",
      hybrid: config.hybrid === "off" ? undefined : config.hybrid,
      hybridMode: config.hybrid === "off" ? undefined : hybridMode,
      hybridUrl: config.hybrid === "off" ? undefined : config.hybridUrl,
      hybridTimeout:
        config.hybrid === "off" || config.hybridTimeout === "0"
          ? undefined
          : config.hybridTimeout,
    });
  const runOpenDataLoader = async (hybridMode) => {
    try {
      return await convertOnce(hybridMode);
    } catch (error) {
      const backendStopped =
        config.managedHybrid === true &&
        config.hybrid !== "off" &&
        !(await checkHybridHealth(config.hybridUrl));
      if (
        !backendStopped ||
        !(await waitForHybridRecovery(config.hybridUrl))
      ) {
        throw error;
      }
      return convertOnce(hybridMode);
    }
  };

  let markdown = await runOpenDataLoader(config.hybridMode);
  let textLayer = "";

  try {
    textLayer = await extractTextLayer(path);
    if (shouldUseTextFallback(markdown, textLayer)) {
      return plainTextToMarkdown(textLayer);
    }
  } catch {
    // OCR tetap dapat berjalan jika fallback text layer tidak tersedia.
  }

  if (
    config.hybrid !== "off" &&
    config.hybridMode !== "full" &&
    markdown.trim().length < 40
  ) {
    markdown = await runOpenDataLoader("full");
  }

  if (shouldUseTextFallback(markdown, textLayer)) {
    return plainTextToMarkdown(textLayer);
  }
  if (markdown.trim().length === 0) {
    throw new Error(
      "Tidak ada teks yang dapat diekstrak. Periksa backend OCR dan bahasa dokumen.",
    );
  }

  return markdown;
}

function serializeJob(job) {
  return {
    ...job,
    jobUrl: `/v1/jobs/${job.id}`,
    pdfUrl: `/v1/jobs/${job.id}/pdf`,
    markdownUrl:
      job.status === "completed"
        ? `/v1/jobs/${job.id}/markdown`
        : null,
  };
}

function markdownFilename(originalName) {
  const withoutPdf = originalName.replace(/\.pdf$/i, "");
  return `${withoutPdf || "result"}.md`
    .replace(/["\r\n]/g, "")
    .slice(0, 180);
}

function pdfFilename(originalName) {
  const cleaned = originalName.replace(/["\r\n]/g, "").slice(0, 180);
  if (!cleaned) {
    return "document.pdf";
  }
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

export async function buildServer({
  config = loadConfig(),
  extractor = extractMarkdown,
  hybridHealth = checkHybridHealth,
  dataDirectory =
    config.dataDirectory ??
    join(import.meta.dirname, "..", "data", "jobs"),
} = {}) {
  const maxBytes = Math.floor(config.maxFileSizeMb * 1024 * 1024);
  const app = Fastify({
    logger: true,
    bodyLimit: maxBytes + 1024 * 1024,
    requestTimeout: 0,
  });
  const jobs = new JobQueue({
    dataDirectory,
    extractor,
    config,
    logger: app.log,
  });
  await jobs.init();
  app.decorate("jobs", jobs);

  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 0,
      parts: 1,
      fileSize: maxBytes,
    },
  });

  await app.register(fastifyStatic, {
    root: join(import.meta.dirname, "..", "public"),
    prefix: "/",
    index: false,
  });

  app.get("/", async (_request, reply) =>
    reply.sendFile("index.html", {
      maxAge: 0,
      immutable: false,
    }),
  );

  app.get("/health", async (_request, reply) => {
    const hybridReady =
      config.hybrid === "off"
        ? true
        : await hybridHealth(config.hybridUrl);

    return reply.code(hybridReady ? 200 : 503).send({
      status: hybridReady ? "ok" : "not-ready",
      mode: config.hybrid === "off" ? "local" : "hybrid",
      hybridReady,
      queue: jobs.stats(),
    });
  });

  async function receiveJob(request) {
    const upload = await request.file();
    if (!upload) {
      throw new HttpError(
        400,
        "Kirim satu file PDF pada multipart field bernama 'file'.",
      );
    }
    if (upload.fieldname !== "file") {
      upload.file.resume();
      throw new HttpError(400, "Nama multipart field harus 'file'.");
    }

    return jobs.create({
      originalName: upload.filename,
      stream: upload.file,
      validate: async (path, stream) => {
        if (stream.truncated) {
          throw new HttpError(
            413,
            `Ukuran PDF melebihi ${config.maxFileSizeMb} MB.`,
          );
        }
        await assertPdfSignature(path);
      },
    });
  }

  app.post("/v1/jobs", async (request, reply) => {
    const job = await receiveJob(request);
    reply.header("Location", `/v1/jobs/${job.id}`);
    return reply.code(202).send({ job: serializeJob(job) });
  });

  app.get("/v1/jobs", async () => ({
    jobs: jobs.list().map(serializeJob),
    stats: jobs.stats(),
  }));

  app.get("/v1/jobs/:id", async (request) => ({
    job: serializeJob(jobs.get(request.params.id)),
  }));

  app.get("/v1/jobs/:id/pdf", async (request, reply) => {
    const job = jobs.get(request.params.id);
    const pdf = jobs.pdf(job.id);
    if (request.query?.download === "1") {
      reply.header(
        "Content-Disposition",
        `attachment; filename="${pdfFilename(job.originalName)}"`,
      );
    }
    return reply.type("application/pdf").send(pdf);
  });

  app.get("/v1/jobs/:id/markdown", async (request, reply) => {
    const job = jobs.get(request.params.id);
    const markdown = await jobs.markdown(job.id);
    if (request.query?.download === "1") {
      reply.header(
        "Content-Disposition",
        `attachment; filename="${markdownFilename(job.originalName)}"`,
      );
    }
    return reply.type("text/markdown; charset=utf-8").send(markdown);
  });

  app.delete("/v1/jobs/:id", async (request, reply) => {
    await jobs.delete(request.params.id);
    return reply.code(204).send();
  });

  // Endpoint lama tetap tersedia untuk client yang membutuhkan response sinkron.
  // Pekerjaannya tetap masuk antrean global yang sama agar OCR selalu satu per satu.
  app.post("/v1/extract/markdown", async (request, reply) => {
    const startedAt = Date.now();
    const job = await receiveJob(request);
    let markdown;

    try {
      await jobs.waitForCompletion(job.id);
      markdown = await jobs.markdown(job.id);
    } finally {
      const latest = jobs.get(job.id);
      if (["completed", "failed"].includes(latest.status)) {
        await jobs.delete(job.id);
      }
    }

    reply.header("X-Processing-Time-Ms", String(Date.now() - startedAt));
    return reply.type("text/markdown; charset=utf-8").send(markdown);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.code(413).send({
        error: `Ukuran PDF melebihi ${config.maxFileSizeMb} MB.`,
      });
    }
    if (error.code === "FST_INVALID_MULTIPART_CONTENT_TYPE") {
      return reply.code(415).send({
        error: "Content-Type harus multipart/form-data.",
      });
    }
    if (
      error instanceof HttpError ||
      error instanceof JobError ||
      (error.statusCode && error.statusCode < 500)
    ) {
      return reply.code(error.statusCode).send({ error: error.message });
    }

    request.log.error({ err: error }, "Request gagal");
    return reply.code(error.statusCode ?? 500).send({
      error: "Ekstraksi PDF gagal.",
      requestId: request.id,
    });
  });

  return app;
}

export async function startServer(config = loadConfig()) {
  ensureJava();
  const app = await buildServer({ config });
  await app.listen({ host: config.host, port: config.port });
  return app;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startServer().catch((error) => {
    console.error(`Server gagal dijalankan: ${error.message}`);
    process.exitCode = 1;
  });
}
