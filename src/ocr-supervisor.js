const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

export function createOcrSupervisor({
  spawnProcess,
  checkHealth,
  idleMs = 0,
  restartOnCrash = true,
  restartDelayMs = 2_000,
  readyTimeoutMs = 180_000,
  readyPollMs = 1_000,
  log = console,
} = {}) {
  let child = null;
  let idleTimer = null;
  let restartTimer = null;
  let starting = null;
  let intentionalStop = false;
  let stopped = false;
  let active = 0;

  function isRunning() {
    return Boolean(child) && child.exitCode === null;
  }

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function scheduleIdleStop() {
    clearIdleTimer();
    if (!idleMs || stopped || active > 0) {
      return;
    }
    idleTimer = setTimeout(() => {
      void stopIdle();
    }, idleMs);
    idleTimer.unref?.();
  }

  async function stopIdle() {
    idleTimer = null;
    if (!isRunning() || active > 0) {
      return;
    }
    log.log(
      `Backend OCR idle ${Math.round(idleMs / 60_000)} menit, ` +
        "mematikan untuk menghemat memori.",
    );
    intentionalStop = true;
    child.kill();
  }

  function waitForExit(timeoutMs = 5_000) {
    const current = child;
    if (!current || current.exitCode !== null) {
      return Promise.resolve();
    }
    return new Promise((resolvePromise) => {
      const timer = setTimeout(resolvePromise, timeoutMs);
      timer.unref?.();
      current.once("exit", () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  }

  function spawn() {
    child = spawnProcess();
    const current = child;
    current.on("error", () => {
      if (child === current) {
        child = null;
      }
    });
    current.on("exit", (code, signal) => {
      if (child === current) {
        child = null;
      }
      if (stopped) {
        return;
      }
      if (intentionalStop) {
        intentionalStop = false;
        log.log("Backend OCR dimatikan karena idle.");
        return;
      }
      log.error(
        `Backend OCR berhenti (code=${code ?? "null"}, signal=${signal ?? "none"}).`,
      );
      if (restartOnCrash) {
        log.error("Mencoba menyalakan ulang...");
        scheduleRestart();
      }
    });
  }

  function scheduleRestart() {
    if (restartTimer) {
      clearTimeout(restartTimer);
    }
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (stopped || isRunning()) {
        return;
      }
      ensure().then(
        () => log.log("Backend OCR berhasil dinyalakan ulang."),
        (error) => log.error(`Restart backend OCR gagal: ${error.message}`),
      );
    }, restartDelayMs);
    restartTimer.unref?.();
  }

  async function ready(timeoutMs = readyTimeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await checkHealth()) {
        return;
      }
      if (child && child.exitCode !== null) {
        throw new Error(
          `Backend OCR berhenti dengan exit code ${child.exitCode}.`,
        );
      }
      await sleep(readyPollMs);
    }
    throw new Error(
      `Backend OCR belum ready setelah ${Math.round(timeoutMs / 1_000)} detik.`,
    );
  }

  async function start() {
    if (stopped) {
      return;
    }
    if (intentionalStop) {
      await waitForExit();
    }
    if (isRunning()) {
      return;
    }
    spawn();
    await ready();
    scheduleIdleStop();
  }

  function ensure() {
    if (stopped) {
      return Promise.resolve();
    }
    if (starting) {
      return starting;
    }
    // Saat idle stop sedang berjalan, proses masih terlihat hidup sampai
    // benar-benar keluar; jangan lewati start() atau respawn tak akan terjadi.
    if (!intentionalStop && isRunning()) {
      return Promise.resolve();
    }
    starting = start().finally(() => {
      starting = null;
    });
    return starting;
  }

  function begin() {
    active += 1;
    clearIdleTimer();
  }

  function end() {
    active = Math.max(0, active - 1);
    if (active === 0) {
      scheduleIdleStop();
    }
  }

  function stop() {
    stopped = true;
    clearIdleTimer();
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (isRunning()) {
      child.kill();
    }
  }

  return { ensure, begin, end, stop, isRunning };
}
