import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export class AiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function normalizeAiBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new AiError(400, "Base URL AI tidak valid.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AiError(400, "Base URL AI harus menggunakan HTTP atau HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AiError(
      400,
      "Base URL AI tidak boleh memuat kredensial, query, atau fragment.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function providerUrl(baseUrl, pathname) {
  return `${normalizeAiBaseUrl(baseUrl)}${pathname}`;
}

function providerHeaders(token, json = false) {
  const headers = { Accept: "application/json" };
  if (json) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function providerError(response) {
  let message = "";
  try {
    const body = await response.json();
    message = body?.error?.message ?? body?.message ?? "";
  } catch {
    // Provider tidak selalu mengembalikan JSON.
  }
  const detail = String(message).replace(/\s+/g, " ").trim().slice(0, 500);
  return detail
    ? `Provider AI menolak request (${response.status}): ${detail}`
    : `Provider AI menolak request (${response.status}).`;
}

async function providerFetch(url, options, timeoutMs) {
  try {
    return await fetch(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      throw new AiError(504, "Provider AI tidak merespons sebelum timeout.");
    }
    throw new AiError(502, `Provider AI tidak dapat dihubungi: ${error.message}`);
  }
}

export async function fetchAiModels({ baseUrl, token = "", timeoutMs = 15_000 }) {
  const response = await providerFetch(
    providerUrl(baseUrl, "/models"),
    { method: "GET", headers: providerHeaders(token) },
    timeoutMs,
  );
  if (!response.ok) {
    throw new AiError(502, await providerError(response));
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new AiError(502, "Response daftar model dari provider bukan JSON valid.");
  }
  const models = [
    ...new Set(
      (Array.isArray(body?.data) ? body.data : [])
        .map((model) => model?.id)
        .filter((id) => typeof id === "string" && id.trim())
        .map((id) => id.trim()),
    ),
  ].sort((left, right) => left.localeCompare(right));
  if (models.length === 0) {
    throw new AiError(502, "Provider AI tidak mengembalikan model yang dapat digunakan.");
  }
  return models;
}

function contentText(content) {
  if (typeof content === "string" && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (typeof part?.text === "string") {
          return part.text;
        }
        if (typeof part?.text?.value === "string") {
          return part.text.value;
        }
        return "";
      })
      .join("")
      .trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function completionContent(body) {
  const content = contentText(body?.choices?.[0]?.message?.content);
  if (content) {
    return content;
  }
  if (typeof body?.choices?.[0]?.text === "string") {
    return body.choices[0].text;
  }
  throw new AiError(502, "Provider AI tidak mengembalikan konten jawaban.");
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseCompletionResponse(text, contentType = "") {
  const normalized = String(text).replace(/^\uFEFF/, "").trim();
  const direct = parseJson(normalized);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct;
  }

  const chunks = [];
  for (const line of normalized.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) {
      continue;
    }
    const candidate = trimmed.startsWith("data:")
      ? trimmed.slice(5).trim()
      : trimmed;
    if (!candidate || candidate === "[DONE]" || !candidate.startsWith("{")) {
      continue;
    }
    const chunk = parseJson(candidate);
    if (chunk && typeof chunk === "object" && !Array.isArray(chunk)) {
      chunks.push(chunk);
    }
  }

  if (chunks.length > 0) {
    const content = chunks
      .map((chunk) => {
        const choice = chunk?.choices?.[0];
        return contentText(choice?.delta?.content) ||
          contentText(choice?.message?.content) ||
          (typeof choice?.text === "string" ? choice.text : "");
      })
      .join("")
      .trim();
    const metadata = [...chunks].reverse().find(
      (chunk) => chunk?.id || chunk?.model || chunk?.usage,
    ) ?? chunks[0];
    const usage = [...chunks].reverse().find((chunk) => chunk?.usage)?.usage;
    return {
      id: metadata?.id,
      model: metadata?.model,
      choices: [{ message: { content } }],
      usage,
    };
  }

  const type = String(contentType).split(";", 1)[0].trim() || "tidak diketahui";
  throw new AiError(
    502,
    `Response jawaban provider tidak sesuai format JSON/SSE OpenAI-compatible (Content-Type: ${type}).`,
  );
}

export async function createAiCompletion({
  baseUrl,
  token = "",
  model,
  prompt,
  markdown,
  timeoutMs = 300_000,
}) {
  const response = await providerFetch(
    providerUrl(baseUrl, "/chat/completions"),
    {
      method: "POST",
      headers: providerHeaders(token, true),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "Anda menganalisis dokumen PDF yang telah dikonversi ke Markdown. " +
              "Jawab hanya berdasarkan dokumen dan instruksi pengguna. " +
              "Jika informasi tidak ada di dokumen, nyatakan dengan jelas.",
          },
          {
            role: "user",
            content: `INSTRUKSI PENGGUNA:\n${prompt}\n\nDOKUMEN MARKDOWN:\n${markdown}`,
          },
        ],
      }),
    },
    timeoutMs,
  );
  if (!response.ok) {
    throw new AiError(502, await providerError(response));
  }

  const body = parseCompletionResponse(
    await response.text(),
    response.headers.get("content-type"),
  );
  return {
    content: completionContent(body),
    providerId: typeof body.id === "string" ? body.id : null,
    providerModel: typeof body.model === "string" ? body.model : model,
    usage:
      body.usage && typeof body.usage === "object" && !Array.isArray(body.usage)
        ? body.usage
        : null,
  };
}

