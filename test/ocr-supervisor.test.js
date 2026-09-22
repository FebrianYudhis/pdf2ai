import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createOcrSupervisor } from "../src/ocr-supervisor.js";

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const silentLog = { log() {}, error() {} };

function fakeProcess() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => {
    if (child.killed) {
      return;
    }
    child.killed = true;
    child.exitCode = 0;
    setImmediate(() => child.emit("exit", 0, null));
  };
  return child;
}

function slowExitProcess(delayMs) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => {
    if (child.killed) {
      return;
    }
    child.killed = true;
    setTimeout(() => {
      child.exitCode = 0;
      child.emit("exit", 0, null);
    }, delayMs);
  };
  return child;
}

function createHarness(options = {}) {
  const spawned = [];
  const supervisor = createOcrSupervisor({
    spawnProcess: () => {
      const child = fakeProcess();
      spawned.push(child);
      return child;
    },
    checkHealth: async () => true,
    restartOnCrash: false,
    log: silentLog,
    ...options,
  });
  return { supervisor, spawned };
}

test("mematikan backend setelah idle lalu menyalakannya lagi saat dipakai", async () => {
  const { supervisor, spawned } = createHarness({ idleMs: 40 });

  await supervisor.ensure();
  assert.equal(spawned.length, 1);
  assert.equal(supervisor.isRunning(), true);

  await sleep(120);
  assert.equal(spawned[0].killed, true);
  assert.equal(supervisor.isRunning(), false);

  await supervisor.ensure();
  assert.equal(spawned.length, 2);
  assert.equal(supervisor.isRunning(), true);

  supervisor.stop();
});

test("ensure() bersamaan hanya menyalakan satu proses", async () => {
  const { supervisor, spawned } = createHarness({ idleMs: 40 });

  await Promise.all([
    supervisor.ensure(),
    supervisor.ensure(),
    supervisor.ensure(),
  ]);
  assert.equal(spawned.length, 1);

  supervisor.stop();
});

test("job yang berjalan menunda idle stop sampai selesai", async () => {
  const { supervisor, spawned } = createHarness({ idleMs: 40 });

  await supervisor.ensure();
  supervisor.begin();

  await sleep(120);
  assert.equal(spawned[0].killed, false);
  assert.equal(supervisor.isRunning(), true);

  supervisor.end();
  await sleep(120);
  assert.equal(spawned[0].killed, true);

  supervisor.stop();
});

test("ensure() menunggu proses idle benar-benar mati lalu menyalakan ulang", async () => {
  const spawned = [];
  const supervisor = createOcrSupervisor({
    spawnProcess: () => {
      const child = spawned.length === 0 ? slowExitProcess(40) : fakeProcess();
      spawned.push(child);
      return child;
    },
    checkHealth: async () => true,
    idleMs: 30,
    restartOnCrash: false,
    log: silentLog,
  });

  await supervisor.ensure();
  await sleep(60);
  assert.equal(spawned[0].killed, true);
  assert.equal(supervisor.isRunning(), true);

  await supervisor.ensure();
  assert.equal(spawned.length, 2);
  assert.equal(supervisor.isRunning(), true);

  supervisor.stop();
});
