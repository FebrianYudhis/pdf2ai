import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { convert } from "@opendataloader/pdf";
import Fastify from "fastify";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

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
    authEnabled: true,
    sessionHours: numberFromEnv("APP_SESSION_HOURS", 12),
    mfaIssuer: process.env.APP_TOTP_ISSUER?.trim() || "PDF2AI",
    mfaAccount: process.env.APP_TOTP_ACCOUNT?.trim() || "Dashboard",
    authFile: resolve(
      process.env.APP_AUTH_FILE ??
        join(import.meta.dirname, "..", "data", "auth.json"),
    ),
    dataDirectory: resolve(
      process.env.ODL_DATA_DIR ??
        join(import.meta.dirname, "..", "data", "jobs"),
    ),
  };
}

const SESSION_COOKIE = "pdf2ai_session";

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator === -1) {
          return [part, ""];
        }
        const value = part.slice(separator + 1);
        try {
          return [part.slice(0, separator), decodeURIComponent(value)];
        } catch {
          return [part.slice(0, separator), value];
        }
      }),
  );
}

function validMfaCode(secret, token) {
  const normalized = String(token).replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }
  try {
    return verifySync({
      secret,
      token: normalized,
      epochTolerance: 30,
    }).valid;
  } catch {
    return false;
  }
}

function hashApiKey(apiKey) {
  return createHash("sha256").update(String(apiKey)).digest("hex");
}

function validApiKeyHash(expectedHash, apiKey) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? "")) {
    return false;
  }
  const actual = Buffer.from(hashApiKey(apiKey), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return timingSafeEqual(actual, expected);
}

function sessionCookie(token, maxAge, secure = false) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

async function loadMfaConfig(path) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  let config;
  try {
    config = JSON.parse(contents);
  } catch {
    throw new Error(
      `Konfigurasi TOTP rusak atau bukan JSON yang valid: ${path}`,
    );
  }
  if (
    config.version !== 1 ||
    typeof config.secret !== "string" ||
    !/^[A-Z2-7]{16,128}$/.test(config.secret)
  ) {
    throw new Error(`Konfigurasi TOTP tidak valid: ${path}`);
  }
  if (
    config.apiKey !== undefined &&
    (typeof config.apiKey !== "object" ||
      !/^[a-f0-9]{64}$/.test(config.apiKey.hash ?? "") ||
      typeof config.apiKey.prefix !== "string" ||
      typeof config.apiKey.createdAt !== "string")
  ) {
    throw new Error(`Konfigurasi API key tidak valid: ${path}`);
  }
  return config;
}

