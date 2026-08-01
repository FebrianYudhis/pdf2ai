import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DEFAULT_APPLICATION_SETTINGS = Object.freeze({
  ocrDevice: "cpu",
  ocrMode: "auto",
  forceOcr: false,
  ocrLanguage: "english",
  maxFileSizeMb: 25,
  aiTimeoutSeconds: 300,
  sessionHours: 12,
});

const OCR_DEVICES = new Set(["cpu", "auto", "cuda", "mps", "xpu"]);
const OCR_MODES = new Set(["auto", "full", "off"]);

function finiteNumber(value, name, minimum, maximum, integer = false) {
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number < minimum ||
    number > maximum ||
    (integer && !Number.isInteger(number))
  ) {
    throw new Error(`${name} harus bernilai antara ${minimum} dan ${maximum}.`);
  }
  return number;
}

export function normalizeApplicationSettings(input = {}) {
  const settings = { ...DEFAULT_APPLICATION_SETTINGS, ...input };
  if (!OCR_DEVICES.has(settings.ocrDevice)) {
    throw new Error("Perangkat OCR tidak didukung.");
  }
  if (!OCR_MODES.has(settings.ocrMode)) {
    throw new Error("Mode OCR tidak didukung.");
  }
  if (typeof settings.forceOcr !== "boolean") {
    throw new Error("Pilihan paksa OCR harus berupa boolean.");
  }
  const ocrLanguage = String(settings.ocrLanguage ?? "").trim();
  if (!ocrLanguage || ocrLanguage.length > 64) {
    throw new Error("Bahasa OCR harus berisi 1 sampai 64 karakter.");
  }

  return {
    ocrDevice: settings.ocrDevice,
    ocrMode: settings.ocrMode,
    forceOcr: settings.ocrMode === "off" ? false : settings.forceOcr,
    ocrLanguage,
    maxFileSizeMb: finiteNumber(
      settings.maxFileSizeMb,
      "Batas ukuran PDF",
      1,
      500,
      true,
    ),
    aiTimeoutSeconds: finiteNumber(
      settings.aiTimeoutSeconds,
      "Timeout AI",
      1,
      1800,
      true,
    ),
    sessionHours: finiteNumber(
      settings.sessionHours,
      "Durasi sesi",
      1,
      168,
      true,
    ),
  };
}

export function loadApplicationSettings(path) {
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { ...DEFAULT_APPLICATION_SETTINGS };
    }
    throw error;
  }

  try {
    const document = JSON.parse(contents);
    if (document.version !== 1 || typeof document.settings !== "object") {
      throw new Error("format tidak didukung");
    }
    return normalizeApplicationSettings(document.settings);
  } catch (error) {
    throw new Error(`Konfigurasi aplikasi tidak valid: ${path} (${error.message})`);
  }
}

export async function saveApplicationSettings(path, settings) {
  const normalized = normalizeApplicationSettings(settings);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const document = {
    version: 1,
    settings: normalized,
    updatedAt: new Date().toISOString(),
  };
  try {
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
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
  return normalized;
}
