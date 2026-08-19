import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSync } from "otplib";

import { saveApplicationSettings } from "../src/application-config.js";
import {
  buildOcrProcessEnvironment,
  resolveOcrLanguage,
} from "../src/server-config.js";
import { buildServer, loadConfig } from "../src/server.js";

function testConfig() {
  return {
    host: "127.0.0.1",
    port: 3000,
    maxFileSizeMb: 1,
    hybrid: "off",
    hybridMode: "full",
    hybridUrl: "http://127.0.0.1:5002",
    hybridTimeout: "0",
    authEnabled: false,
    dataDirectory: mkdtempSync(join(tmpdir(), "odl-pdf-api-test-")),
  };
}

test("konfigurasi default memakai hybrid auto untuk CPU-balanced", () => {
  const previousMode = process.env.ODL_HYBRID_MODE;
  delete process.env.ODL_HYBRID_MODE;

  try {
    assert.equal(loadConfig().hybridMode, "auto");
  } finally {
    if (previousMode === undefined) {
      delete process.env.ODL_HYBRID_MODE;
    } else {
      process.env.ODL_HYBRID_MODE = previousMode;
    }
  }
});

test("konfigurasi TOTP tidak memerlukan APP_PASSWORD", () => {
  const previousPassword = process.env.APP_PASSWORD;
  delete process.env.APP_PASSWORD;

  try {
    const config = loadConfig();
    assert.equal(config.authEnabled, true);
    assert.equal("appPassword" in config, false);
  } finally {
    if (previousPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previousPassword;
    }
  }
});

test("konfigurasi aplikasi persisten dimuat saat startup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pdf2ai-app-config-test-"));
  const appConfigFile = join(directory, "app-config.json");
  await saveApplicationSettings(appConfigFile, {
    ocrDevice: "auto",
    ocrMode: "full",
    forceOcr: true,
    lowMemoryMode: true,
    ocrLanguage: "english",
    maxFileSizeMb: 64,
    aiTimeoutSeconds: 420,
    sessionHours: 36,
  });

  const config = loadConfig({ environment: {}, appConfigFile });
  assert.equal(config.ocrDevice, "auto");
  assert.equal(config.hybridMode, "full");
  assert.equal(config.forceOcr, true);
  assert.equal(config.lowMemoryMode, true);
  assert.equal(config.maxFileSizeMb, 64);
  assert.equal(config.aiTimeoutMs, 420_000);
  assert.equal(config.sessionHours, 36);
});

test("konfigurasi aplikasi disimpan dan menandai perubahan yang perlu restart", async (t) => {
  const config = testConfig();
  const app = await buildServer({ config });
  t.after(() => app.close());

  const initial = await app.inject({ method: "GET", url: "/auth/app-config" });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().settings.ocrDevice, "cpu");
  assert.equal(initial.json().settings.ocrMode, "off");
  assert.equal(initial.json().settings.lowMemoryMode, false);
  assert.equal(initial.json().restartRequired, false);

  const settings = {
    ocrDevice: "cuda",
    ocrMode: "full",
    forceOcr: true,
    lowMemoryMode: true,
    ocrLanguage: "english",
    maxFileSizeMb: 80,
    aiTimeoutSeconds: 600,
    sessionHours: 24,
  };
  const saved = await app.inject({
    method: "PUT",
    url: "/auth/app-config",
    payload: settings,
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().settings, settings);
  assert.equal(saved.json().restartRequired, true);
  assert.ok(saved.json().restartFields.includes("ocrDevice"));
  assert.ok(saved.json().restartFields.includes("lowMemoryMode"));
  assert.ok(saved.json().restartFields.includes("maxFileSizeMb"));

  const document = JSON.parse(
    readFileSync(join(config.dataDirectory, ".app-config.json"), "utf8"),
  );
  assert.equal(document.version, 1);
  assert.deepEqual(document.settings, settings);

  const invalid = await app.inject({
    method: "PUT",
    url: "/auth/app-config",
    payload: { ...settings, ocrDevice: "gpu-ajaib" },
  });
  assert.equal(invalid.statusCode, 400);
});

test("mode hemat memori membatasi batch dan thread backend OCR", () => {
  const environment = buildOcrProcessEnvironment(
    { lowMemoryMode: true },
    { EXISTING: "tetap", DOCLING_NUM_THREADS: "2" },
  );

  assert.equal(environment.EXISTING, "tetap");
  assert.equal(environment.ODL_LOW_MEMORY_MODE, "1");
  assert.equal(environment.ODL_OCR_SCALE, "2");
  assert.equal(environment.DOCLING_PERF_PAGE_BATCH_SIZE, "1");
  assert.equal(environment.DOCLING_NUM_THREADS, "2");
  assert.equal(environment.OMP_NUM_THREADS, "1");
  assert.equal(environment.HF_HUB_DISABLE_SYMLINKS_WARNING, "1");
});

test("bahasa Indonesia memakai model English RapidOCR", () => {
  assert.equal(resolveOcrLanguage("rapidocr", "indonesia"), "english");
  assert.equal(resolveOcrLanguage("rapidocr", "id"), "english");
  assert.equal(resolveOcrLanguage("rapidocr", "en"), "english");
  assert.equal(resolveOcrLanguage("tesseract", "id,en"), "id,en");
});

function multipartPdf(
  fieldName = "file",
  content = "%PDF-1.7\ntest",
  filename = "test.pdf",
  folderId = null,
) {
  const boundary = "----odl-pdf-test";
  const folderPart = folderId
    ? [
        `--${boundary}`,
        'Content-Disposition: form-data; name="folderId"',
        "",
        folderId,
      ]
    : [];
  const body = Buffer.from(
    [
      ...folderPart,
      `--${boundary}`,
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"`,
      "Content-Type: application/pdf",
      "",
      content,
      `--${boundary}--`,
      "",
    ].join("\r\n"),
  );

  return {
    payload: body,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length),
    },
  };
}

