const elements = {
  serviceStatus: document.querySelector("#service-status"),
  serviceStatusText: document.querySelector("#service-status-text"),
  apiKeyButton: document.querySelector("#api-key-button"),
  logoutButton: document.querySelector("#logout-button"),
  counts: {
    queued: document.querySelector("#count-queued"),
    processing: document.querySelector("#count-processing"),
    completed: document.querySelector("#count-completed"),
    failed: document.querySelector("#count-failed"),
  },
  dropZone: document.querySelector("#drop-zone"),
  fileInput: document.querySelector("#file-input"),
  selection: document.querySelector("#selection"),
  selectionSummary: document.querySelector("#selection-summary"),
  selectionList: document.querySelector("#selection-list"),
  clearSelection: document.querySelector("#clear-selection"),
  uploadButton: document.querySelector("#upload-button"),
  uploadButtonLabel: document.querySelector("#upload-button-label"),
  refreshButton: document.querySelector("#refresh-button"),
  lastUpdated: document.querySelector("#last-updated"),
  jobList: document.querySelector("#job-list"),
  emptyState: document.querySelector("#empty-state"),
  dialog: document.querySelector("#markdown-dialog"),
  dialogTitle: document.querySelector("#dialog-title"),
  closeDialog: document.querySelector("#close-dialog"),
  resultTabs: document.querySelectorAll("[data-result-tab]"),
  resultPanels: document.querySelectorAll("[data-result-panel]"),
  resultPdfFrame: document.querySelector("#result-pdf-frame"),
  resultMetadata: document.querySelector("#result-metadata-panel"),
  markdownContent: document.querySelector("#result-markdown-panel"),
  downloadPdf: document.querySelector("#download-pdf"),
  copyMarkdown: document.querySelector("#copy-markdown"),
  downloadMarkdown: document.querySelector("#download-markdown"),
  fetchDialog: document.querySelector("#fetch-dialog"),
  fetchDialogTitle: document.querySelector("#fetch-dialog-title"),
  closeFetchDialog: document.querySelector("#close-fetch-dialog"),
  fetchJobId: document.querySelector("#fetch-job-id"),
  copyJobId: document.querySelector("#copy-job-id"),
  fetchMetadataUrl: document.querySelector("#fetch-metadata-url"),
  fetchPdfUrl: document.querySelector("#fetch-pdf-url"),
  fetchMarkdownUrl: document.querySelector("#fetch-markdown-url"),
  fetchDeleteUrl: document.querySelector("#fetch-delete-url"),
  fetchCode: document.querySelector("#fetch-code"),
  copyFetchCode: document.querySelector("#copy-fetch-code"),
  fetchDownloadPdf: document.querySelector("#fetch-download-pdf"),
  fetchDownloadMarkdown: document.querySelector("#fetch-download-markdown"),
  apiKeyDialog: document.querySelector("#api-key-dialog"),
  closeApiKeyDialog: document.querySelector("#close-api-key-dialog"),
  apiKeyStatus: document.querySelector("#api-key-status"),
  apiKeyMetadata: document.querySelector("#api-key-metadata"),
  apiKeyReveal: document.querySelector("#api-key-reveal"),
  apiKeyValue: document.querySelector("#api-key-value"),
  apiKeyWarning: document.querySelector("#api-key-warning"),
  copyApiKey: document.querySelector("#copy-api-key"),
  generateApiKey: document.querySelector("#generate-api-key"),
  revokeApiKey: document.querySelector("#revoke-api-key"),
  toastRegion: document.querySelector("#toast-region"),
};

const statusLabels = {
  queued: "Mengantre",
  processing: "Memproses",
  completed: "Selesai",
  failed: "Gagal",
};

