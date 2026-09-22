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
import { createOcrSupervisor } from "./ocr-supervisor.js";

const root = resolve(import.meta.dirname, "..");
const config = loadConfig();
let server = null;
let stopping = false;

const idleMinutes = Number(config.ocrIdleMinutes ?? 5);
const idleMs =
  config.hybrid !== "off" && Number.isFinite(idleMinutes) && idleMinutes > 0
    ? idleMinutes * 60_000
    : 0;

function resolvePython() {
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
  return python;
}

function spawnOcrProcess() {
  const python = resolvePython();
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
  child.on("error", (error) => {
    console.error(`Backend OCR gagal dijalankan: ${error.message}`);
  });
  return child;
}

const supervisor =
  config.hybrid === "off"
    ? null
    : createOcrSupervisor({
        spawnProcess: spawnOcrProcess,
        checkHealth: () => checkHybridHealth(config.hybridUrl, 2_000),
        idleMs,
        restartOnCrash: idleMs === 0,
      });

async function shutdown(signal) {
  if (stopping) {
    return;
  }
  stopping = true;
  console.log(`\nMenerima ${signal}, menghentikan server...`);

  await server?.close();
  supervisor?.stop();
}

async function main() {
  config.managedHybrid = true;

  if (config.hybrid !== "off") {
    // Gagal cepat kalau virtualenv OCR belum ada, termasuk saat mode on-demand.
    resolvePython();

    if (idleMs > 0) {
      config.hybridOnDemand = true;
      config.ensureOcr = () => supervisor.ensure();
      config.beginOcr = () => supervisor.begin();
      config.endOcr = () => supervisor.end();
      console.log(
        `Backend OCR mode on-demand: dinyalakan saat dipakai, ` +
          `dimatikan setelah ${idleMinutes} menit idle.`,
      );
    } else if (await checkHybridHealth(config.hybridUrl)) {
      console.log(`Backend OCR sudah berjalan di ${config.hybridUrl}.`);
    } else {
      await supervisor.ensure();
    }
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
