import { spawn } from "node:child_process";
import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scriptPath = join(root, "scripts", "extract-text-layer.py");

function pythonExecutable() {
  if (process.env.PYTHON) {
    return process.env.PYTHON;
  }

  const virtualEnvironmentPython = join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  return existsSync(virtualEnvironmentPython)
    ? virtualEnvironmentPython
    : process.platform === "win32"
      ? "python"
      : "python3";
}

export function parsePageRange(rangeStr, totalPages = null) {
  if (!rangeStr || typeof rangeStr !== "string" || !rangeStr.trim()) {
    throw new Error("Rentang halaman tidak boleh kosong.");
  }

  const cleaned = rangeStr.trim();
  if (!/^[0-9\s,\-]+$/.test(cleaned)) {
    throw new Error(
      `Format rentang halaman tidak valid: '${rangeStr}'. Gunakan format seperti '1-5, 8, 11-14'.`,
    );
  }

  const rawParts = cleaned.split(",");
  if (rawParts.some((p) => !p.trim())) {
    throw new Error(`Format rentang halaman tidak valid: '${rangeStr}'. Bagian halaman tidak boleh kosong.`);
  }

  const parts = rawParts.map((p) => p.trim());
  if (parts.length === 0) {
    throw new Error("Rentang halaman tidak valid.");
  }


  const pagesSet = new Set();

  for (const part of parts) {
    if (part.includes("-")) {
      const segments = part.split("-");
      if (segments.length !== 2) {
        throw new Error(`Format bagian rentang tidak valid: '${part}'.`);
      }
      const start = Number.parseInt(segments[0].trim(), 10);
      const end = Number.parseInt(segments[1].trim(), 10);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
        throw new Error(`Nomor halaman harus berupa bilangan bulat positif: '${part}'.`);
      }
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      for (let p = min; p <= max; p++) {
        if (totalPages === null || p <= totalPages) {
          pagesSet.add(p);
        }
      }
    } else {
      const p = Number.parseInt(part, 10);
      if (!Number.isInteger(p) || p < 1) {
        throw new Error(`Nomor halaman harus berupa bilangan bulat positif: '${part}'.`);
      }
      if (totalPages === null || p <= totalPages) {
        pagesSet.add(p);
      }
    }
  }

  const sorted = [...pagesSet].sort((a, b) => a - b);
  if (sorted.length === 0) {
    throw new Error("Tidak ada halaman dalam rentang dokumen yang valid.");
  }

  return sorted;
}

export function formatPageRange(pageNumbers) {
  if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) {
    return "";
  }

  const uniqueSorted = [...new Set(pageNumbers)].sort((a, b) => a - b);
  const ranges = [];
  let rangeStart = uniqueSorted[0];
  let prev = uniqueSorted[0];

  for (let i = 1; i < uniqueSorted.length; i++) {
    const curr = uniqueSorted[i];
    if (curr === prev + 1) {
      prev = curr;
    } else {
      ranges.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
      rangeStart = curr;
      prev = curr;
    }
  }
  ranges.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);

  return ranges.join(",");
}

export async function getPdfTotalPages(pdfPath) {
  return new Promise((resolvePromise) => {
    try {
      const child = spawn(pythonExecutable(), [scriptPath, pdfPath, "--count"], {
        cwd: root,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });

      child.on("error", () => {
        resolvePromise(fastFallbackPdfPageCount(pdfPath));
      });

      child.on("close", (code) => {
        if (code === 0) {
          const count = Number.parseInt(stdout.trim(), 10);
          if (Number.isInteger(count) && count > 0) {
            resolvePromise(count);
            return;
          }
        }
        resolvePromise(fastFallbackPdfPageCount(pdfPath));
      });
    } catch {
      resolvePromise(fastFallbackPdfPageCount(pdfPath));
    }
  });
}

function fastFallbackPdfPageCount(pdfPath) {
  try {
    const fd = openSync(pdfPath, "r");
    const buffer = Buffer.alloc(128 * 1024);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    closeSync(fd);

    const str = buffer.toString("latin1", 0, bytesRead);
    const countMatch = str.match(/\/Count\s+(\d+)/);
    if (countMatch) {
      const count = Number.parseInt(countMatch[1], 10);
      if (Number.isInteger(count) && count > 0) {
        return count;
      }
    }
    const pageMatches = str.match(/\/Type\s*\/Page[^s]/g);
    if (pageMatches && pageMatches.length > 0) {
      return pageMatches.length;
    }
  } catch {
    // fallback
  }
  return 1;
}

export async function resolveJobPages({ pdfPath, pageMode = "all", pages = null }) {
  const normalizedMode = pageMode === "custom" ? "custom" : "all";

  let totalPages = null;
  if (pdfPath && existsSync(pdfPath)) {
    try {
      totalPages = await getPdfTotalPages(pdfPath);
    } catch {
      totalPages = null;
    }
  }

  if (normalizedMode === "custom") {
    if (!pages || typeof pages !== "string" || !pages.trim()) {
      throw new Error("Rentang halaman harus diisi untuk mode custom.");
    }
    const pageNumbers = parsePageRange(pages);
    const extractedPages = formatPageRange(pageNumbers);
    return {
      pageMode: "custom",
      pages: extractedPages,
      extractedPages,
      totalPages,
    };
  }

  return {
    pageMode: "all",
    pages: null,
    extractedPages: null,
    totalPages,
  };
}