async function saveMfaConfig(path, config) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
  }
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

  const authEnabled = config.authEnabled !== false;
  const authFile = config.authFile ?? join(dataDirectory, "auth.json");
  let mfaConfig = authEnabled ? await loadMfaConfig(authFile) : null;
  const sessionLifetimeSeconds = Math.floor(
    (config.sessionHours ?? 12) * 60 * 60,
  );
  const sessions = new Map();
  const setupTokens = new Map();
  const failedLogins = new Map();
  const publicPaths = new Set([
    "/health",
    "/login",
    "/login.js",
    "/setup",
    "/setup.js",
    "/setup/start",
    "/setup/confirm",
    "/styles.css",
  ]);

  function removeExpiredSessions() {
    const now = Date.now();
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= now) {
        sessions.delete(token);
      }
    }
  }

  function cookieSession(request) {
    removeExpiredSessions();
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    return token && sessions.has(token) ? token : null;
  }

  function isAuthenticated(request) {
    return !authEnabled || Boolean(cookieSession(request));
  }

  function hasValidApiKey(request) {
    const apiKey = request.headers["x-api-key"];
    return (
      typeof apiKey === "string" &&
      Boolean(mfaConfig?.apiKey) &&
      validApiKeyHash(mfaConfig.apiKey.hash, apiKey)
    );
  }

  app.addHook("onRequest", async (request, reply) => {
    if (!authEnabled) {
      return;
    }

    const pathname = request.raw.url.split("?", 1)[0];
    const publicApi = pathname === "/v1" || pathname.startsWith("/v1/");
    if (publicPaths.has(pathname) || pathname.startsWith("/fonts/")) {
      return;
    }
    if (publicApi) {
      if (isAuthenticated(request) || hasValidApiKey(request)) {
        return;
      }
      return reply.code(401).send({
        error: mfaConfig?.apiKey
          ? "API key tidak valid atau tidak dikirim."
          : "API key belum dibuat dari dashboard.",
      });
    }
    if (isAuthenticated(request)) {
      return;
    }

    if (
      request.method === "GET" &&
      request.headers.accept?.includes("text/html")
    ) {
      return reply.redirect(mfaConfig ? "/login" : "/setup");
    }
    return reply.code(401).send({
      error: mfaConfig
        ? "Silakan masuk dengan kode TOTP."
        : "Selesaikan konfigurasi TOTP terlebih dahulu.",
    });
  });

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

  function rateLimitAttempt(key) {
    const now = Date.now();
    const previous = failedLogins.get(key);
    return previous?.resetAt > now
      ? previous
      : { count: 0, resetAt: now + 5 * 60 * 1000 };
  }

  function rejectLogin(reply, key, attempt, message) {
    attempt.count += 1;
    failedLogins.set(key, attempt);
    return reply.code(401).send({ error: message });
  }

  function createSession(request, reply) {
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, Date.now() + sessionLifetimeSeconds * 1000);
    reply.header(
      "Set-Cookie",
      sessionCookie(
        token,
        sessionLifetimeSeconds,
        request.protocol === "https",
      ),
    );
  }

  function checkRateLimit(reply, attempt) {
    if (attempt.count < 5) {
      return false;
    }
    reply.code(429).send({
      error: "Terlalu banyak percobaan. Coba lagi dalam beberapa menit.",
    });
    return true;
  }

  app.get("/setup", async (_request, reply) => {
    if (!authEnabled || mfaConfig) {
      return reply.redirect(mfaConfig ? "/login" : "/");
    }
    return reply.sendFile("setup.html", {
      maxAge: 0,
      immutable: false,
    });
  });

  app.post(
    "/setup/start",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
    async (request, reply) => {
      if (mfaConfig) {
        return reply.code(409).send({ error: "TOTP sudah dikonfigurasi." });
      }

      const setupToken = randomBytes(32).toString("base64url");
      const secret = generateSecret();
      const uri = generateURI({
        issuer: config.mfaIssuer ?? "PDF2AI",
        label: config.mfaAccount ?? "Dashboard",
        secret,
      });
      const qrCode = await QRCode.toDataURL(uri, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 280,
      });
      setupTokens.clear();
      setupTokens.set(setupToken, {
        secret,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      return reply.send({ setupToken, secret, qrCode });
    },
  );

  app.post(
    "/setup/confirm",
    {
      schema: {
        body: {
          type: "object",
          required: ["setupToken", "code"],
          additionalProperties: false,
          properties: {
            setupToken: { type: "string", minLength: 32, maxLength: 128 },
            code: { type: "string", pattern: "^\\d{6}$" },
          },
        },
      },
    },
    async (request, reply) => {
      if (mfaConfig) {
        return reply.code(409).send({ error: "TOTP sudah dikonfigurasi." });
      }
      const pending = setupTokens.get(request.body.setupToken);
      if (!pending || pending.expiresAt <= Date.now()) {
        setupTokens.delete(request.body.setupToken);
        return reply.code(410).send({
          error: "Sesi konfigurasi kedaluwarsa. Mulai konfigurasi lagi.",
        });
      }

      const key = request.ip;
      const attempt = rateLimitAttempt(key);
      if (checkRateLimit(reply, attempt)) {
        return reply;
      }
      if (!validMfaCode(pending.secret, request.body.code)) {
        return rejectLogin(reply, key, attempt, "Kode TOTP tidak valid.");
      }

      const savedConfig = {
        version: 1,
        secret: pending.secret,
        issuer: config.mfaIssuer ?? "PDF2AI",
        account: config.mfaAccount ?? "Dashboard",
        createdAt: new Date().toISOString(),
      };
      await saveMfaConfig(authFile, savedConfig);
      mfaConfig = savedConfig;
      setupTokens.clear();
      failedLogins.delete(key);
      createSession(request, reply);
      return reply.send({ ok: true });
    },
  );

  app.get("/login", async (request, reply) => {
    if (!mfaConfig) {
      return reply.redirect("/setup");
    }
    if (isAuthenticated(request)) {
      return reply.redirect("/");
    }
    return reply.sendFile("login.html", {
      maxAge: 0,
      immutable: false,
    });
  });

  app.post(
    "/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: {
            code: { type: "string", pattern: "^\\d{6}$" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!mfaConfig) {
        return reply.code(409).send({
          error: "TOTP belum dikonfigurasi. Buka halaman konfigurasi awal.",
        });
      }
      const key = request.ip;
      const attempt = rateLimitAttempt(key);
      if (checkRateLimit(reply, attempt)) {
        return reply;
      }
      if (!validMfaCode(mfaConfig.secret, request.body.code)) {
        return rejectLogin(reply, key, attempt, "Kode TOTP salah.");
      }

      failedLogins.delete(key);
      createSession(request, reply);
      return reply.send({ ok: true });
    },
  );

  app.get("/auth/api-key", async () => ({
    configured: Boolean(mfaConfig?.apiKey),
    prefix: mfaConfig?.apiKey?.prefix ?? null,
    createdAt: mfaConfig?.apiKey?.createdAt ?? null,
  }));

  app.post("/auth/api-key", async (_request, reply) => {
    const apiKey = `p2ai_${randomBytes(32).toString("base64url")}`;
    const apiKeyConfig = {
      hash: hashApiKey(apiKey),
      prefix: apiKey.slice(0, 12),
      createdAt: new Date().toISOString(),
    };
    const nextConfig = { ...mfaConfig, apiKey: apiKeyConfig };
    await saveMfaConfig(authFile, nextConfig);
    mfaConfig = nextConfig;
    return reply.code(201).send({
      apiKey,
      prefix: apiKeyConfig.prefix,
      createdAt: apiKeyConfig.createdAt,
    });
  });

  app.delete("/auth/api-key", async (_request, reply) => {
    if (!mfaConfig?.apiKey) {
      return reply.code(204).send();
    }
    const { apiKey: _removed, ...nextConfig } = mfaConfig;
    await saveMfaConfig(authFile, nextConfig);
    mfaConfig = nextConfig;
    return reply.code(204).send();
  });

  app.post("/logout", async (request, reply) => {
    const token = cookieSession(request);
    if (token) {
      sessions.delete(token);
    }
    reply.header(
      "Set-Cookie",
      sessionCookie("", 0, request.protocol === "https"),
    );
    return reply.code(204).send();
  });

  app.get("/", async (_request, reply) =>
    reply.sendFile("index.html", {
      maxAge: 0,
      immutable: false,
    }),
  );

  app.get("/docs", async (_request, reply) =>
    reply.sendFile("docs.html", {
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
