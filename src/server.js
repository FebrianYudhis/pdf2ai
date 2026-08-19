import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import ScalarApiReference from "@scalar/fastify-api-reference";
import Fastify from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateSecret, generateURI } from "otplib";
import QRCode from "qrcode";

import { ensureJava } from "./app.js";
import {
  normalizeApplicationSettings,
  saveApplicationSettings,
} from "./application-config.js";
import {
  AiError,
  AiResultStore,
  createAiCompletion,
  fetchAiModels,
  normalizeAiBaseUrl,
} from "./ai.js";
import { JobError, JobQueue } from "./job-queue.js";
import {
  SESSION_COOKIE,
  hashApiKey,
  loadMfaConfig,
  parseCookies,
  saveMfaConfig,
  sessionCookie,
  validApiKeyHash,
  validMfaCode,
} from "./server-auth.js";
import { loadConfig } from "./server-config.js";
import {
  HttpError,
  markdownFilename,
  pdfFilename,
  serializeAiResult,
  serializeFolder,
  serializeJob,
} from "./server-http.js";
import {
  assertPdfSignature,
  checkHybridHealth,
  extractMarkdown,
} from "./server-ocr.js";
import { FolderError, FolderStore } from "./folder-store.js";
import { openApiOptions } from "./openapi.js";

export { checkHybridHealth, extractMarkdown, loadConfig };

