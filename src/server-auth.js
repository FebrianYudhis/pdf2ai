import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { verifySync } from "otplib";

import { normalizeAiBaseUrl } from "./ai.js";

export const SESSION_COOKIE = "pdf2ai_session";

export function parseCookies(header = "") {
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

export function validMfaCode(secret, token) {
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

export function hashApiKey(apiKey) {
  return createHash("sha256").update(String(apiKey)).digest("hex");
}

export function validApiKeyHash(expectedHash, apiKey) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? "")) {
    return false;
  }
  const actual = Buffer.from(hashApiKey(apiKey), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return timingSafeEqual(actual, expected);
}

export function sessionCookie(token, maxAge, secure = false) {
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

export async function loadMfaConfig(path) {
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
  if (config.ai !== undefined) {
    try {
      normalizeAiBaseUrl(config.ai?.baseUrl);
    } catch {
      throw new Error(`Konfigurasi AI tidak valid: ${path}`);
    }
    if (
      typeof config.ai !== "object" ||
      typeof config.ai.token !== "string" ||
      config.ai.token.length > 4096 ||
      !Array.isArray(config.ai.models) ||
      config.ai.models.some(
        (model) => typeof model !== "string" || !model || model.length > 256,
      ) ||
      (config.ai.defaultModel !== undefined &&
        (typeof config.ai.defaultModel !== "string" ||
          !config.ai.models.includes(config.ai.defaultModel))) ||
      !Array.isArray(config.ai.templates) ||
      config.ai.templates.some(
        (template) =>
          typeof template?.id !== "string" ||
          typeof template?.name !== "string" ||
          typeof template?.prompt !== "string",
      ) ||
      typeof config.ai.updatedAt !== "string"
    ) {
      throw new Error(`Konfigurasi AI tidak valid: ${path}`);
    }
  }
  return config;
}

export async function saveMfaConfig(path, config) {
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