let selectedFiles = [];
let currentMarkdown = "";
let currentFetchExample = "";
let uploading = false;
let refreshTimer;
let apiKeyConfigured = false;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 || value >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatTime(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(job) {
  if (!job.startedAt) {
    return "Menunggu giliran";
  }
  const end = job.completedAt ? new Date(job.completedAt) : new Date();
  const seconds = Math.max(
    1,
    Math.round((end - new Date(job.startedAt)) / 1000),
  );
  if (seconds < 60) {
    return `${seconds} detik`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes} m ${remainder} d`;
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(successMessage);
  } catch {
    showToast("Browser tidak mengizinkan akses clipboard.", "error");
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `Request gagal (${response.status}).`;
    try {
      const body = await response.json();
      message = body.error || message;
    } catch {
      // Response non-JSON menggunakan pesan default.
    }
    throw new Error(message);
  }
  return response;
}

function renderSelection() {
  elements.selection.hidden = selectedFiles.length === 0;
  elements.uploadButton.disabled = selectedFiles.length === 0 || uploading;
  elements.selectionSummary.textContent = `${selectedFiles.length} file dipilih`;
  elements.selectionList.replaceChildren(
    ...selectedFiles.map((file) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const size = document.createElement("span");
      name.textContent = file.name;
      size.textContent = formatBytes(file.size);
      item.append(name, size);
      return item;
    }),
  );
}

function addFiles(files) {
  const incoming = [...files];
  const rejected = incoming.filter(
    (file) =>
      file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"),
  );
  if (rejected.length > 0) {
    showToast("Hanya file PDF yang dapat dimasukkan.", "error");
  }

  const pdfs = incoming.filter(
    (file) =>
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
  );
  const keys = new Set(
    selectedFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
  );
  for (const file of pdfs) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (!keys.has(key)) {
      selectedFiles.push(file);
      keys.add(key);
    }
  }
  renderSelection();
}

function actionButton(label, className, handler, title = label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", handler);
  return button;
}

function renderJobs(jobs) {
  if (jobs.length === 0) {
    elements.jobList.replaceChildren(elements.emptyState);
    return;
  }

  const rows = jobs.map((job) => {
    const row = document.createElement("article");
    row.className = "job-row";

    const main = document.createElement("div");
    main.className = "job-main";
    const fileIndex = document.createElement("span");
    fileIndex.className = "file-index";
    fileIndex.textContent = "PDF";
    const details = document.createElement("div");
    details.className = "file-details";
    const name = document.createElement("strong");
    name.className = "file-name";
    name.textContent = job.originalName;
    name.title = job.originalName;
    const meta = document.createElement("small");
    meta.textContent = `${formatBytes(job.size)} · ${formatTime(job.createdAt)}`;
    details.append(name, meta);
    if (job.status === "processing") {
      const progress = document.createElement("span");
      progress.className = "progress-track";
      progress.append(document.createElement("span"));
      details.append(progress);
    }
    if (job.status === "failed" && job.error) {
      const error = document.createElement("small");
      error.className = "error-copy";
      error.textContent = job.error;
      error.title = job.error;
      details.append(error);
    }
    main.append(fileIndex, details);

    const status = document.createElement("div");
    status.className = "job-status";
    const badge = document.createElement("span");
    badge.className = `status-badge ${job.status}`;
    badge.textContent = statusLabels[job.status] ?? job.status;
    status.append(badge);

    const time = document.createElement("div");
    time.className = "job-time";
    time.textContent =
      job.status === "queued"
        ? "Menunggu giliran"
        : `${formatDuration(job)}${job.completedAt ? ` · ${formatTime(job.completedAt)}` : ""}`;

    const actions = document.createElement("div");
    actions.className = "job-actions";
    if (job.status === "completed") {
      actions.append(
        actionButton(
          "Fetch Data",
          "small-action api",
          () => openFetchData(job),
          "Lihat ID dan panduan API",
        ),
        actionButton(
          "Lihat hasil",
          "small-action result",
          () => openResult(job),
          "Lihat PDF, metadata, dan Markdown",
        ),
      );
    }
    if (job.status === "completed" || job.status === "failed") {
      actions.append(
        actionButton(
          "Hapus",
          "small-action danger",
          () => deleteJob(job),
          "Hapus dokumen",
        ),
      );
    }

    row.append(main, status, time, actions);
    return row;
  });

  elements.jobList.replaceChildren(...rows);
}

function updateStats(stats) {
  for (const [status, element] of Object.entries(elements.counts)) {
    element.textContent = stats[status] ?? 0;
  }
}

async function refreshJobs({ quiet = false } = {}) {
  if (!quiet) {
    elements.refreshButton.classList.add("loading");
  }
  try {
    const response = await api("/v1/jobs");
    const body = await response.json();
    renderJobs(body.jobs);
    updateStats(body.stats);
    elements.lastUpdated.textContent = `Diperbarui pukul ${new Intl.DateTimeFormat(
      "id-ID",
      {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      },
    ).format(new Date())}.`;
  } catch (error) {
    if (!quiet) {
      showToast(error.message, "error");
    }
  } finally {
    elements.refreshButton.classList.remove("loading");
  }
}

async function checkHealth() {
  try {
    const response = await fetch("/health");
    const body = await response.json();
    elements.serviceStatus.classList.toggle("ready", response.ok);
    elements.serviceStatus.classList.toggle("error", !response.ok);
    elements.serviceStatusText.textContent = response.ok
      ? body.mode === "hybrid"
        ? "API & OCR siap"
        : "API siap"
      : "OCR belum siap";
  } catch {
    elements.serviceStatus.classList.remove("ready");
    elements.serviceStatus.classList.add("error");
    elements.serviceStatusText.textContent = "Service tidak terhubung";
  }
}

function renderApiKeyStatus(status) {
  apiKeyConfigured = status.configured;
  elements.apiKeyStatus.textContent = status.configured
    ? "API key aktif"
    : "Belum ada API key";
  elements.apiKeyMetadata.textContent = status.configured
    ? `${status.prefix}… · dibuat ${formatTime(status.createdAt)}`
    : "Buat key untuk mengaktifkan akses API eksternal.";
  elements.generateApiKey.textContent = status.configured
    ? "Rotasi API key"
    : "Buat API key";
  elements.revokeApiKey.disabled = !status.configured;
}

async function openApiKeyDialog() {
  elements.apiKeyReveal.hidden = true;
  elements.apiKeyValue.textContent = "";
  elements.apiKeyWarning.hidden = true;
  elements.apiKeyDialog.showModal();
  try {
    const response = await api("/auth/api-key");
    renderApiKeyStatus(await response.json());
  } catch (error) {
    elements.apiKeyWarning.textContent = error.message;
    elements.apiKeyWarning.hidden = false;
  }
}

function closeApiKeyDialog() {
  elements.apiKeyValue.textContent = "";
  elements.apiKeyReveal.hidden = true;
  elements.apiKeyDialog.close();
}

async function generateApiKey() {
  if (
    apiKeyConfigured &&
    !window.confirm(
      "Rotasi API key? Key lama akan langsung berhenti berfungsi.",
    )
  ) {
    return;
  }

  elements.generateApiKey.disabled = true;
  try {
    const response = await api("/auth/api-key", { method: "POST" });
    const result = await response.json();
    elements.apiKeyValue.textContent = result.apiKey;
    elements.apiKeyReveal.hidden = false;
    renderApiKeyStatus({ configured: true, ...result });
    showToast("API key baru berhasil dibuat.");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    elements.generateApiKey.disabled = false;
  }
}

async function revokeApiKey() {
  if (!window.confirm("Cabut API key aktif? Client eksternal akan kehilangan akses.")) {
    return;
  }
  elements.revokeApiKey.disabled = true;
  try {
    await api("/auth/api-key", { method: "DELETE" });
    elements.apiKeyReveal.hidden = true;
    renderApiKeyStatus({ configured: false });
    showToast("API key telah dicabut.");
  } catch (error) {
    showToast(error.message, "error");
    elements.revokeApiKey.disabled = false;
  }
}

async function uploadSelected() {
  if (uploading || selectedFiles.length === 0) {
    return;
  }

  uploading = true;
  elements.uploadButton.disabled = true;
  const files = [...selectedFiles];
  let completed = 0;

  for (const file of files) {
    elements.uploadButtonLabel.textContent =
      `Mengunggah ${completed + 1} dari ${files.length}…`;
    const form = new FormData();
    form.append("file", file, file.name);
    try {
      await api("/v1/jobs", { method: "POST", body: form });
      selectedFiles = selectedFiles.filter((candidate) => candidate !== file);
      completed += 1;
      renderSelection();
      await refreshJobs({ quiet: true });
    } catch (error) {
      showToast(`${file.name}: ${error.message}`, "error");
    }
  }

  uploading = false;
  elements.uploadButtonLabel.textContent = "Masukkan ke antrean";
  renderSelection();
  if (completed > 0) {
    showToast(`${completed} PDF berhasil masuk antrean.`);
  }
}

async function openResult(job) {
  const pdfUrl = job.pdfUrl ?? `/v1/jobs/${job.id}/pdf`;
  const markdownUrl =
    job.markdownUrl ?? `/v1/jobs/${job.id}/markdown`;
  const jobUrl = job.jobUrl ?? `/v1/jobs/${job.id}`;
  const absoluteUrl = (path) => new URL(path, window.location.origin).href;
  const metadata = {
    ...job,
    jobUrl: absoluteUrl(jobUrl),
    pdfUrl: absoluteUrl(pdfUrl),
    markdownUrl: absoluteUrl(markdownUrl),
  };

  elements.dialogTitle.textContent = job.originalName;
  elements.markdownContent.textContent = "Memuat Markdown…";
  elements.resultMetadata.textContent = JSON.stringify(metadata, null, 2);
  elements.resultPdfFrame.src = pdfUrl;
  elements.downloadPdf.href = `${pdfUrl}?download=1`;
  elements.downloadMarkdown.href = `${markdownUrl}?download=1`;
  elements.copyMarkdown.disabled = true;
  currentMarkdown = "";
  selectResultTab("markdown");
  elements.dialog.showModal();

  try {
    const response = await api(markdownUrl);
    currentMarkdown = await response.text();
    elements.markdownContent.textContent = currentMarkdown;
    elements.copyMarkdown.disabled = false;
  } catch (error) {
    elements.markdownContent.textContent =
      `Markdown tidak dapat dimuat.\n\n${error.message}`;
    showToast(error.message, "error");
  }
}

function selectResultTab(tabName) {
  for (const tab of elements.resultTabs) {
    const active = tab.dataset.resultTab === tabName;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }

  for (const panel of elements.resultPanels) {
    panel.hidden = panel.dataset.resultPanel !== tabName;
  }
}

function closeResultDialog() {
  elements.dialog.close();
  elements.resultPdfFrame.src = "about:blank";
}

function createFetchExample(job) {
  const baseUrl = window.location.origin;

  return `const baseUrl = ${JSON.stringify(baseUrl)};
const apiKey = "GANTI_DENGAN_API_KEY";
const headers = { "X-API-Key": apiKey };

async function ambilSurat(id) {
  const statusResponse = await fetch(\`\${baseUrl}/v1/jobs/\${id}\`, {
    headers,
  });

  if (!statusResponse.ok) {
    throw new Error(\`Surat tidak ditemukan (\${statusResponse.status})\`);
  }

  const { job } = await statusResponse.json();
  if (job.status !== "completed") {
    throw new Error(\`Surat belum selesai: \${job.status}\`);
  }

  const [pdfResponse, markdownResponse] = await Promise.all([
    fetch(\`\${baseUrl}\${job.pdfUrl}\`, { headers }),
    fetch(\`\${baseUrl}\${job.markdownUrl}\`, { headers }),
  ]);

  if (!pdfResponse.ok || !markdownResponse.ok) {
    throw new Error("File surat tidak dapat diambil.");
  }

  const [pdf, markdown] = await Promise.all([
    pdfResponse.blob(),
    markdownResponse.text(),
  ]);

  return { metadata: job, pdf, markdown };
}

async function hapusSurat(id) {
  const response = await fetch(\`\${baseUrl}/v1/jobs/\${id}\`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    throw new Error(\`Surat gagal dihapus (\${response.status})\`);
  }
}

const surat = await ambilSurat(${JSON.stringify(job.id)});
console.log(surat.markdown);

// Jalankan hanya ketika data memang ingin dihapus:
// await hapusSurat(${JSON.stringify(job.id)});`;
}

function openFetchData(job) {
  const baseUrl = window.location.origin;
  const jobUrl = job.jobUrl ?? `/v1/jobs/${job.id}`;
  const pdfUrl = job.pdfUrl ?? `/v1/jobs/${job.id}/pdf`;
  const markdownUrl =
    job.markdownUrl ?? `/v1/jobs/${job.id}/markdown`;

  elements.fetchDialogTitle.textContent = job.originalName;
  elements.fetchJobId.textContent = job.id;
  elements.fetchMetadataUrl.textContent = `${baseUrl}${jobUrl}`;
  elements.fetchPdfUrl.textContent = `${baseUrl}${pdfUrl}`;
  elements.fetchMarkdownUrl.textContent = `${baseUrl}${markdownUrl}`;
  elements.fetchDeleteUrl.textContent = `${baseUrl}${jobUrl}`;
  elements.fetchDownloadPdf.href = `${pdfUrl}?download=1`;
  elements.fetchDownloadMarkdown.href = `${markdownUrl}?download=1`;
  currentFetchExample = createFetchExample(job);
  elements.fetchCode.textContent = currentFetchExample;
  elements.fetchDialog.showModal();
}

async function deleteJob(job) {
  const confirmed = window.confirm(
    `Hapus "${job.originalName}" beserta PDF dan hasil Markdown-nya?`,
  );
  if (!confirmed) {
    return;
  }

  try {
    await api(`/v1/jobs/${job.id}`, { method: "DELETE" });
    showToast(`${job.originalName} telah dihapus.`);
    await refreshJobs({ quiet: true });
  } catch (error) {
    showToast(error.message, "error");
  }
}

elements.fileInput.addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
  });
}

