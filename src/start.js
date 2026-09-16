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
let ocrState = "stopped";
let idleTimer = null;
let ocrWakePromise = null;
const idleTimeoutMs = (config.ocrIdleTimeoutSeconds ?? 180) * 1000;

function sleep(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function getOcrState() {
  return ocrState;
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
  ocrState = "running";

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

    ocrState = "stopped";
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

function waitForProcessExit(proc, timeoutMs = 5000) {
  if (!proc || proc.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

async function stopOcrProcess(targetState = "stopped") {
  if (ocrRestartTimer) {
    clearTimeout(ocrRestartTimer);
    ocrRestartTimer = null;
  }
  ocrState = targetState;
  const proc = ocrProcess;
  if (proc && proc.exitCode === null) {
    proc.kill("SIGTERM");
    await waitForProcessExit(proc, 5_000);
    if (proc.exitCode === null) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Abaikan jika proses sudah keluar
      }
    }
  }
  if (ocrProcess === proc) {
    ocrProcess = null;
  }
}

async function sleepOcr() {
  if (config.hybrid === "off" || stopping) {
    return;
  }
  if (ocrState !== "running" || !ocrProcess) {
    return;
  }
  const minutes = Math.max(1, Math.round(idleTimeoutMs / 60_000));
  console.log(
    `[OCR Manager] Antrean idle selama ${minutes} menit. ` +
      "Meminta backend OCR melepas bobot model (in-process lazy-unload) untuk membebaskan ~3 GB RAM...",
  );
  try {
    const unloadUrl = new URL("/v1/unload", config.hybridUrl);
    const res = await fetch(unloadUrl, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      ocrState = "sleeping";
      console.log(
        "[OCR Manager] Bobot model OCR dilepas dari RAM. Backend tetap siaga (standby) di port 5002.",
      );
    } else {
      ocrState = "sleeping";
    }
  } catch (error) {
    console.warn(
      `[OCR Manager] Gagal mengirim unload request: ${error.message}. Internal timer backend tetap aktif.`,
    );
    ocrState = "sleeping";
  }
}

async function ensureOcrReady() {
  if (config.hybrid === "off" || stopping) {
    return;
  }

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  // Jika proses OCR merespon health check (baik managed maupun external server), langsung siap!
  // Bobot model akan dimuat ulang on-demand oleh backend Python saat /v1/convert dipanggil.
  if ((!ocrProcess || ocrProcess.exitCode === null) && await checkHybridHealth(config.hybridUrl, 1_000)) {
    ocrState = "running";
    return;
  }

  if (ocrWakePromise) {
    return ocrWakePromise;
  }

  ocrWakePromise = (async () => {
    ocrState = "waking";
    console.log(
      "[OCR Manager] Backend OCR tidak berjalan. Menyalakan kembali backend OCR...",
    );
    try {
      startOcrProcess();
      await waitForHybrid();
      ocrState = "running";
      console.log("[OCR Manager] Backend OCR aktif dan siap memproses dokumen.");
    } catch (error) {
      ocrState = "stopped";
      throw error;
    }
  })().finally(() => {
    ocrWakePromise = null;
  });

  return ocrWakePromise;
}

function onQueueActive() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function onQueueIdle() {
  if (config.hybrid === "off" || idleTimeoutMs <= 0 || stopping) {
    return;
  }
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    idleTimer = null;
    sleepOcr().catch((error) => {
      console.error(`Gagal mematikan backend OCR saat idle: ${error.message}`);
    });
  }, idleTimeoutMs);
}

async function shutdown(signal) {
  if (stopping) {
    return;
  }
  stopping = true;
  console.log(`\nMenerima ${signal}, menghentikan server...`);

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (ocrRestartTimer) {
    clearTimeout(ocrRestartTimer);
    ocrRestartTimer = null;
  }
  await server?.close();
  await stopOcrProcess("stopped");
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
    ocrState = "running";
  }

  server = await startServer(config, {
    onQueueActive,
    onQueueIdle,
    ensureOcrReady,
    getOcrState,
  });
  console.log(`Dashboard siap: http://${config.host}:${config.port}`);

  if (config.hybrid !== "off" && idleTimeoutMs > 0) {
    onQueueIdle();
  }
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