test("folder virtual mengelompokkan job tanpa memindahkan file fisik", async (t) => {
  const config = testConfig();
  const app = await buildServer({
    config,
    extractor: async () => "# Folder virtual",
  });
  t.after(() => app.close());

  const created = await app.inject({
    method: "POST",
    url: "/v1/folders",
    payload: { name: "  Invoice 2026  " },
  });
  assert.equal(created.statusCode, 201);
  const folder = created.json().folder;
  assert.equal(folder.name, "Invoice 2026");
  assert.equal(created.headers.location, `/v1/folders/${folder.id}`);

  const duplicate = await app.inject({
    method: "POST",
    url: "/v1/folders",
    payload: { name: "invoice 2026" },
  });
  assert.equal(duplicate.statusCode, 409);

  const missingFolderUpload = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    ...multipartPdf(
      "file",
      "%PDF-1.7\nmissing-folder",
      "missing-folder.pdf",
      randomUUID(),
    ),
  });
  assert.equal(missingFolderUpload.statusCode, 404);
  assert.equal(app.jobs.list().length, 0);

  const upload = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    ...multipartPdf("file", "%PDF-1.7\nfolder", "invoice.pdf", folder.id),
  });
  assert.equal(upload.statusCode, 202);
  assert.equal(upload.json().job.folderId, folder.id);
  assert.equal(upload.json().job.folder.name, "Invoice 2026");
  const jobId = upload.json().job.id;
  await app.jobs.waitForIdle();

  const collection = await app.inject({ method: "GET", url: "/v1/folders" });
  assert.equal(collection.statusCode, 200);
  assert.equal(collection.json().folders[0].jobCount, 1);
  assert.equal(collection.json().unfiledCount, 0);

  const folderContents = await app.inject({
    method: "GET",
    url: `/v1/folders/${folder.id}`,
  });
  assert.equal(folderContents.statusCode, 200);
  assert.equal(folderContents.json().folder.jobCount, 1);
  assert.equal(folderContents.json().jobs.length, 1);
  assert.equal(folderContents.json().jobs[0].id, jobId);

  const renamed = await app.inject({
    method: "PATCH",
    url: `/v1/folders/${folder.id}`,
    payload: { name: "Arsip Invoice" },
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().folder.name, "Arsip Invoice");

  const movedOut = await app.inject({
    method: "PATCH",
    url: `/v1/jobs/${jobId}`,
    payload: { folderId: null },
  });
  assert.equal(movedOut.statusCode, 200);
  assert.equal(movedOut.json().job.folder, null);

  await app.inject({
    method: "PATCH",
    url: `/v1/jobs/${jobId}`,
    payload: { folderId: folder.id },
  });
  const deleted = await app.inject({
    method: "DELETE",
    url: `/v1/folders/${folder.id}`,
  });
  assert.equal(deleted.statusCode, 204);

  const detail = await app.inject({ method: "GET", url: `/v1/jobs/${jobId}` });
  assert.equal(detail.json().job.folderId, null);
  assert.equal(detail.json().job.folder, null);
  assert.equal(existsSync(join(config.dataDirectory, jobId, "input.pdf")), true);

  await app.jobs.move(jobId, randomUUID());
  const staleReference = await app.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}`,
  });
  assert.equal(staleReference.json().job.folderId, null);
  assert.equal(staleReference.json().job.folder, null);
  assert.equal(staleReference.json().job.folderUrl, null);
});

test("folder dan penempatan job dimuat kembali setelah restart", async (t) => {
  const config = testConfig();
  const extractor = async () => "# Persisten";
  const firstApp = await buildServer({ config, extractor });

  const created = await firstApp.inject({
    method: "POST",
    url: "/v1/folders",
    payload: { name: "Dokumen Legal" },
  });
  const folderId = created.json().folder.id;
  const uploaded = await firstApp.inject({
    method: "POST",
    url: "/v1/jobs",
    ...multipartPdf("file", "%PDF-1.7\npersist", "legal.pdf", folderId),
  });
  const jobId = uploaded.json().job.id;
  await firstApp.jobs.waitForIdle();
  await firstApp.close();

  const secondApp = await buildServer({ config, extractor });
  t.after(() => secondApp.close());

  const folders = await secondApp.inject({ method: "GET", url: "/v1/folders" });
  assert.equal(folders.json().folders[0].id, folderId);
  assert.equal(folders.json().folders[0].jobCount, 1);

  const job = await secondApp.inject({ method: "GET", url: `/v1/jobs/${jobId}` });
  assert.equal(job.json().job.folderId, folderId);
  assert.equal(job.json().job.folder.name, "Dokumen Legal");
});

test("dashboard, sub-navbar docs, Scalar API reference, dan health tersedia", async (t) => {
  const app = await buildServer({ config: testConfig() });
  t.after(() => app.close());

  const [
    page,
    docs,
    docsSlash,
    scalarDocs,
    scalarReference,
    openApi,
    guide,
    health,
    oldHealth,
    oldAi,
    appScript,
    appElements,
    appUtils,
    configurationController,
    mobileMenu,
    mainStyles,
    authStyles,
    docsStyles,
    sweetAlert,
  ] = await Promise.all([
    app.inject({ method: "GET", url: "/" }),
    app.inject({ method: "GET", url: "/docs" }),
    app.inject({ method: "GET", url: "/docs/" }),
    app.inject({ method: "GET", url: "/docs/scalar" }),
    app.inject({ method: "GET", url: "/docs/scalar/reference/" }),
    app.inject({ method: "GET", url: "/docs/scalar/reference/openapi.json" }),
    app.inject({ method: "GET", url: "/guide" }),
    app.inject({ method: "GET", url: "/v1/health" }),
    app.inject({ method: "GET", url: "/health" }),
    app.inject({ method: "GET", url: "/ai" }),
    app.inject({ method: "GET", url: "/app.js" }),
    app.inject({ method: "GET", url: "/app-elements.js" }),
    app.inject({ method: "GET", url: "/app-utils.js" }),
    app.inject({ method: "GET", url: "/configuration-controller.js" }),
    app.inject({ method: "GET", url: "/mobile-menu.js" }),
    app.inject({ method: "GET", url: "/styles.css" }),
    app.inject({ method: "GET", url: "/styles-auth.css" }),
    app.inject({ method: "GET", url: "/styles-docs.css" }),
    app.inject({ method: "GET", url: "/vendor/sweetalert2.esm.all.min.js" }),
  ]);

  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"], /^text\/html/);
  assert.match(page.body, /PDF siap untuk AI\./);
  assert.match(page.body, /class="service-card"/);
  assert.match(page.body, /id="service-status-text">Memeriksa mesin/);
  assert.match(page.body, /Status API dan OCR diperiksa otomatis/);
  assert.doesNotMatch(page.body, /OCR \+ Markdown/);
  assert.doesNotMatch(page.body, /CPU stabil atau akselerator/);
  assert.doesNotMatch(page.body, /Data tetap di mesin Anda/);
  assert.doesNotMatch(page.body, /Proses berlanjut meski halaman ditutup/);
  assert.match(page.body, /Fetch Data/);
  assert.match(page.body, /data-result-tab="pdf"/);
  assert.match(page.body, /data-result-tab="metadata"/);
  assert.match(page.body, /data-result-tab="markdown"/);
  assert.match(page.body, /DELETE · HAPUS DATA/);
  assert.match(page.body, /id="config-button"/);
  assert.match(page.body, /id="config-dialog"/);
  assert.match(page.body, /data-config-tab="app"/);
  assert.match(page.body, /data-config-tab="ai"/);
  assert.match(page.body, /data-config-tab="api"/);
  assert.match(page.body, /<select id="app-ocr-language">/);
  assert.match(page.body, /Bahasa Indonesia — model English/);
  assert.match(page.body, /id="app-ocr-language-help"/);
  assert.match(page.body, /id="fetch-ai-results-url"/);
  assert.match(page.body, /id="mobile-menu-button"/);
  assert.match(page.body, /aria-controls="topbar-actions"/);
  assert.match(page.body, /id="ask-ai-dialog"/);
  assert.match(page.body, /id="job-list" role="list"/);
  assert.match(page.body, /id="pagination-nav"/);
  assert.match(page.body, /id="pagination-prev"/);
  assert.match(page.body, /id="pagination-next"/);
  assert.match(page.body, /id="queue-toggle-button"/);
  assert.match(page.body, /id="queue-paused-banner"/);
  assert.match(page.body, /id="upload-size-limit"/);
  assert.doesNotMatch(page.body, /maksimum 25 MB per file/);
  assert.equal(docs.statusCode, 200);
  assert.match(docs.headers["content-type"], /^text\/html/);
  assert.match(docs.body, /Integrasikan PDF2AI\./);
  assert.match(docs.body, /<ul>/);
  assert.match(docs.body, /href="\/docs" aria-current="page"/);
  assert.match(docs.body, /href="\/docs\/scalar"/);
  assert.match(docs.body, /href="#queue-control"/);
  assert.match(docs.body, /href="#cancel-job"/);
  assert.match(docs.body, /\/v1\/queue\/pause/);
  assert.match(docs.body, /\/v1\/jobs\/:id\/cancel/);
  assert.equal(docsSlash.statusCode, 200);
  assert.equal(scalarDocs.statusCode, 200);
  assert.match(scalarDocs.body, /href="\/docs\/scalar" aria-current="page"/);
  assert.match(scalarDocs.body, /src="\/docs\/scalar\/reference\/"/);
  assert.equal(scalarReference.statusCode, 200);
  assert.match(scalarReference.body, /PDF2AI API Reference/);
  assert.match(scalarReference.body, /scalar/);
  assert.equal(openApi.statusCode, 200);
  assert.match(openApi.headers["content-type"], /^application\/json/);
  const specification = openApi.json();
  assert.equal(specification.openapi, "3.0.3");
  assert.equal(specification.info.version, "v1");
  assert.ok(specification.paths["/v1/jobs"]?.post);
  assert.ok(specification.paths["/v1/folders/{id}"]?.get);
  assert.ok(specification.paths["/v1/jobs/{jobId}/ai/{aiId}"]?.get);
  assert.ok(specification.paths["/v1/queue/pause"]?.post);
  assert.ok(specification.paths["/v1/queue/resume"]?.post);
  assert.ok(specification.paths["/v1/jobs/{id}/cancel"]?.post);
  assert.equal(specification.paths["/login"], undefined);
  assert.deepEqual(specification.paths["/v1/health"].get.security, []);
  assert.equal(
    specification.components.securitySchemes.ApiKeyAuth.name,
    "X-API-Key",
  );
  assert.equal(
    specification.paths["/v1/jobs"].post.requestBody.content[
      "multipart/form-data"
    ].schema.properties.file.format,
    "binary",
  );
  assert.equal(guide.statusCode, 302);
  assert.equal(guide.headers.location, "/docs");
  assert.equal(appScript.statusCode, 200);
  assert.match(appScript.body, /confirmDeletion/);
  assert.match(appScript.body, /Swal\.fire/);
  assert.match(appScript.body, /toggleQueue/);
  assert.match(appScript.body, /cancelJob/);
  assert.match(appScript.body, /updateQueueState/);
  assert.match(appScript.body, /renderPagination/);
  assert.match(appScript.body, /ITEMS_PER_PAGE\s*=\s*6/);
  assert.match(appScript.body, /is-action-open/);
  assert.doesNotMatch(appScript.body, /progress-track/);
  assert.match(appScript.body, /pendingAiRequests/);
  assert.match(appScript.body, /AI gagal menjawab/);
  assert.match(appScript.body, /formatLastUpdated/);
  assert.match(appScript.body, /getActiveAlertTarget/);
  assert.match(appScript.body, /modal-toast-region/);
  assert.match(mainStyles.body, /\.modal-toast-region/);
  assert.match(mainStyles.body, /\.queue-paused-banner\[hidden\]/);
  assert.match(mainStyles.body, /\.job-card\.is-action-open/);
  assert.match(mainStyles.body, /\.status-badge\.processing::before/);
  assert.match(mainStyles.body, /\.pagination-nav/);
  assert.match(mainStyles.body, /\.pagination-page-button/);
  assert.match(mainStyles.body, /\.api-key-badge\.is-active/);
  assert.match(mainStyles.body, /\.api-key-specs-grid/);
  assert.match(mainStyles.body, /\.api-key-example-card/);
  assert.match(page.body, /id="api-key-badge"/);
  assert.match(page.body, /id="api-key-specs"/);
  assert.match(appScript.body, /jobActionMenu/);
  assert.match(appScript.body, /job-action-trigger/);
  assert.match(appScript.body, /actionIconPaths/);
  assert.match(appScript.body, /createElementNS/);
  assert.match(appScript.body, /aria-haspopup/);
  assert.match(appScript.body, /\.job-action-menu\[open\]/);
  assert.match(appScript.body, /syncFolderFilterFromUploadDestination/);
  assert.match(appScript.body, /syncUploadFolder/);
  assert.match(configurationController.body, /syncUploadSizeInformation/);
  assert.match(configurationController.body, /MB setelah restart/);
  assert.match(configurationController.body, /Rotasi API key\?/);
  for (const moduleAsset of [
    appElements,
    appUtils,
    configurationController,
    mobileMenu,
  ]) {
    assert.equal(moduleAsset.statusCode, 200);
    assert.match(moduleAsset.headers["content-type"], /javascript/);
  }
  for (const styleAsset of [mainStyles, authStyles, docsStyles]) {
    assert.equal(styleAsset.statusCode, 200);
    assert.match(styleAsset.headers["content-type"], /^text\/css/);
  }
  assert.equal(sweetAlert.statusCode, 200);
  assert.match(sweetAlert.headers["content-type"], /javascript/);
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), {
    status: "ok",
    mode: "local",
    hybridReady: true,
    queue: { queued: 0, processing: 0, completed: 0, failed: 0, paused: false },
  });
  assert.equal(oldHealth.statusCode, 404);
  assert.equal(oldAi.statusCode, 404);
});

test("setup TOTP sekali lalu login hanya memerlukan kode TOTP", async (t) => {
  const config = {
    ...testConfig(),
    authEnabled: true,
    sessionHours: 1,
  };
  config.authFile = join(config.dataDirectory, "auth.json");
  const app = await buildServer({
    config,
    extractor: async () => "# Auth folder",
  });
  t.after(() => app.close());

  const [dashboard, docs, api, setupPage, authStyles, font, health] = await Promise.all([
    app.inject({
      method: "GET",
      url: "/",
      headers: { accept: "text/html" },
    }),
    app.inject({
      method: "GET",
      url: "/docs",
      headers: { accept: "text/html" },
    }),
    app.inject({ method: "GET", url: "/v1/jobs" }),
    app.inject({ method: "GET", url: "/setup" }),
    app.inject({ method: "GET", url: "/styles-auth.css" }),
    app.inject({ method: "GET", url: "/fonts/inter-latin-variable.woff2" }),
    app.inject({ method: "GET", url: "/v1/health" }),
  ]);
  assert.equal(dashboard.statusCode, 302);
  assert.equal(dashboard.headers.location, "/setup");
  assert.equal(docs.statusCode, 302);
  assert.equal(docs.headers.location, "/setup");
  assert.equal(api.statusCode, 401);
  assert.equal(setupPage.statusCode, 200);
  assert.match(setupPage.body, /Aktifkan TOTP/);
  assert.equal(authStyles.statusCode, 200);
  assert.match(authStyles.headers["content-type"], /^text\/css/);
  assert.equal(font.statusCode, 200);
  assert.match(font.headers["content-type"], /font\/woff2/);
  assert.equal(health.statusCode, 200);

  const apiKeyManagementWithoutLogin = await app.inject({
    method: "POST",
    url: "/auth/api-key",
  });
  assert.equal(apiKeyManagementWithoutLogin.statusCode, 401);

  const started = await app.inject({
    method: "POST",
    url: "/setup/start",
    payload: {},
  });
  assert.equal(started.statusCode, 200);
  assert.match(started.json().qrCode, /^data:image\/png;base64,/);
  const { secret, setupToken } = started.json();
  const code = generateSync({ secret });
  const wrongCode = code === "000000" ? "000001" : "000000";

  const invalidConfirmation = await app.inject({
    method: "POST",
    url: "/setup/confirm",
    payload: { setupToken, code: wrongCode },
  });
  assert.equal(invalidConfirmation.statusCode, 401);

  const confirmed = await app.inject({
    method: "POST",
    url: "/setup/confirm",
    payload: { setupToken, code },
  });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(existsSync(config.authFile), true);
  assert.match(confirmed.headers["set-cookie"], /HttpOnly/);
  assert.match(confirmed.headers["set-cookie"], /SameSite=Strict/);
  const cookie = confirmed.headers["set-cookie"].split(";", 1)[0];

  const authenticated = await app.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { cookie },
  });
  assert.equal(authenticated.statusCode, 200);

  const authenticatedDocs = await app.inject({
    method: "GET",
    url: "/docs/scalar",
    headers: { cookie },
  });
  assert.equal(authenticatedDocs.statusCode, 200);
  assert.match(authenticatedDocs.body, /Scalar API Docs/);

  const initialApiKeyStatus = await app.inject({
    method: "GET",
    url: "/auth/api-key",
    headers: { cookie },
  });
  assert.deepEqual(initialApiKeyStatus.json(), {
    configured: false,
    prefix: null,
    createdAt: null,
  });

  const generated = await app.inject({
    method: "POST",
    url: "/auth/api-key",
    headers: { cookie },
  });
  assert.equal(generated.statusCode, 201);
  const firstApiKey = generated.json().apiKey;
  assert.match(firstApiKey, /^p2ai_[A-Za-z0-9_-]{40,}$/);
  assert.equal(readFileSync(config.authFile, "utf8").includes(firstApiKey), false);

  const createdFolder = await app.inject({
    method: "POST",
    url: "/v1/folders",
    headers: { cookie },
    payload: { name: "Folder API" },
  });
  assert.equal(createdFolder.statusCode, 201);
  const folderId = createdFolder.json().folder.id;

  const apiCannotCreateFolder = await app.inject({
    method: "POST",
    url: "/v1/folders",
    headers: { "x-api-key": firstApiKey },
    payload: { name: "Ditolak" },
  });
  assert.equal(apiCannotCreateFolder.statusCode, 403);

  const apiCannotRenameFolder = await app.inject({
    method: "PATCH",
    url: `/v1/folders/${folderId}`,
    headers: { "x-api-key": firstApiKey },
    payload: { name: "Ditolak juga" },
  });
  assert.equal(apiCannotRenameFolder.statusCode, 403);

  const apiCannotDeleteFolder = await app.inject({
    method: "DELETE",
    url: `/v1/folders/${folderId}`,
    headers: { "x-api-key": firstApiKey },
  });
  assert.equal(apiCannotDeleteFolder.statusCode, 403);

  const uploadData = multipartPdf("file", "%PDF-1.7\napi-folder", "api.pdf");
  const uploaded = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: { ...uploadData.headers, cookie },
    payload: uploadData.payload,
  });
  assert.equal(uploaded.statusCode, 202);
  const jobId = uploaded.json().job.id;
  await app.jobs.waitForIdle();

  const apiFolderList = await app.inject({
    method: "GET",
    url: "/v1/folders",
    headers: { "x-api-key": firstApiKey },
  });
  assert.equal(apiFolderList.statusCode, 200);
  assert.equal(apiFolderList.json().folders[0].id, folderId);

  const attached = await app.inject({
    method: "PATCH",
    url: `/v1/jobs/${jobId}`,
    headers: { "x-api-key": firstApiKey },
    payload: { folderId },
  });
  assert.equal(attached.statusCode, 200);
  assert.equal(attached.json().job.folderId, folderId);

  const apiFolderContents = await app.inject({
    method: "GET",
    url: `/v1/folders/${folderId}`,
    headers: { "x-api-key": firstApiKey },
  });
  assert.equal(apiFolderContents.statusCode, 200);
  assert.equal(apiFolderContents.json().jobs.length, 1);
  assert.equal(apiFolderContents.json().jobs[0].id, jobId);

  const detached = await app.inject({
    method: "PATCH",
    url: `/v1/jobs/${jobId}`,
    headers: { "x-api-key": firstApiKey },
    payload: { folderId: null },
  });
  assert.equal(detached.statusCode, 200);
  assert.equal(detached.json().job.folderId, null);

  const emptyFolder = await app.inject({
    method: "GET",
    url: `/v1/folders/${folderId}`,
    headers: { "x-api-key": firstApiKey },
  });
  assert.equal(emptyFolder.json().folder.jobCount, 0);
  assert.deepEqual(emptyFolder.json().jobs, []);

  const renamedFromDashboard = await app.inject({
    method: "PATCH",
    url: `/v1/folders/${folderId}`,
    headers: { cookie },
    payload: { name: "Folder API diperbarui" },
  });
  assert.equal(renamedFromDashboard.statusCode, 200);

  const deletedFromDashboard = await app.inject({
    method: "DELETE",
    url: `/v1/folders/${folderId}`,
    headers: { cookie },
  });
  assert.equal(deletedFromDashboard.statusCode, 204);

  const externalWithKey = await app.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { "x-api-key": firstApiKey },
  });
  assert.equal(externalWithKey.statusCode, 200);

  const rotated = await app.inject({
    method: "POST",
    url: "/auth/api-key",
    headers: { cookie },
  });
  const secondApiKey = rotated.json().apiKey;
  assert.notEqual(secondApiKey, firstApiKey);

  const oldApiKey = await app.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { "x-api-key": firstApiKey },
  });
  assert.equal(oldApiKey.statusCode, 401);

  const currentApiKey = await app.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { "x-api-key": secondApiKey },
  });
  assert.equal(currentApiKey.statusCode, 200);

  const reloadedWithApiKey = await buildServer({ config });
  const persistedApiKey = await reloadedWithApiKey.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { "x-api-key": secondApiKey },
  });
  assert.equal(persistedApiKey.statusCode, 200);
  await reloadedWithApiKey.close();

  const logout = await app.inject({
    method: "POST",
    url: "/logout",
    headers: { cookie },
  });
  assert.equal(logout.statusCode, 204);
  assert.match(logout.headers["set-cookie"], /Max-Age=0/);

  const expired = await app.inject({
    method: "GET",
    url: "/",
    headers: { cookie, accept: "text/html" },
  });
  assert.equal(expired.statusCode, 302);
  assert.equal(expired.headers.location, "/login");

  const missingCode = await app.inject({
    method: "POST",
    url: "/login",
    payload: {},
  });
  assert.equal(missingCode.statusCode, 400);

  const invalidLogin = await app.inject({
    method: "POST",
    url: "/login",
    payload: { code: wrongCode },
  });
  assert.equal(invalidLogin.statusCode, 401);

  const accepted = await app.inject({
    method: "POST",
    url: "/login",
    payload: { code },
  });
  assert.equal(accepted.statusCode, 200);

  const revoked = await app.inject({
    method: "DELETE",
    url: "/auth/api-key",
    headers: { cookie: accepted.headers["set-cookie"].split(";", 1)[0] },
  });
  assert.equal(revoked.statusCode, 204);

  const apiWithoutKey = await app.inject({
    method: "GET",
    url: "/v1/jobs",
  });
  assert.equal(apiWithoutKey.statusCode, 401);

  const restarted = await buildServer({ config });
  t.after(() => restarted.close());
  const loginAfterRestart = await restarted.inject({
    method: "GET",
    url: "/login",
  });
  assert.equal(loginAfterRestart.statusCode, 200);
  assert.match(loginAfterRestart.body, /Kode TOTP/);
});

test("konfigurasi Tanya AI, eksekusi, API key, dan hasil persisten", async (t) => {
  const config = {
    ...testConfig(),
    authEnabled: true,
    sessionHours: 1,
    aiTimeoutMs: 5_000,
  };
  config.authFile = join(config.dataDirectory, "auth.json");
  const modelRequests = [];
  const completionRequests = [];
  const dependencies = {
    config,
    extractor: async () => "# Invoice\n\nTotal: Rp100.000",
    aiListModels: async (options) => {
      modelRequests.push(options);
      return ["model-cepat", "model-teliti"];
    },
    aiComplete: async (options) => {
      completionRequests.push(options);
      return {
        content: "Total invoice adalah Rp100.000.",
        providerId: "chatcmpl-test",
        providerModel: options.model,
        usage: { total_tokens: 42 },
      };
    },
  };
  const app = await buildServer(dependencies);
  t.after(() => app.close());

  const started = await app.inject({
    method: "POST",
    url: "/setup/start",
    payload: {},
  });
  const { secret, setupToken } = started.json();
  const confirmed = await app.inject({
    method: "POST",
    url: "/setup/confirm",
    payload: { setupToken, code: generateSync({ secret }) },
  });
  const cookie = confirmed.headers["set-cookie"].split(";", 1)[0];

  const initial = await app.inject({
    method: "GET",
    url: "/auth/ai-config",
    headers: { cookie },
  });
  assert.deepEqual(initial.json(), {
    configured: false,
    baseUrl: "",
    hasToken: false,
    tokenHint: null,
    models: [],
    defaultModel: null,
    templates: [],
    updatedAt: null,
  });

  const modelsWithoutLogin = await app.inject({
    method: "GET",
    url: "/v1/ai/models",
  });
  assert.equal(modelsWithoutLogin.statusCode, 401);

  const initialModels = await app.inject({
    method: "GET",
    url: "/v1/ai/models",
    headers: { cookie },
  });
  assert.deepEqual(initialModels.json(), {
    configured: false,
    modelsUrl: "/v1/ai/models",
    models: [],
    defaultModel: null,
    updatedAt: null,
  });

  const importWithoutLogin = await app.inject({
    method: "POST",
    url: "/auth/ai-config/models",
    payload: { baseUrl: "http://ai.local/v1" },
  });
  assert.equal(importWithoutLogin.statusCode, 401);

  const imported = await app.inject({
    method: "POST",
    url: "/auth/ai-config/models",
    headers: { cookie },
    payload: {
      baseUrl: "http://ai.local/v1/",
      token: "token-provider-rahasia",
    },
  });
  assert.equal(imported.statusCode, 200);
  assert.deepEqual(imported.json(), {
    baseUrl: "http://ai.local/v1",
    models: ["model-cepat", "model-teliti"],
  });
  assert.equal(modelRequests[0].baseUrl, "http://ai.local/v1");
  assert.equal(modelRequests[0].token, "token-provider-rahasia");

  const fallbackDefault = await app.inject({
    method: "PUT",
    url: "/auth/ai-config",
    headers: { cookie },
    payload: {
      baseUrl: imported.json().baseUrl,
      token: "token-provider-rahasia",
      models: imported.json().models,
      templates: [],
    },
  });
  assert.equal(fallbackDefault.statusCode, 200);
  assert.equal(fallbackDefault.json().defaultModel, "model-cepat");

  const invalidDefault = await app.inject({
    method: "PUT",
    url: "/auth/ai-config",
    headers: { cookie },
    payload: {
      baseUrl: imported.json().baseUrl,
      models: imported.json().models,
      defaultModel: "model-asing",
      templates: [],
    },
  });
  assert.equal(invalidDefault.statusCode, 400);

  const templateId = "919fe9e8-d79f-4fe1-afb7-5af5d94af40a";
  const saved = await app.inject({
    method: "PUT",
    url: "/auth/ai-config",
    headers: { cookie },
    payload: {
      baseUrl: imported.json().baseUrl,
      token: "token-provider-rahasia",
      models: imported.json().models,
      defaultModel: "model-teliti",
      templates: [
        {
          id: templateId,
          name: "Ambil total",
          prompt: "Berapa total invoice?",
        },
      ],
    },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().configured, true);
  assert.equal(saved.json().hasToken, true);
  assert.equal(saved.json().defaultModel, "model-teliti");
  assert.equal(JSON.stringify(saved.json()).includes("token-provider-rahasia"), false);

  const availableModels = await app.inject({
    method: "GET",
    url: "/v1/ai/models",
    headers: { cookie },
  });
  assert.deepEqual(availableModels.json(), {
    configured: true,
    modelsUrl: "/v1/ai/models",
    models: ["model-cepat", "model-teliti"],
    defaultModel: "model-teliti",
    updatedAt: saved.json().updatedAt,
  });

  const uploadData = multipartPdf();
  const upload = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    payload: uploadData.payload,
    headers: { ...uploadData.headers, cookie },
  });
  assert.equal(upload.statusCode, 202);
  const jobId = upload.json().job.id;
  await app.jobs.waitForIdle();

  const unknownModel = await app.inject({
    method: "POST",
    url: `/v1/jobs/${jobId}/ai`,
    headers: { cookie },
    payload: { model: "model-asing", message: "Ringkas" },
  });
  assert.equal(unknownModel.statusCode, 400);

  const execution = await app.inject({
    method: "POST",
    url: `/v1/jobs/${jobId}/ai`,
    headers: { cookie },
    payload: {
      model: "model-teliti",
      message: "Berapa total invoice?",
      templateId,
    },
  });
  assert.equal(execution.statusCode, 201);
  const result = execution.json().result;
  const aiResultsUrl = `/v1/jobs/${jobId}/ai`;
  assert.equal(
    execution.headers.location,
    `${aiResultsUrl}/${result.id}`,
  );
  assert.equal(result.content, "Total invoice adalah Rp100.000.");
  assert.equal(result.jobId, jobId);
  assert.equal(result.jobUrl, `/v1/jobs/${jobId}`);
  assert.equal(result.aiModelsUrl, "/v1/ai/models");
  assert.equal(result.aiResultsUrl, aiResultsUrl);
  assert.equal(result.resultUrl, `${aiResultsUrl}/${result.id}`);
  assert.equal(completionRequests[0].markdown, "# Invoice\n\nTotal: Rp100.000");
  assert.equal(completionRequests[0].token, "token-provider-rahasia");

  const otherUploadData = multipartPdf("file", "%PDF-1.7\nother", "other.pdf");
  const otherUpload = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    payload: otherUploadData.payload,
    headers: { ...otherUploadData.headers, cookie },
  });
  await app.jobs.waitForIdle();
  const wrongJobResult = await app.inject({
    method: "GET",
    url: `/v1/jobs/${otherUpload.json().job.id}/ai/${result.id}`,
    headers: { cookie },
  });
  assert.equal(wrongJobResult.statusCode, 404);

  const generatedKey = await app.inject({
    method: "POST",
    url: "/auth/api-key",
    headers: { cookie },
  });
  const apiKey = generatedKey.json().apiKey;
  const externalModels = await app.inject({
    method: "GET",
    url: "/v1/ai/models",
    headers: { "x-api-key": apiKey },
  });
  assert.equal(externalModels.statusCode, 200);
  assert.deepEqual(externalModels.json(), availableModels.json());

  const externalList = await app.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}/ai`,
    headers: { "x-api-key": apiKey },
  });
  assert.equal(externalList.statusCode, 200);
  assert.equal(externalList.json().jobUrl, `/v1/jobs/${jobId}`);
  assert.equal(externalList.json().aiResultsUrl, aiResultsUrl);
  assert.equal(externalList.json().results[0].id, result.id);
  assert.equal(externalList.json().results[0].resultUrl, result.resultUrl);

  const restarted = await buildServer(dependencies);
  const persisted = await restarted.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}/ai/${result.id}`,
    headers: { "x-api-key": apiKey },
  });
  assert.equal(persisted.statusCode, 200);
  assert.equal(persisted.json().result.content, result.content);
  assert.equal(persisted.json().result.jobUrl, result.jobUrl);
  assert.equal(persisted.json().result.aiResultsUrl, result.aiResultsUrl);
  assert.equal(persisted.json().result.resultUrl, result.resultUrl);
  await restarted.close();

  const removed = await app.inject({
    method: "DELETE",
    url: `/v1/jobs/${jobId}`,
    headers: { cookie },
  });
  assert.equal(removed.statusCode, 204);
  const resultAfterDelete = await app.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}/ai/${result.id}`,
    headers: { cookie },
  });
  assert.equal(resultAfterDelete.statusCode, 404);
});

