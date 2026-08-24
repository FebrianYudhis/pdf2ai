import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";

import { buildServer } from "../src/server.js";
import { FolderStore } from "../src/folder-store.js";
import {
  exportConfiguration,
  importConfiguration,
  exportDataArchive,
  importDataArchive,
  BackupError,
} from "../src/backup.js";

function createTestContext() {
  const dir = mkdtempSync(join(tmpdir(), "pdf2ai-backup-test-"));
  const jobsDir = join(dir, "jobs");
  const aiDir = join(dir, "ai-results");
  const folderFile = join(dir, ".folders.json");
  const appConfigFile = join(dir, ".app-config.json");
  const authFile = join(dir, "auth.json");

  mkdirSync(jobsDir, { recursive: true });
  mkdirSync(aiDir, { recursive: true });

  return {
    dir,
    jobsDir,
    aiDir,
    folderFile,
    appConfigFile,
    authFile,
  };
}

test("exportConfiguration dan importConfiguration berfungsi dengan benar", async () => {
  const ctx = createTestContext();

  const appSettings = {
    ocrDevice: "cpu",
    ocrMode: "auto",
    forceOcr: false,
    lowMemoryMode: false,
    ocrLanguage: "english",
    maxFileSizeMb: 25,
    aiTimeoutSeconds: 300,
    sessionHours: 12,
  };

  const aiConfig = {
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini"],
    defaultModel: "gpt-4o",
    templates: [{ id: "t1", name: "Ringkasan", prompt: "Buat ringkasan" }],
  };

  const exported = exportConfiguration({
    applicationSettings: appSettings,
    aiConfig,
  });

  assert.equal(exported.version, 1);
  assert.equal(exported.type, "pdf2ai-config");
  assert.equal(exported.folders, undefined);
  assert.equal(exported.aiConfig.defaultModel, "gpt-4o");

  // Import ke context baru
  const ctx2 = createTestContext();

  const mfaConfig = { secret: "test", ai: null };
  const importResult = await importConfiguration({
    configData: exported,
    applicationConfigFile: ctx2.appConfigFile,
    authFile: ctx2.authFile,
    mfaConfig,
  });

  assert.equal(importResult.ok, true);
  assert.equal(importResult.aiConfig.defaultModel, "gpt-4o");
  assert.equal(importResult.applicationSettings.ocrDevice, "cpu");
});

test("exportDataArchive dan importDataArchive mampu membundel dan memulihkan dokumen, markdown, AI, dan folder", async () => {
  const ctx = createTestContext();
  const folderStore = new FolderStore({ path: ctx.folderFile });
  await folderStore.init();
  const folder = await folderStore.create("Dokumen Penting");

  // Buat sample job
  const jobId = randomUUID();
  const jobDir = join(ctx.jobsDir, jobId);
  mkdirSync(jobDir, { recursive: true });

  const metadata = {
    id: jobId,
    originalName: "test-doc.pdf",
    size: 1024,
    status: "completed",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    folderId: folder.id,
  };
  writeFileSync(join(jobDir, "metadata.json"), JSON.stringify(metadata), "utf8");
  writeFileSync(join(jobDir, "result.md"), "# Hasil Ekstraksi Markdown\n\nIsi dokumen.", "utf8");
  writeFileSync(join(jobDir, "input.pdf"), "%PDF-1.4 sample content", "utf8");

  // Buat sample AI result
  const aiId = randomUUID();
  const aiResult = {
    id: aiId,
    jobId,
    model: "gpt-4o",
    templateId: null,
    prompt: "Jelaskan isi dokumen",
    completion: "Ini adalah rangkuman dari dokumen.",
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(ctx.aiDir, `${aiId}.json`), JSON.stringify(aiResult), "utf8");

  // Export Data Archive (ZIP)
  const zipBuffer = await exportDataArchive({
    dataDirectory: ctx.jobsDir,
    aiResultDirectory: ctx.aiDir,
    folderStore,
    includePdfs: true,
  });

  assert.ok(Buffer.isBuffer(zipBuffer));
  assert.ok(zipBuffer.length > 0);

  // Verifikasi isi ZIP dengan AdmZip
  const zip = new AdmZip(zipBuffer);
  const manifest = JSON.parse(zip.readAsText("manifest.json"));
  assert.equal(manifest.jobCount, 1);
  assert.equal(manifest.aiResultCount, 1);
  assert.equal(manifest.folderCount, 1);

  // Import ke destination baru
  const ctxTarget = createTestContext();
  const targetFolderStore = new FolderStore({ path: ctxTarget.folderFile });
  await targetFolderStore.init();

  const fakeQueue = {
    reloaded: false,
    async reload() {
      this.reloaded = true;
    },
  };
  const fakeAiStore = {
    reloaded: false,
    async reload() {
      this.reloaded = true;
    },
  };

  const importResult = await importDataArchive({
    zipBuffer,
    dataDirectory: ctxTarget.jobsDir,
    aiResultDirectory: ctxTarget.aiDir,
    folderStore: targetFolderStore,
    jobQueue: fakeQueue,
    aiResultStore: fakeAiStore,
  });

  assert.equal(importResult.ok, true);
  assert.equal(importResult.importedJobs, 1);
  assert.equal(importResult.importedAiResults, 1);
  assert.equal(importResult.importedFolders, 1);
  assert.equal(fakeQueue.reloaded, true);
  assert.equal(fakeAiStore.reloaded, true);

  // Cek apakah file benar-benar tertulis di direktori target
  assert.equal(
    readFileSync(join(ctxTarget.jobsDir, jobId, "result.md"), "utf8"),
    "# Hasil Ekstraksi Markdown\n\nIsi dokumen.",
  );
  assert.equal(
    readFileSync(join(ctxTarget.jobsDir, jobId, "input.pdf"), "utf8"),
    "%PDF-1.4 sample content",
  );
  assert.equal(
    JSON.parse(readFileSync(join(ctxTarget.aiDir, `${aiId}.json`), "utf8")).completion,
    "Ini adalah rangkuman dari dokumen.",
  );
  assert.equal(targetFolderStore.list().length, 1);
  assert.equal(targetFolderStore.list()[0].name, "Dokumen Penting");
});

