import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
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

export function textQuality(text) {
  const characters = [...String(text)].filter(
    (character) => !/\s/u.test(character),
  );
  if (characters.length === 0) {
    return 0;
  }

  const readable = characters.filter((character) =>
    /[\p{L}\p{N}]/u.test(character),
  );
  return readable.length / characters.length;
}

export function plainTextToMarkdown(text) {
  return String(text)
    .split("\f")
    .map((page) =>
      page
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .join("\n")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n---\n\n")
    .concat("\n");
}

export function shouldUseTextFallback(markdown, textLayer) {
  const markdownText = String(markdown).trim();
  const fallbackText = String(textLayer).trim();
  if (fallbackText.length < 40 || textQuality(fallbackText) < 0.62) {
    return false;
  }

  return (
    markdownText.length < 40 ||
    textQuality(markdownText) < 0.55 ||
    textQuality(fallbackText) - textQuality(markdownText) >= 0.18
  );
}

export async function extractTextLayer(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pythonExecutable(), [scriptPath, path], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      rejectPromise(
        new Error(
          stderr.trim() ||
            `Ekstraksi text layer berhenti dengan exit code ${code}.`,
        ),
      );
    });
  });
}
