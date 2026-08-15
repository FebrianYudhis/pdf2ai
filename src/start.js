import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import {
  checkHybridHealth,
  loadConfig,
  startServer,
} from "./server.js";
import {
  buildOcrProcessEnvironment,
  resolveOcrLanguage,
} from "./server-config.js";

const root = resolve(import.meta.dirname, "..");
const config = loadConfig();
let ocrProcess = null;
let server = null;
let stopping = false;
let ocrRestartTimer = null;

function sleep(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

async function waitForHybrid(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkHybridHealth(config.hybridUrl, 2_000)) {
      return;
    }
    if (ocrProcess?.exitCode !== null) {
      throw new Error(
        `Backend OCR berhenti dengan exit code ${ocrProcess.exitCode}.`,
      );
    }
    await sleep(1_000);
  }
  throw new Error("Backend OCR belum ready setelah 180 detik.");
}

function startOcrProcess() {
  const python = join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  if (!existsSync(python)) {
    throw new Error(
      "Backend OCR belum di-install. Jalankan: npm.cmd run setup:ocr",
    );
  }

  const url = new URL(config.hybridUrl);
  const ocrEngine = process.env.ODL_OCR_ENGINE ?? "rapidocr";
  const ocrLanguage = resolveOcrLanguage(
    ocrEngine,
    config.ocrLanguage ?? (ocrEngine === "rapidocr" ? "english" : "id,en"),
  );
  const args = [
    join(root, "scripts", "hybrid-server.py"),
    "--host",
    url.hostname,
    "--port",
    url.port || "5002",
    "--ocr-engine",
    ocrEngine,
    "--ocr-lang",
    ocrLanguage,
    "--device",
    config.ocrDevice ?? "cpu",
  ];
  const forceOcr = config.forceOcr ?? false;
  if (forceOcr) {
    args.push("--force-ocr");
  }

  console.log(
    `Menyalakan backend OCR (engine=${ocrEngine}, ` +
      `device=${config.ocrDevice ?? "cpu"}, force=${forceOcr}, ` +
      `bahasa=${ocrLanguage}, hemat-memori=${config.lowMemoryMode === true})...`,
  );
  const child = spawn(python, args, {
    cwd: root,
    env: buildOcrProcessEnvironment(config),
    stdio: "inherit",
    windowsHide: true,
  });
  ocrProcess = child;

  child.on("error", (error) => {
    console.error(`Backend OCR gagal dijalankan: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    if (ocrProcess === child) {
      ocrProcess = null;
    }
    if (stopping) {
      return;
    }

    console.error(
      `Backend OCR berhenti (code=${code ?? "null"}, signal=${signal ?? "none"}). ` +
        "Mencoba menyalakan ulang...",
    );
    if (ocrRestartTimer) {
      clearTimeout(ocrRestartTimer);
    }
    ocrRestartTimer = setTimeout(async () => {
      ocrRestartTimer = null;
      if (stopping || (await checkHybridHealth(config.hybridUrl))) {
        return;
      }
      try {
        startOcrProcess();
        await waitForHybrid();
        console.log("Backend OCR berhasil dinyalakan ulang.");
      } catch (error) {
        console.error(`Restart backend OCR gagal: ${error.message}`);
      }
    }, 2_000);
  });
}

async function shutdown(signal) {
  if (stopping) {
    return;
  }
  stopping = true;
  console.log(`\nMenerima ${signal}, menghentikan server...`);

  if (ocrRestartTimer) {
    clearTimeout(ocrRestartTimer);
    ocrRestartTimer = null;
  }
  await server?.close();
  if (ocrProcess && ocrProcess.exitCode === null) {
    ocrProcess.kill();
  }
}

async function main() {
  config.managedHybrid = true;
  if (
    config.hybrid !== "off" &&
    !(await checkHybridHealth(config.hybridUrl))
  ) {
    startOcrProcess();
    await waitForHybrid();
  } else if (config.hybrid !== "off") {
    console.log(`Backend OCR sudah berjalan di ${config.hybridUrl}.`);
  }

  server = await startServer(config);
  console.log(`Dashboard siap: http://${config.host}:${config.port}`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(signal)
      .then(() => {
        process.exitCode = 0;
      })
      .catch((error) => {
        console.error(`Shutdown gagal: ${error.message}`);
        process.exitCode = 1;
      });
  });
}

main().catch(async (error) => {
  console.error(`Startup gagal: ${error.message}`);
  await shutdown("startup-error");
  process.exitCode = 1;
});