test("job background dapat diunggah, dibaca sebagai Markdown, lalu dihapus", async (t) => {
  const app = await buildServer({
    config: testConfig(),
    extractor: async () => "# Hasil OCR",
  });
  t.after(() => app.close());

  const upload = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    ...multipartPdf(),
  });
  assert.equal(upload.statusCode, 202);
  const jobId = upload.json().job.id;
  assert.equal(upload.headers.location, `/v1/jobs/${jobId}`);
  assert.equal(upload.json().job.jobUrl, `/v1/jobs/${jobId}`);
  assert.equal(upload.json().job.pdfUrl, `/v1/jobs/${jobId}/pdf`);
  assert.equal(upload.json().job.aiModelsUrl, "/v1/ai/models");
  assert.equal(upload.json().job.aiResultsUrl, `/v1/jobs/${jobId}/ai`);

  await app.jobs.waitForIdle();
  const list = await app.inject({ method: "GET", url: "/v1/jobs" });
  assert.equal(list.json().jobs[0].status, "completed");
  assert.equal(
    list.json().jobs[0].markdownUrl,
    `/v1/jobs/${jobId}/markdown`,
  );
  assert.equal(list.json().jobs[0].aiResultsUrl, `/v1/jobs/${jobId}/ai`);
  assert.equal(list.json().jobs[0].aiModelsUrl, "/v1/ai/models");

  const detail = await app.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}`,
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().job.aiResultsUrl, `/v1/jobs/${jobId}/ai`);

  const aiResults = await app.inject({
    method: "GET",
    url: detail.json().job.aiResultsUrl,
  });
  assert.equal(aiResults.statusCode, 200);
  assert.equal(aiResults.json().jobUrl, detail.json().job.jobUrl);
  assert.equal(aiResults.json().aiResultsUrl, detail.json().job.aiResultsUrl);
  assert.deepEqual(aiResults.json().results, []);

  const pdf = await app.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}/pdf?download=1`,
  });
  assert.equal(pdf.statusCode, 200);
  assert.match(pdf.headers["content-type"], /^application\/pdf/);
  assert.match(pdf.headers["content-disposition"], /attachment/);
  assert.match(pdf.body, /^%PDF-1\.7/);

  const markdown = await app.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}/markdown`,
  });
  assert.equal(markdown.statusCode, 200);
  assert.match(markdown.headers["content-type"], /^text\/markdown/);
  assert.equal(markdown.body, "# Hasil OCR");

  const removed = await app.inject({
    method: "DELETE",
    url: `/v1/jobs/${jobId}`,
  });
  assert.equal(removed.statusCode, 204);

  const missing = await app.inject({
    method: "GET",
    url: `/v1/jobs/${jobId}`,
  });
  assert.equal(missing.statusCode, 404);
});

test("semua job menggunakan satu worker secara berurutan", async (t) => {
  let active = 0;
  let maximumActive = 0;
  const app = await buildServer({
    config: testConfig(),
    extractor: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      active -= 1;
      return "# Selesai";
    },
  });
  t.after(() => app.close());

  await Promise.all([
    app.inject({
      method: "POST",
      url: "/v1/jobs",
      ...multipartPdf("file", "%PDF-1.7\none", "one.pdf"),
    }),
    app.inject({
      method: "POST",
      url: "/v1/jobs",
      ...multipartPdf("file", "%PDF-1.7\ntwo", "two.pdf"),
    }),
  ]);

  await app.jobs.waitForIdle();
  assert.equal(maximumActive, 1);
  assert.equal(app.jobs.stats().completed, 2);
});

test("endpoint sinkron sudah tidak tersedia", async (t) => {
  const app = await buildServer({ config: testConfig() });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/extract/markdown",
    ...multipartPdf(),
  });

  assert.equal(response.statusCode, 404);
  assert.equal(app.jobs.list().length, 0);
});

test("field upload selain 'file' ditolak", async (t) => {
  const app = await buildServer({ config: testConfig() });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    ...multipartPdf("document"),
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /field harus 'file'/);
});

test("file tanpa signature PDF ditolak", async (t) => {
  const app = await buildServer({ config: testConfig() });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    ...multipartPdf("file", "not a pdf"),
  });

  assert.equal(response.statusCode, 415);
  assert.match(response.json().error, /bukan PDF/);
  assert.equal(app.jobs.list().length, 0);
});

test("endpoint /v1/queue/pause, /v1/queue/resume, dan /v1/jobs/:id/cancel bekerja dengan baik", async (t) => {
  const app = await buildServer({
    config: testConfig(),
    extractor: async () => {
      await new Promise((r) => setTimeout(r, 20));
      return "# Konten";
    },
  });
  t.after(() => app.close());

  // Pause queue via API
  const pauseRes = await app.inject({
    method: "POST",
    url: "/v1/queue/pause",
  });
  assert.equal(pauseRes.statusCode, 200);
  assert.equal(pauseRes.json().paused, true);

  // Upload job 1 & job 2
  const upload1 = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    ...multipartPdf("file", "%PDF-1.7\none", "one.pdf"),
  });
  const upload2 = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    ...multipartPdf("file", "%PDF-1.7\ntwo", "two.pdf"),
  });

  const job1Id = upload1.json().job.id;
  const job2Id = upload2.json().job.id;

  // Cancel job2 saat masih di antrean
  const cancelRes = await app.inject({
    method: "POST",
    url: `/v1/jobs/${job2Id}/cancel`,
  });
  assert.equal(cancelRes.statusCode, 200);
  assert.equal(cancelRes.json().job.status, "failed");
  assert.equal(cancelRes.json().job.error, "Dibatalkan oleh pengguna.");

  // Resume queue via API
  const resumeRes = await app.inject({
    method: "POST",
    url: "/v1/queue/resume",
  });
  assert.equal(resumeRes.statusCode, 200);
  assert.equal(resumeRes.json().paused, false);

  await app.jobs.waitForIdle();

  const check1 = await app.inject({ method: "GET", url: `/v1/jobs/${job1Id}` });
  assert.equal(check1.json().job.status, "completed");

  const check2 = await app.inject({ method: "GET", url: `/v1/jobs/${job2Id}` });
  assert.equal(check2.json().job.status, "failed");
  assert.equal(check2.json().job.error, "Dibatalkan oleh pengguna.");
});