elements.dropZone.addEventListener("drop", (event) => {
  addFiles(event.dataTransfer.files);
});

elements.clearSelection.addEventListener("click", () => {
  selectedFiles = [];
  renderSelection();
});

elements.uploadButton.addEventListener("click", uploadSelected);
elements.refreshButton.addEventListener("click", () => refreshJobs());
elements.apiKeyButton.addEventListener("click", openApiKeyDialog);
elements.closeApiKeyDialog.addEventListener("click", closeApiKeyDialog);
elements.apiKeyDialog.addEventListener("click", (event) => {
  if (event.target === elements.apiKeyDialog) {
    closeApiKeyDialog();
  }
});
elements.apiKeyDialog.addEventListener("close", () => {
  elements.apiKeyValue.textContent = "";
  elements.apiKeyReveal.hidden = true;
});
elements.generateApiKey.addEventListener("click", generateApiKey);
elements.revokeApiKey.addEventListener("click", revokeApiKey);
elements.copyApiKey.addEventListener("click", async () => {
  await copyText(elements.apiKeyValue.textContent, "API key disalin.");
});
elements.logoutButton.addEventListener("click", async () => {
  elements.logoutButton.disabled = true;
  try {
    await fetch("/logout", { method: "POST" });
  } finally {
    window.location.replace("/login");
  }
});
elements.closeDialog.addEventListener("click", closeResultDialog);
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) {
    closeResultDialog();
  }
});
elements.dialog.addEventListener("close", () => {
  elements.resultPdfFrame.src = "about:blank";
});

