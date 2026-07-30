import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const python = join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} berhenti dengan exit code ${result.status}.`);
  }
}

function findPythonLauncher() {
  const candidates = [
    ...(process.env.PYTHON
      ? [{ command: process.env.PYTHON, prefix: [] }]
      : []),
    { command: "python3", prefix: [] },
    { command: "python", prefix: [] },
    { command: "py", prefix: ["-3"] },
  ];

  for (const candidate of candidates) {
    const result = spawnSync(
      candidate.command,
      [...candidate.prefix, "--version"],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }

  throw new Error(
    "Python 3 tidak ditemukan. Install Python 3 atau tentukan executable melalui environment variable PYTHON.",
  );
}

try {
  if (!existsSync(python)) {
    console.log("Membuat virtual environment Python untuk OCR...");
    const launcher = findPythonLauncher();
    run(launcher.command, [
      ...launcher.prefix,
      "-m",
      "venv",
      ".venv",
    ]);
  }

  console.log("Memasang dependensi backend OCR...");
  run(python, ["-m", "pip", "install", "-r", "requirements-ocr.txt"]);
  run(python, ["-m", "pip", "check"]);
  console.log("Backend OCR siap.");
} catch (error) {
  console.error(`Setup OCR gagal: ${error.message}`);
  process.exitCode = 1;
}