function publicResult(result) {
  return { ...result };
}

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value ?? "",
  );
}

function validResult(result) {
  return (
    result?.version === 1 &&
    validId(result.id) &&
    validId(result.jobId) &&
    typeof result.originalName === "string" &&
    typeof result.model === "string" &&
    typeof result.prompt === "string" &&
    typeof result.content === "string" &&
    typeof result.createdAt === "string"
  );
}

export class AiResultStore {
  constructor({ directory, logger = console }) {
    this.directory = resolve(directory);
    this.logger = logger;
    this.results = new Map();
  }

  async init() {
    await mkdir(this.directory, { recursive: true });
    const entries = await readdir(this.directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      try {
        const result = JSON.parse(
          await readFile(join(this.directory, entry.name), "utf8"),
        );
        if (!validResult(result)) {
          throw new Error("Format hasil AI tidak valid.");
        }
        this.results.set(result.id, result);
      } catch (error) {
        this.logger.warn?.(
          { err: error, file: entry.name },
          "Hasil AI tidak dapat dibaca",
        );
      }
    }
  }

  list(jobId = null) {
    return [...this.results.values()]
      .filter((result) => !jobId || result.jobId === jobId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(publicResult);
  }

  countForJob(jobId) {
    if (!jobId) {
      return 0;
    }
    let count = 0;
    for (const result of this.results.values()) {
      if (result.jobId === jobId) {
        count += 1;
      }
    }
    return count;
  }

  hasForJob(jobId) {
    if (!jobId) {
      return false;
    }
    for (const result of this.results.values()) {
      if (result.jobId === jobId) {
        return true;
      }
    }
    return false;
  }

  get(id) {
    if (!validId(id)) {
      throw new AiError(404, "Hasil AI tidak ditemukan.");
    }
    const result = this.results.get(id);
    if (!result) {
      throw new AiError(404, "Hasil AI tidak ditemukan.");
    }
    return publicResult(result);
  }

  async save({ job, model, templateId = null, prompt, completion }) {
    const result = {
      version: 1,
      id: randomUUID(),
      jobId: job.id,
      originalName: job.originalName,
      model,
      templateId,
      prompt,
      content: completion.content,
      providerId: completion.providerId,
      providerModel: completion.providerModel,
      usage: completion.usage,
      createdAt: new Date().toISOString(),
    };
    const target = join(this.directory, `${result.id}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    this.results.set(result.id, result);
    return publicResult(result);
  }

  async deleteForJob(jobId) {
    const matches = [...this.results.values()].filter(
      (result) => result.jobId === jobId,
    );
    await Promise.all(
      matches.map((result) =>
        rm(join(this.directory, `${result.id}.json`), { force: true }),
      ),
    );
    for (const result of matches) {
      this.results.delete(result.id);
    }
  }
}