elements.resultTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectResultTab(tab.dataset.resultTab));
  tab.addEventListener("keydown", (event) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % elements.resultTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (index - 1 + elements.resultTabs.length) %
        elements.resultTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = elements.resultTabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = elements.resultTabs[nextIndex];
    selectResultTab(nextTab.dataset.resultTab);
    nextTab.focus();
  });
});
elements.closeFetchDialog.addEventListener("click", () =>
  elements.fetchDialog.close(),
);
elements.fetchDialog.addEventListener("click", (event) => {
  if (event.target === elements.fetchDialog) {
    elements.fetchDialog.close();
  }
});

elements.copyMarkdown.addEventListener("click", async () => {
  await copyText(currentMarkdown, "Markdown disalin ke clipboard.");
});

elements.copyJobId.addEventListener("click", async () => {
  await copyText(elements.fetchJobId.textContent, "ID surat disalin.");
});

elements.copyFetchCode.addEventListener("click", async () => {
  await copyText(currentFetchExample, "Contoh Fetch API disalin.");
});

for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", async () => {
    const target = document.querySelector(`#${button.dataset.copyTarget}`);
    const label = button.dataset.copyLabel ?? "Link";
    await copyText(target?.textContent ?? "", `${label} disalin.`);
  });
}

await Promise.all([checkHealth(), refreshJobs()]);
refreshTimer = window.setInterval(() => {
  refreshJobs({ quiet: true });
  checkHealth();
}, 2_500);

window.addEventListener("beforeunload", () => {
  window.clearInterval(refreshTimer);
});
