import { convert } from "@opendataloader/pdf";
import { open } from "node:fs/promises";

import { ensureJava } from "./app.js";
import { HttpError } from "./server-http.js";
import {
  extractTextLayer,
  plainTextToMarkdown,
  shouldUseTextFallback,
} from "./pdf-text-fallback.js";

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

export async function assertPdfSignature(path) {
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

export async function extractMarkdown(path, config, options = {}) {
  ensureJava();

  const pages = typeof options === "string" ? options : options?.pages || undefined;

  const convertOnce = (hybridMode) =>
    convert(path, {
      format: "markdown",
      toStdout: true,
      quiet: true,
      imageOutput: "off",
      pages,
      hybrid: config.hybrid === "off" ? undefined : config.hybrid,
      hybridMode: config.hybrid === "off" ? undefined : hybridMode,
      hybridUrl: config.hybrid === "off" ? undefined : config.hybridUrl,
      hybridTimeout:
        config.hybrid === "off" || config.hybridTimeout === "0"
          ? undefined
          : config.hybridTimeout,
    });
  const runOpenDataLoader = async (hybridMode) => {
    // Best-effort: nyalakan backend on-demand sebelum konversi. Kegagalan di
    // sini dibiarkan, karena dokumen ber-text-layer tidak butuh backend.
    await config.ensureOcr?.().catch(() => {});

    // Selama konversi berjalan, idle stop ditahan agar backend tidak dimatikan
    // di tengah job yang panjang.
    config.beginOcr?.();
    try {
      return await convertOnce(hybridMode);
    } catch (error) {
      const backendStopped =
        config.managedHybrid === true &&
        config.hybrid !== "off" &&
        !(await checkHybridHealth(config.hybridUrl));
      if (!backendStopped) {
        throw error;
      }
      await config.ensureOcr?.();
      if (!(await waitForHybridRecovery(config.hybridUrl))) {
        throw error;
      }
      return await convertOnce(hybridMode);
    } finally {
      config.endOcr?.();
    }
  };

  let markdown = await runOpenDataLoader(config.hybridMode);
  let textLayer = "";

  try {
    textLayer = await extractTextLayer(path, { pages });
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

