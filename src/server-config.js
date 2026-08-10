import { join, resolve } from "node:path";

import {
  loadApplicationSettings,
  normalizeApplicationSettings,
} from "./application-config.js";

function numberFromEnv(environment, name, fallback) {
  const value = environment[name];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} harus berupa angka positif.`);
  }
  return parsed;
}

function booleanFromEnv(environment, name, fallback) {
  const value = environment[name];
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`${name} harus bernilai true atau false.`);
}

export function loadConfig({ environment = process.env, appConfigFile } = {}) {
  const applicationConfigFile = resolve(
    appConfigFile ??
      environment.APP_CONFIG_FILE ??
      join(import.meta.dirname, "..", "data", "app-config.json"),
  );
  const storedSettings = loadApplicationSettings(applicationConfigFile);
  const storedHybrid = storedSettings.ocrMode === "off" ? "off" : "docling-fast";
  const hybrid = environment.ODL_HYBRID ?? storedHybrid;
  const hybridMode =
    environment.ODL_HYBRID_MODE ??
    (storedSettings.ocrMode === "full" ? "full" : "auto");
  const ocrDevice = environment.ODL_OCR_DEVICE ?? storedSettings.ocrDevice;

  if (!["off", "docling-fast"].includes(hybrid)) {
    throw new Error("ODL_HYBRID harus 'off' atau 'docling-fast'.");
  }
  if (!["auto", "full"].includes(hybridMode)) {
    throw new Error("ODL_HYBRID_MODE harus 'auto' atau 'full'.");
  }
  if (!["cpu", "auto", "cuda", "mps", "xpu"].includes(ocrDevice)) {
    throw new Error("ODL_OCR_DEVICE harus 'cpu', 'auto', 'cuda', 'mps', atau 'xpu'.");
  }
  const environmentOverrides = [
    ["ocrDevice", "ODL_OCR_DEVICE"],
    ["ocrMode", environment.ODL_HYBRID !== undefined ? "ODL_HYBRID" : "ODL_HYBRID_MODE"],
    ["forceOcr", "ODL_FORCE_OCR"],
    ["ocrLanguage", "ODL_OCR_LANG"],
    ["maxFileSizeMb", "ODL_MAX_FILE_SIZE_MB"],
    ["aiTimeoutSeconds", "APP_AI_TIMEOUT_MS"],
    ["sessionHours", "APP_SESSION_HOURS"],
  ]
    .filter(([, variable]) => environment[variable] !== undefined)
    .map(([field, variable]) => ({ field, variable }));
  const effectiveSettings = normalizeApplicationSettings({
    ocrDevice,
    ocrMode: hybrid === "off" ? "off" : hybridMode,
    forceOcr: booleanFromEnv(environment, "ODL_FORCE_OCR", storedSettings.forceOcr),
    ocrLanguage: environment.ODL_OCR_LANG ?? storedSettings.ocrLanguage,
    maxFileSizeMb: numberFromEnv(
      environment,
      "ODL_MAX_FILE_SIZE_MB",
      storedSettings.maxFileSizeMb,
    ),
    aiTimeoutSeconds:
      numberFromEnv(
        environment,
        "APP_AI_TIMEOUT_MS",
        storedSettings.aiTimeoutSeconds * 1000,
      ) / 1000,
    sessionHours: numberFromEnv(
      environment,
      "APP_SESSION_HOURS",
      storedSettings.sessionHours,
    ),
  });
  return {
    host: environment.HOST ?? "127.0.0.1",
    port: numberFromEnv(environment, "PORT", 3000),
    maxFileSizeMb: effectiveSettings.maxFileSizeMb,
    hybrid,
    hybridMode,
    ocrDevice: effectiveSettings.ocrDevice,
    forceOcr: effectiveSettings.forceOcr,
    ocrLanguage: effectiveSettings.ocrLanguage,
    hybridUrl: environment.ODL_HYBRID_URL ?? "http://127.0.0.1:5002",
    hybridTimeout: environment.ODL_HYBRID_TIMEOUT ?? "0",
    authEnabled: true,
    sessionHours: effectiveSettings.sessionHours,
    aiTimeoutMs: effectiveSettings.aiTimeoutSeconds * 1000,
    mfaIssuer: environment.APP_TOTP_ISSUER?.trim() || "PDF2AI",
    mfaAccount: environment.APP_TOTP_ACCOUNT?.trim() || "Dashboard",
    authFile: resolve(
      environment.APP_AUTH_FILE ??
        join(import.meta.dirname, "..", "data", "auth.json"),
    ),
    dataDirectory: resolve(
      environment.ODL_DATA_DIR ??
        join(import.meta.dirname, "..", "data", "jobs"),
    ),
    applicationConfigFile,
    applicationSettings: storedSettings,
    effectiveApplicationSettings: effectiveSettings,
    applicationEnvironmentOverrides: environmentOverrides,
  };
}