test("importDataArchive menolak ZIP yang tidak aman atau path traversal", async () => {
  const ctx = createTestContext();
  const folderStore = new FolderStore({ path: ctx.folderFile });
  await folderStore.init();

  const evilZip = new AdmZip();
  evilZip.addFile("../evil.txt", Buffer.from("attack"));

  await assert.rejects(
    async () => {
      await importDataArchive({
        zipBuffer: evilZip.toBuffer(),
        dataDirectory: ctx.jobsDir,
        aiResultDirectory: ctx.aiDir,
        folderStore,
      });
    },
    (err) => err instanceof BackupError && err.statusCode === 400,
  );
});

test("endpoint API /v1/backup/config dan /v1/backup/data berfungsi via HTTP", async () => {
  const ctx = createTestContext();
  const server = await buildServer({
    config: {
      host: "127.0.0.1",
      port: 3000,
      maxFileSizeMb: 10,
      authEnabled: false,
      dataDirectory: ctx.jobsDir,
      folderFile: ctx.folderFile,
      applicationConfigFile: ctx.appConfigFile,
      authFile: ctx.authFile,
      aiResultDirectory: ctx.aiDir,
    },
  });

  // 1. Export Config GET
  const configRes = await server.inject({
    method: "GET",
    url: "/v1/backup/config/export",
  });
  assert.equal(configRes.statusCode, 200);
  const configBody = JSON.parse(configRes.body);
  assert.equal(configBody.type, "pdf2ai-config");

  // 2. Import Config POST
  const importConfigRes = await server.inject({
    method: "POST",
    url: "/v1/backup/config/import",
    headers: { "content-type": "application/json" },
    payload: {
      applicationSettings: {
        ocrDevice: "cpu",
        ocrMode: "off",
        forceOcr: false,
        lowMemoryMode: false,
        ocrLanguage: "indonesia",
        maxFileSizeMb: 30,
        aiTimeoutSeconds: 120,
        sessionHours: 24,
      },
    },
  });
  assert.equal(importConfigRes.statusCode, 200);
  const importConfigBody = JSON.parse(importConfigRes.body);
  assert.equal(importConfigBody.ok, true);

  // 3. Export Data GET
  const dataExportRes = await server.inject({
    method: "GET",
    url: "/v1/backup/data/export",
  });
  assert.equal(dataExportRes.statusCode, 200);
  assert.equal(dataExportRes.headers["content-type"], "application/zip");
  assert.ok(dataExportRes.rawPayload.length > 0);

  // 4. Import Data POST
  const importDataRes = await server.inject({
    method: "POST",
    url: "/v1/backup/data/import",
    headers: { "content-type": "application/octet-stream" },
    payload: dataExportRes.rawPayload,
  });
  assert.equal(importDataRes.statusCode, 200);
  const importDataBody = JSON.parse(importDataRes.body);
  assert.equal(importDataBody.ok, true);

  await server.close();
});