export async function buildServer({
  config = loadConfig(),
  extractor = extractMarkdown,
  hybridHealth = checkHybridHealth,
  aiListModels = fetchAiModels,
  aiComplete = createAiCompletion,
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
  await app.register(swagger, openApiOptions());
  const jobs = new JobQueue({
    dataDirectory,
    extractor,
    config,
    logger: app.log,
  });
  await jobs.init();
  app.decorate("jobs", jobs);
  const folders = new FolderStore({
    path: config.folderFile ?? join(dataDirectory, ".folders.json"),
  });
  await folders.init();
  app.decorate("folders", folders);
  const aiResults = new AiResultStore({
    directory:
      config.aiResultDirectory ?? join(dataDirectory, ".ai-results"),
    logger: app.log,
  });
  await aiResults.init();
  app.decorate("aiResults", aiResults);

  const authEnabled = config.authEnabled !== false;
  const authFile = config.authFile ?? join(dataDirectory, "auth.json");
  const applicationConfigFile =
    config.applicationConfigFile ?? join(dataDirectory, ".app-config.json");
  const activeApplicationSettings = normalizeApplicationSettings(
    config.effectiveApplicationSettings ?? {
      ocrDevice: config.ocrDevice ?? "cpu",
      ocrMode: config.hybrid === "off" ? "off" : config.hybridMode ?? "auto",
      forceOcr: config.forceOcr ?? false,
      lowMemoryMode: config.lowMemoryMode ?? false,
      ocrLanguage: config.ocrLanguage ?? "english",
      maxFileSizeMb: config.maxFileSizeMb ?? 25,
      aiTimeoutSeconds: (config.aiTimeoutMs ?? 300_000) / 1000,
      sessionHours: config.sessionHours ?? 12,
    },
  );
  let applicationSettings = normalizeApplicationSettings(
    config.applicationSettings ?? activeApplicationSettings,
  );
  let mfaConfig = authEnabled ? await loadMfaConfig(authFile) : null;
  const sessionLifetimeSeconds = Math.floor(
    (config.sessionHours ?? 12) * 60 * 60,
  );
  const sessions = new Map();
  const setupTokens = new Map();
  const failedLogins = new Map();
  const publicPaths = new Set([
    "/v1/health",
    "/login",
    "/login.js",
    "/setup",
    "/setup.js",
    "/setup/start",
    "/setup/confirm",
    "/styles.css",
    "/styles-auth.css",
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

  async function requireDashboardSession(request) {
    if (!isAuthenticated(request)) {
      throw new HttpError(
        403,
        "Pembuatan, perubahan nama, dan penghapusan folder hanya tersedia dari dashboard.",
      );
    }
  }

  app.addHook("onRequest", async (request, reply) => {
    if (!authEnabled) {
      return;
    }

    const pathname = request.raw.url.split("?", 1)[0];
    const publicApi =
      pathname === "/v1" ||
      pathname.startsWith("/v1/");
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
      fields: 1,
      parts: 2,
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

  function publicApplicationConfig() {
    const environmentOverrides = config.applicationEnvironmentOverrides ?? [];
    const overriddenFields = new Set(
      environmentOverrides.map((override) => override.field),
    );
    const restartFields = Object.keys(applicationSettings).filter(
      (field) =>
        !overriddenFields.has(field) &&
        applicationSettings[field] !== activeApplicationSettings[field],
    );
    return {
      settings: applicationSettings,
      activeSettings: activeApplicationSettings,
      restartRequired: restartFields.length > 0,
      restartFields,
      environmentOverrides,
    };
  }

  app.get("/auth/app-config", async () => publicApplicationConfig());

  app.put(
    "/auth/app-config",
    {
      schema: {
        body: {
          type: "object",
          required: [
            "ocrDevice",
            "ocrMode",
            "forceOcr",
            "lowMemoryMode",
            "ocrLanguage",
            "maxFileSizeMb",
            "aiTimeoutSeconds",
            "sessionHours",
          ],
          additionalProperties: false,
          properties: {
            ocrDevice: {
              type: "string",
              enum: ["cpu", "auto", "cuda", "mps", "xpu"],
            },
            ocrMode: { type: "string", enum: ["auto", "full", "off"] },
            forceOcr: { type: "boolean" },
            lowMemoryMode: { type: "boolean" },
            ocrLanguage: { type: "string", minLength: 1, maxLength: 64 },
            maxFileSizeMb: { type: "integer", minimum: 1, maximum: 500 },
            aiTimeoutSeconds: { type: "integer", minimum: 1, maximum: 1800 },
            sessionHours: { type: "integer", minimum: 1, maximum: 168 },
          },
        },
      },
    },
    async (request) => {
      applicationSettings = await saveApplicationSettings(
        applicationConfigFile,
        request.body,
      );
      return publicApplicationConfig();
    },
  );

  function publicAiConfig() {
    const ai = mfaConfig?.ai;
    return {
      configured: Boolean(ai?.baseUrl && ai.models.length > 0),
      baseUrl: ai?.baseUrl ?? "",
      hasToken: Boolean(ai?.token),
      tokenHint: ai?.token
        ? `${ai.token.slice(0, 3)}…${ai.token.slice(-4)}`
        : null,
      models: ai?.models ?? [],
      defaultModel: ai?.models?.includes(ai.defaultModel)
        ? ai.defaultModel
        : ai?.models?.[0] ?? null,
      templates: ai?.templates ?? [],
      updatedAt: ai?.updatedAt ?? null,
    };
  }

  function storedTokenFor(baseUrl, providedToken) {
    if (providedToken !== undefined) {
      return String(providedToken).trim();
    }
    return mfaConfig?.ai?.baseUrl === baseUrl
      ? mfaConfig.ai.token
      : "";
  }

  app.get("/auth/ai-config", async () => publicAiConfig());

  app.post(
    "/auth/ai-config/models",
    {
      schema: {
        body: {
          type: "object",
          required: ["baseUrl"],
          additionalProperties: false,
          properties: {
            baseUrl: { type: "string", minLength: 1, maxLength: 2048 },
            token: { type: "string", maxLength: 4096 },
          },
        },
      },
    },
    async (request) => {
      const baseUrl = normalizeAiBaseUrl(request.body.baseUrl);
      const token = storedTokenFor(baseUrl, request.body.token);
      const models = await aiListModels({
        baseUrl,
        token,
        timeoutMs: Math.min(config.aiTimeoutMs ?? 300_000, 30_000),
      });
      return { baseUrl, models };
    },
  );

  app.put(
    "/auth/ai-config",
    {
      schema: {
        body: {
          type: "object",
          required: ["baseUrl", "models", "templates"],
          additionalProperties: false,
          properties: {
            baseUrl: { type: "string", minLength: 1, maxLength: 2048 },
            token: { type: "string", maxLength: 4096 },
            models: {
              type: "array",
              minItems: 1,
              maxItems: 500,
              items: { type: "string", minLength: 1, maxLength: 256 },
            },
            defaultModel: { type: "string", minLength: 1, maxLength: 256 },
            templates: {
              type: "array",
              maxItems: 50,
              items: {
                type: "object",
                required: ["name", "prompt"],
                additionalProperties: false,
                properties: {
                  id: { type: "string", maxLength: 64 },
                  name: { type: "string", minLength: 1, maxLength: 100 },
                  prompt: { type: "string", minLength: 1, maxLength: 20_000 },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      if (!mfaConfig) {
        throw new HttpError(409, "Selesaikan konfigurasi TOTP terlebih dahulu.");
      }
      const baseUrl = normalizeAiBaseUrl(request.body.baseUrl);
      const models = [
        ...new Set(request.body.models.map((model) => model.trim()).filter(Boolean)),
      ];
      if (models.length === 0) {
        throw new HttpError(400, "Import setidaknya satu model AI.");
      }
      const defaultModel = request.body.defaultModel?.trim() || models[0];
      if (!models.includes(defaultModel)) {
        throw new HttpError(400, "Model default harus berasal dari hasil import.");
      }
      const templates = request.body.templates.map((template) => ({
        id: template.id?.trim() || randomUUID(),
        name: template.name.trim(),
        prompt: template.prompt.trim(),
      }));
      if (templates.some((template) => !template.name || !template.prompt)) {
        throw new HttpError(400, "Nama dan isi template tidak boleh kosong.");
      }
      const nextConfig = {
        ...mfaConfig,
        ai: {
          baseUrl,
          token: storedTokenFor(baseUrl, request.body.token),
          models,
          defaultModel,
          templates,
          updatedAt: new Date().toISOString(),
        },
      };
      await saveMfaConfig(authFile, nextConfig);
      mfaConfig = nextConfig;
      return publicAiConfig();
    },
  );

  app.delete("/auth/ai-config", async (_request, reply) => {
    if (!mfaConfig?.ai) {
      return reply.code(204).send();
    }
    const { ai: _removed, ...nextConfig } = mfaConfig;
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

  const sendSimpleDocs = async (_request, reply) =>
    reply.sendFile("docs.html", {
      maxAge: 0,
      immutable: false,
    });

  const sendScalarDocs = async (_request, reply) =>
    reply.sendFile("docs-scalar.html", {
      maxAge: 0,
      immutable: false,
    });

  app.get("/docs", sendSimpleDocs);
  app.get("/docs/", sendSimpleDocs);
  app.get("/docs/simple", (_request, reply) => reply.redirect("/docs"));
  app.get("/docs/scalar", sendScalarDocs);
  app.get("/docs/scalar/", sendScalarDocs);
  app.get("/guide", (_request, reply) => reply.redirect("/docs"));

  app.get("/v1/health", async (_request, reply) => {
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

  app.get("/v1/ai/models", async () => {
    const ai = mfaConfig?.ai;
    const models = ai?.models ?? [];
    return {
      configured: Boolean(ai?.baseUrl && models.length > 0),
      modelsUrl: "/v1/ai/models",
      models,
      defaultModel: models.includes(ai?.defaultModel)
        ? ai.defaultModel
        : models[0] ?? null,
      updatedAt: ai?.updatedAt ?? null,
    };
  });

  function folderCollection() {
    const allJobs = jobs.list();
    const counts = new Map();
    let unfiledCount = 0;
    for (const job of allJobs) {
      if (job.folderId && folders.has(job.folderId)) {
        counts.set(job.folderId, (counts.get(job.folderId) ?? 0) + 1);
      } else {
        unfiledCount += 1;
      }
    }
    return {
      foldersUrl: "/v1/folders",
      folders: folders
        .list()
        .map((folder) => serializeFolder(folder, counts.get(folder.id) ?? 0)),
      unfiledCount,
      totalJobCount: allJobs.length,
    };
  }

  app.get("/v1/folders", async () => folderCollection());

  app.post(
    "/v1/folders",
    {
      preHandler: requireDashboardSession,
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 1, maxLength: 80 } },
        },
      },
    },
    async (request, reply) => {
      const folder = await folders.create(request.body.name);
      const serialized = serializeFolder(folder, 0);
      reply.header("Location", serialized.folderUrl);
      return reply.code(201).send({ folder: serialized });
    },
  );

  app.get("/v1/folders/:id", async (request) => {
    const folder = folders.get(request.params.id);
    const folderJobs = jobs
      .list()
      .filter((job) => job.folderId === folder.id)
      .map((job) => serializeJob(job, folders));
    return {
      folder: serializeFolder(folder, folderJobs.length),
      jobs: folderJobs,
    };
  });

  app.patch(
    "/v1/folders/:id",
    {
      preHandler: requireDashboardSession,
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 1, maxLength: 80 } },
        },
      },
    },
    async (request) => {
      const folder = await folders.rename(request.params.id, request.body.name);
      const count = jobs.list().filter((job) => job.folderId === folder.id).length;
      return { folder: serializeFolder(folder, count) };
    },
  );

  app.delete(
    "/v1/folders/:id",
    { preHandler: requireDashboardSession },
    async (request, reply) => {
      const folder = folders.get(request.params.id);
      await jobs.clearFolder(folder.id);
      await folders.delete(folder.id);
      return reply.code(204).send();
    },
  );

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
    const folderField = upload.fields?.folderId;
    const folderId = folderField?.value ? String(folderField.value) : null;
    if (folderId) {
      try {
        folders.get(folderId);
      } catch (error) {
        upload.file.resume();
        throw error;
      }
    }

    return jobs.create({
      originalName: upload.filename,
      stream: upload.file,
      folderId,
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
    return reply.code(202).send({ job: serializeJob(job, folders) });
  });

  app.post("/v1/queue/pause", async () => {
    const stats = await jobs.pause();
    return { ok: true, paused: true, stats };
  });

  app.post("/v1/queue/resume", async () => {
    const stats = await jobs.resume();
    return { ok: true, paused: false, stats };
  });

  app.get("/v1/jobs", async () => ({
    jobs: jobs.list().map((job) => serializeJob(job, folders)),
    stats: jobs.stats(),
  }));

  app.get("/v1/jobs/:id", async (request) => ({
    job: serializeJob(jobs.get(request.params.id), folders),
  }));

  app.post("/v1/jobs/:id/cancel", async (request) => {
    const job = await jobs.cancel(request.params.id);
    return { job: serializeJob(job, folders) };
  });

  app.patch(
    "/v1/jobs/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["folderId"],
          additionalProperties: false,
          properties: {
            folderId: {
              anyOf: [
                { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
                { type: "null" },
              ],
            },
          },
        },
      },
    },
    async (request) => {
      if (request.body.folderId) {
        folders.get(request.body.folderId);
      }
      const job = await jobs.move(request.params.id, request.body.folderId);
      return { job: serializeJob(job, folders) };
    },
  );

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
    await aiResults.deleteForJob(request.params.id);
    return reply.code(204).send();
  });

  app.get("/v1/jobs/:jobId/ai", async (request) => {
    jobs.get(request.params.jobId);
    const aiResultsUrl = `/v1/jobs/${request.params.jobId}/ai`;
    return {
      jobUrl: `/v1/jobs/${request.params.jobId}`,
      aiResultsUrl,
      results: aiResults.list(request.params.jobId).map(serializeAiResult),
    };
  });

  app.get("/v1/jobs/:jobId/ai/:aiId", async (request) => {
    jobs.get(request.params.jobId);
    const result = aiResults.get(request.params.aiId);
    if (result.jobId !== request.params.jobId) {
      throw new AiError(404, "Hasil AI tidak ditemukan.");
    }
    return { result: serializeAiResult(result) };
  });

  app.post(
    "/v1/jobs/:jobId/ai",
    {
      schema: {
        body: {
          type: "object",
          required: ["model", "message"],
          additionalProperties: false,
          properties: {
            model: { type: "string", minLength: 1, maxLength: 256 },
            message: { type: "string", minLength: 1, maxLength: 20_000 },
            templateId: {
              anyOf: [{ type: "string", maxLength: 64 }, { type: "null" }],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const ai = mfaConfig?.ai;
      if (!ai?.baseUrl || ai.models.length === 0) {
        throw new HttpError(409, "Konfigurasi AI belum diselesaikan.");
      }
      const model = request.body.model.trim();
      if (!ai.models.includes(model)) {
        throw new HttpError(400, "Model belum diimport dalam konfigurasi AI.");
      }
      const prompt = request.body.message.trim();
      if (!prompt) {
        throw new HttpError(400, "Pesan untuk AI tidak boleh kosong.");
      }
      if (
        request.body.templateId &&
        !ai.templates.some((template) => template.id === request.body.templateId)
      ) {
        throw new HttpError(400, "Template AI tidak ditemukan.");
      }

      const job = jobs.get(request.params.jobId);
      const markdown = await jobs.markdown(job.id);
      const completion = await aiComplete({
        baseUrl: ai.baseUrl,
        token: ai.token,
        model,
        prompt,
        markdown,
        timeoutMs: config.aiTimeoutMs ?? 300_000,
      });
      jobs.get(job.id);
      const result = await aiResults.save({
        job,
        model,
        templateId: request.body.templateId ?? null,
        prompt,
        completion,
      });
      const serializedResult = serializeAiResult(result);
      reply.header("Location", serializedResult.resultUrl);
      return reply.code(201).send({ result: serializedResult });
    },
  );

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
      error instanceof AiError ||
      error instanceof FolderError ||
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

  await app.register(ScalarApiReference, {
    routePrefix: "/docs/scalar/reference",
    configuration: {
      pageTitle: "PDF2AI API Reference",
      theme: "purple",
      layout: "modern",
    },
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
