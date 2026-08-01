import Swal from "/vendor/sweetalert2.esm.all.min.js";

const elements = {
  mobileMenuButton: document.querySelector("#mobile-menu-button"),
  topbarActions: document.querySelector("#topbar-actions"),
  serviceStatus: document.querySelector("#service-status"),
  serviceStatusText: document.querySelector("#service-status-text"),
  aiConfigButton: document.querySelector("#ai-config-button"),
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
  fetchAiResultsUrl: document.querySelector("#fetch-ai-results-url"),
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
  aiConfigDialog: document.querySelector("#ai-config-dialog"),
  closeAiConfigDialog: document.querySelector("#close-ai-config-dialog"),
  aiConfigStatusText: document.querySelector("#ai-config-status-text"),
  aiConfigStatusMeta: document.querySelector("#ai-config-status-meta"),
  aiBaseUrl: document.querySelector("#ai-base-url"),
  aiToken: document.querySelector("#ai-token"),
  aiTokenHint: document.querySelector("#ai-token-hint"),
  aiImportModels: document.querySelector("#ai-import-models"),
  aiModelList: document.querySelector("#ai-model-list"),
  aiDefaultModel: document.querySelector("#ai-default-model"),
  aiTemplateList: document.querySelector("#ai-template-list"),
  aiTemplateEmpty: document.querySelector("#ai-template-empty"),
  addAiTemplate: document.querySelector("#add-ai-template"),
  aiConfigWarning: document.querySelector("#ai-config-warning"),
  deleteAiConfig: document.querySelector("#delete-ai-config"),
  saveAiConfig: document.querySelector("#save-ai-config"),
  askAiDialog: document.querySelector("#ask-ai-dialog"),
  closeAskAiDialog: document.querySelector("#close-ask-ai-dialog"),
  askAiTitle: document.querySelector("#ask-ai-title"),
  askAiJobName: document.querySelector("#ask-ai-job-name"),
  askAiTemplate: document.querySelector("#ask-ai-template"),
  askAiModel: document.querySelector("#ask-ai-model"),
  askAiMessage: document.querySelector("#ask-ai-message"),
  askAiWarning: document.querySelector("#ask-ai-warning"),
  aiResultCount: document.querySelector("#ai-result-count"),
  aiResultList: document.querySelector("#ai-result-list"),
  askAiProgress: document.querySelector("#ask-ai-progress"),
  executeAskAi: document.querySelector("#execute-ask-ai"),
  toastRegion: document.querySelector("#toast-region"),
};

function setMobileMenuOpen(open) {
  elements.topbarActions?.classList.toggle("is-open", open);
  elements.mobileMenuButton?.classList.toggle("is-open", open);
  elements.mobileMenuButton?.setAttribute("aria-expanded", String(open));
  elements.mobileMenuButton?.setAttribute(
    "aria-label",
    open ? "Tutup menu navigasi" : "Buka menu navigasi",
  );
}

elements.mobileMenuButton?.addEventListener("click", () => {
  const isOpen = elements.mobileMenuButton.getAttribute("aria-expanded") === "true";
  setMobileMenuOpen(!isOpen);
});

elements.topbarActions?.addEventListener("click", (event) => {
  if (event.target.closest("a, button")) {
    setMobileMenuOpen(false);
  }
});

document.addEventListener("click", (event) => {
  if (
    elements.mobileMenuButton?.getAttribute("aria-expanded") === "true" &&
    !event.target.closest(".topbar-inner")
  ) {
    setMobileMenuOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMobileMenuOpen(false);
  }
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 600) {
    setMobileMenuOpen(false);
  }
});

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
let latestJobs = [];
let importedAiModels = [];
let importedAiBaseUrl = "";
let currentAiJob = null;
let aiConfig = {
  configured: false,
  baseUrl: "",
  hasToken: false,
  tokenHint: null,
  models: [],
  defaultModel: null,
  templates: [],
  updatedAt: null,
};

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
  latestJobs = jobs;
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
      if (aiConfig.configured) {
        actions.append(
          actionButton(
            "Tanya AI",
            "small-action ai",
            () => openAskAi(job),
            "Ajukan pertanyaan tentang dokumen kepada AI",
          ),
        );
      }
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
    const response = await fetch("/v1/health");
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

async function confirmDeletion({ title, text, confirmButtonText = "Hapus" }) {
  const target = document.querySelector("dialog[open]") ?? document.body;
  const result = await Swal.fire({
    target,
    title,
    text,
    icon: "warning",
    showCancelButton: true,
    reverseButtons: true,
    focusCancel: true,
    confirmButtonText,
    cancelButtonText: "Batal",
    confirmButtonColor: "#ef4444",
    cancelButtonColor: "#64748b",
    customClass: {
      popup: "pdf2ai-swal-popup",
      title: "pdf2ai-swal-title",
    },
  });
  return result.isConfirmed;
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
  if (
    !(await confirmDeletion({
      title: "Cabut API key?",
      text: "Client eksternal akan langsung kehilangan akses ke seluruh endpoint terproteksi.",
      confirmButtonText: "Cabut API key",
    }))
  ) {
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

function renderAiConfigStatus() {
  elements.aiConfigStatusText.textContent = aiConfig.configured
    ? "AI siap digunakan"
    : "Belum dikonfigurasi";
  const details = [];
  if (aiConfig.models.length > 0) {
    details.push(`${aiConfig.models.length} model`);
  }
  if (aiConfig.defaultModel) {
    details.push(`default ${aiConfig.defaultModel}`);
  }
  if (aiConfig.hasToken) {
    details.push(`token ${aiConfig.tokenHint}`);
  }
  if (aiConfig.updatedAt) {
    details.push(`diperbarui ${formatTime(aiConfig.updatedAt)}`);
  }
  elements.aiConfigStatusMeta.textContent = details.join(" · ") ||
    "Hubungkan provider OpenAI-compatible untuk mengaktifkan Tanya AI.";
  elements.deleteAiConfig.disabled = !aiConfig.configured;
  elements.aiTokenHint.textContent = aiConfig.hasToken
    ? `Token tersimpan: ${aiConfig.tokenHint}. Kosongkan untuk mempertahankannya.`
    : "Token opsional untuk provider lokal dan tidak pernah ditampilkan kembali.";
}

async function refreshAiConfig() {
  try {
    const response = await api("/auth/ai-config");
    aiConfig = await response.json();
    importedAiModels = [...aiConfig.models];
    importedAiBaseUrl = aiConfig.baseUrl;
    renderAiConfigStatus();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderImportedModels() {
  const preferredDefault = elements.aiDefaultModel.value || aiConfig.defaultModel;
  if (importedAiModels.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "Belum ada model yang diimpor.";
    elements.aiModelList.replaceChildren(empty);
    elements.aiDefaultModel.replaceChildren(
      new Option("Import model terlebih dahulu", ""),
    );
    elements.aiDefaultModel.disabled = true;
    return;
  }
  elements.aiModelList.replaceChildren(
    ...importedAiModels.map((model) => {
      const item = document.createElement("code");
      item.textContent = model;
      return item;
    }),
  );
  elements.aiDefaultModel.replaceChildren(
    ...importedAiModels.map((model) => new Option(model, model)),
  );
  elements.aiDefaultModel.value = importedAiModels.includes(preferredDefault)
    ? preferredDefault
    : importedAiModels[0];
  elements.aiDefaultModel.disabled = false;
}

function createTemplateEditor(template = {}) {
  const editor = document.createElement("article");
  editor.className = "ai-template-editor";
  editor.dataset.templateId = template.id || crypto.randomUUID();

  const nameField = document.createElement("label");
  nameField.className = "form-field";
  const nameLabel = document.createElement("span");
  nameLabel.textContent = "Nama template";
  const name = document.createElement("input");
  name.type = "text";
  name.maxLength = 100;
  name.placeholder = "Contoh: Ringkasan eksekutif";
  name.value = template.name || "";
  name.dataset.templateName = "";
  nameField.append(nameLabel, name);

  const promptField = document.createElement("label");
  promptField.className = "form-field ai-template-prompt";
  const promptLabel = document.createElement("span");
  promptLabel.textContent = "Isi pertanyaan";
  const prompt = document.createElement("textarea");
  prompt.rows = 4;
  prompt.maxLength = 20_000;
  prompt.placeholder = "Tuliskan instruksi yang dapat dipakai berulang kali…";
  prompt.value = template.prompt || "";
  prompt.dataset.templatePrompt = "";
  promptField.append(promptLabel, prompt);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "text-button danger-text-button";
  remove.textContent = "Hapus template";
  remove.addEventListener("click", () => {
    editor.remove();
    elements.aiTemplateEmpty.hidden = elements.aiTemplateList.children.length > 0;
  });

  editor.append(nameField, promptField, remove);
  return editor;
}

function renderTemplateEditors(templates) {
  elements.aiTemplateList.replaceChildren(
    ...templates.map((template) => createTemplateEditor(template)),
  );
  elements.aiTemplateEmpty.hidden = templates.length > 0;
}

function collectTemplates() {
  return [...elements.aiTemplateList.children].map((editor) => ({
    id: editor.dataset.templateId,
    name: editor.querySelector("[data-template-name]").value.trim(),
    prompt: editor.querySelector("[data-template-prompt]").value.trim(),
  }));
}

async function openAiConfigDialog() {
  elements.aiConfigWarning.hidden = true;
  elements.aiToken.value = "";
  elements.aiConfigDialog.showModal();
  await refreshAiConfig();
  elements.aiBaseUrl.value = aiConfig.baseUrl;
  renderImportedModels();
  renderTemplateEditors(aiConfig.templates);
}

function closeAiConfigDialog() {
  elements.aiToken.value = "";
  elements.aiConfigDialog.close();
}

async function importAiModels() {
  const baseUrl = elements.aiBaseUrl.value.trim();
  if (!baseUrl) {
    elements.aiBaseUrl.focus();
    showToast("Isi Base URL AI terlebih dahulu.", "error");
    return;
  }
  const payload = { baseUrl };
  if (elements.aiToken.value) {
    payload.token = elements.aiToken.value;
  }
  elements.aiImportModels.disabled = true;
  elements.aiImportModels.textContent = "Memeriksa…";
  elements.aiConfigWarning.hidden = true;
  try {
    const response = await api("/auth/ai-config/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    elements.aiBaseUrl.value = result.baseUrl;
    importedAiModels = result.models;
    importedAiBaseUrl = result.baseUrl;
    renderImportedModels();
    showToast(`${result.models.length} model berhasil diimpor.`);
  } catch (error) {
    elements.aiConfigWarning.textContent = error.message;
    elements.aiConfigWarning.hidden = false;
  } finally {
    elements.aiImportModels.disabled = false;
    elements.aiImportModels.textContent = "Cek & import model";
  }
}

async function saveAiConfiguration() {
  const templates = collectTemplates();
  if (templates.some((template) => !template.name || !template.prompt)) {
    showToast("Lengkapi nama dan isi semua template.", "error");
    return;
  }
  if (importedAiModels.length === 0) {
    showToast("Cek koneksi dan import model terlebih dahulu.", "error");
    return;
  }
  if (elements.aiBaseUrl.value.trim().replace(/\/+$/, "") !== importedAiBaseUrl) {
    showToast("Base URL berubah. Cek dan import model kembali.", "error");
    return;
  }
  const payload = {
    baseUrl: elements.aiBaseUrl.value.trim(),
    models: importedAiModels,
    defaultModel: elements.aiDefaultModel.value,
    templates,
  };
  if (elements.aiToken.value) {
    payload.token = elements.aiToken.value;
  }

  elements.saveAiConfig.disabled = true;
  elements.aiConfigWarning.hidden = true;
  try {
    const response = await api("/auth/ai-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    aiConfig = await response.json();
    importedAiModels = [...aiConfig.models];
    importedAiBaseUrl = aiConfig.baseUrl;
    renderAiConfigStatus();
    renderJobs(latestJobs);
    closeAiConfigDialog();
    showToast("Konfigurasi AI berhasil disimpan.");
  } catch (error) {
    elements.aiConfigWarning.textContent = error.message;
    elements.aiConfigWarning.hidden = false;
  } finally {
    elements.saveAiConfig.disabled = false;
  }
}

async function deleteAiConfiguration() {
  if (
    !(await confirmDeletion({
      title: "Hapus konfigurasi AI?",
      text: "Base URL, token, model, dan template akan dihapus. Hasil Tanya AI yang sudah tersimpan tetap tersedia.",
      confirmButtonText: "Hapus konfigurasi",
    }))
  ) {
    return;
  }
  try {
    await api("/auth/ai-config", { method: "DELETE" });
    aiConfig = {
      configured: false,
      baseUrl: "",
      hasToken: false,
      tokenHint: null,
      models: [],
      defaultModel: null,
      templates: [],
      updatedAt: null,
    };
    importedAiModels = [];
    importedAiBaseUrl = "";
    renderJobs(latestJobs);
    closeAiConfigDialog();
    showToast("Konfigurasi AI telah dihapus.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderAiResults(results) {
  elements.aiResultCount.textContent = `${results.length} hasil`;
  if (results.length === 0) {
    const empty = document.createElement("p");
    empty.className = "ai-empty-copy";
    empty.textContent = "Belum ada jawaban AI untuk dokumen ini.";
    elements.aiResultList.replaceChildren(empty);
    return;
  }

  elements.aiResultList.replaceChildren(
    ...results.map((result) => {
      const card = document.createElement("article");
      card.className = "ai-result-card";

      const header = document.createElement("div");
      header.className = "ai-result-card-header";
      const meta = document.createElement("div");
      const model = document.createElement("code");
      model.textContent = result.providerModel || result.model;
      const time = document.createElement("small");
      time.textContent = formatTime(result.createdAt);
      meta.append(model, time);

      const actions = document.createElement("div");
      actions.className = "ai-result-card-actions";
      const resultUrl = new URL(
        result.resultUrl ??
          `/v1/jobs/${encodeURIComponent(result.jobId)}/ai/${encodeURIComponent(result.id)}`,
        window.location.origin,
      ).href;
      const copyLink = document.createElement("button");
      copyLink.type = "button";
      copyLink.className = "endpoint-copy-button";
      copyLink.textContent = "Salin link";
      copyLink.title = "Salin endpoint GET untuk hasil AI ini";
      copyLink.dataset.fetchUrl = resultUrl;
      copyLink.addEventListener("click", () =>
        copyText(
          resultUrl,
          "Link fetch hasil AI disalin.",
        ),
      );
      const copyAnswer = document.createElement("button");
      copyAnswer.type = "button";
      copyAnswer.className = "endpoint-copy-button";
      copyAnswer.textContent = "Salin jawaban";
      copyAnswer.addEventListener("click", () =>
        copyText(result.content, "Jawaban AI disalin."),
      );
      actions.append(copyLink, copyAnswer);
      header.append(meta, actions);

      const prompt = document.createElement("details");
      prompt.className = "ai-result-prompt";
      const summary = document.createElement("summary");
      summary.textContent = "Lihat pertanyaan";
      const promptCopy = document.createElement("p");
      promptCopy.textContent = result.prompt;
      prompt.append(summary, promptCopy);

      const content = document.createElement("pre");
      content.textContent = result.content;
      card.append(header, prompt, content);
      return card;
    }),
  );
}

async function loadAiResults(jobId) {
  try {
    const response = await api(`/v1/jobs/${encodeURIComponent(jobId)}/ai`);
    const body = await response.json();
    renderAiResults(body.results);
  } catch (error) {
    elements.askAiWarning.textContent = error.message;
    elements.askAiWarning.hidden = false;
  }
}

async function openAskAi(job) {
  currentAiJob = job;
  elements.askAiTitle.textContent = "Tanya AI";
  elements.askAiJobName.textContent = job.originalName;
  elements.askAiMessage.value = "";
  elements.askAiWarning.hidden = true;
  elements.askAiProgress.textContent = "";
  elements.askAiTemplate.replaceChildren(
    new Option("Tulis manual", ""),
    ...aiConfig.templates.map(
      (template) => new Option(template.name, template.id),
    ),
  );
  const orderedModels = aiConfig.defaultModel
    ? [
        aiConfig.defaultModel,
        ...aiConfig.models.filter((model) => model !== aiConfig.defaultModel),
      ]
    : aiConfig.models;
  elements.askAiModel.replaceChildren(
    ...orderedModels.map(
      (model) => new Option(
        model === aiConfig.defaultModel ? `${model} (default)` : model,
        model,
      ),
    ),
  );
  elements.askAiDialog.showModal();
  await loadAiResults(job.id);
}

function closeAskAiDialog() {
  currentAiJob = null;
  elements.askAiDialog.close();
}

async function executeAskAi() {
  if (!currentAiJob) {
    return;
  }
  const message = elements.askAiMessage.value.trim();
  if (!message) {
    elements.askAiMessage.focus();
    showToast("Tuliskan pesan untuk AI.", "error");
    return;
  }

  elements.executeAskAi.disabled = true;
  elements.askAiWarning.hidden = true;
  elements.askAiProgress.textContent = "AI sedang membaca Markdown dan menyusun jawaban…";
  try {
    const response = await api(
      `/v1/jobs/${encodeURIComponent(currentAiJob.id)}/ai`,
      {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: elements.askAiModel.value,
        message,
        templateId: elements.askAiTemplate.value || null,
      }),
      },
    );
    await response.json();
    await loadAiResults(currentAiJob.id);
    elements.askAiProgress.textContent = "Jawaban berhasil disimpan.";
    showToast("AI selesai menjawab dokumen.");
  } catch (error) {
    elements.askAiWarning.textContent = error.message;
    elements.askAiWarning.hidden = false;
    elements.askAiProgress.textContent = "";
  } finally {
    elements.executeAskAi.disabled = false;
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
  const aiResultsUrl =
    job.aiResultsUrl ?? `/v1/jobs/${job.id}/ai`;
  const absoluteUrl = (path) => new URL(path, window.location.origin).href;
  const metadata = {
    ...job,
    jobUrl: absoluteUrl(jobUrl),
    pdfUrl: absoluteUrl(pdfUrl),
    markdownUrl: absoluteUrl(markdownUrl),
    aiResultsUrl: absoluteUrl(aiResultsUrl),
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

async function ambilDokumen(id) {
  const statusResponse = await fetch(\`\${baseUrl}/v1/jobs/\${id}\`, {
    headers,
  });

  if (!statusResponse.ok) {
    throw new Error(\`Dokumen tidak ditemukan (\${statusResponse.status})\`);
  }

  const { job } = await statusResponse.json();
  if (job.status !== "completed") {
    throw new Error(\`Dokumen belum selesai: \${job.status}\`);
  }

  const [pdfResponse, markdownResponse, aiResultsResponse] = await Promise.all([
    fetch(\`\${baseUrl}\${job.pdfUrl}\`, { headers }),
    fetch(\`\${baseUrl}\${job.markdownUrl}\`, { headers }),
    fetch(\`\${baseUrl}\${job.aiResultsUrl}\`, { headers }),
  ]);

  if (!pdfResponse.ok || !markdownResponse.ok || !aiResultsResponse.ok) {
    throw new Error("Data dokumen tidak dapat diambil.");
  }

  const [pdf, markdown, ai] = await Promise.all([
    pdfResponse.blob(),
    markdownResponse.text(),
    aiResultsResponse.json(),
  ]);

  return { metadata: job, pdf, markdown, aiResults: ai.results };
}

async function hapusDokumen(jobUrl) {
  const response = await fetch(\`\${baseUrl}\${jobUrl}\`, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    throw new Error(\`Dokumen gagal dihapus (\${response.status})\`);
  }
}

const dokumen = await ambilDokumen(${JSON.stringify(job.id)});
console.log(dokumen.markdown, dokumen.aiResults);

// Jalankan hanya ketika data memang ingin dihapus:
// await hapusDokumen(dokumen.metadata.jobUrl);`;
}

function openFetchData(job) {
  const baseUrl = window.location.origin;
  const jobUrl = job.jobUrl ?? `/v1/jobs/${job.id}`;
  const pdfUrl = job.pdfUrl ?? `/v1/jobs/${job.id}/pdf`;
  const markdownUrl =
    job.markdownUrl ?? `/v1/jobs/${job.id}/markdown`;
  const aiResultsUrl =
    job.aiResultsUrl ?? `/v1/jobs/${job.id}/ai`;

  elements.fetchDialogTitle.textContent = job.originalName;
  elements.fetchJobId.textContent = job.id;
  elements.fetchMetadataUrl.textContent = `${baseUrl}${jobUrl}`;
  elements.fetchPdfUrl.textContent = `${baseUrl}${pdfUrl}`;
  elements.fetchMarkdownUrl.textContent = `${baseUrl}${markdownUrl}`;
  elements.fetchAiResultsUrl.textContent = `${baseUrl}${aiResultsUrl}`;
  elements.fetchDeleteUrl.textContent = `${baseUrl}${jobUrl}`;
  elements.fetchDownloadPdf.href = `${pdfUrl}?download=1`;
  elements.fetchDownloadMarkdown.href = `${markdownUrl}?download=1`;
  currentFetchExample = createFetchExample(job);
  elements.fetchCode.textContent = currentFetchExample;
  elements.fetchDialog.showModal();
}

async function deleteJob(job) {
  const confirmed = await confirmDeletion({
    title: `Hapus “${job.originalName}”?`,
    text: "PDF, Markdown, metadata, dan seluruh hasil Tanya AI akan dihapus secara permanen.",
    confirmButtonText: "Hapus permanen",
  });
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
elements.aiConfigButton.addEventListener("click", openAiConfigDialog);
elements.closeAiConfigDialog.addEventListener("click", closeAiConfigDialog);
elements.aiConfigDialog.addEventListener("click", (event) => {
  if (event.target === elements.aiConfigDialog) {
    closeAiConfigDialog();
  }
});
elements.aiConfigDialog.addEventListener("close", () => {
  elements.aiToken.value = "";
});
elements.aiImportModels.addEventListener("click", importAiModels);
elements.addAiTemplate.addEventListener("click", () => {
  elements.aiTemplateList.append(createTemplateEditor());
  elements.aiTemplateEmpty.hidden = true;
});
elements.saveAiConfig.addEventListener("click", saveAiConfiguration);
elements.deleteAiConfig.addEventListener("click", deleteAiConfiguration);
elements.closeAskAiDialog.addEventListener("click", closeAskAiDialog);
elements.askAiDialog.addEventListener("click", (event) => {
  if (event.target === elements.askAiDialog) {
    closeAskAiDialog();
  }
});
elements.askAiDialog.addEventListener("close", () => {
  currentAiJob = null;
});
elements.askAiTemplate.addEventListener("change", () => {
  const template = aiConfig.templates.find(
    (candidate) => candidate.id === elements.askAiTemplate.value,
  );
  elements.askAiMessage.value = template?.prompt ?? "";
  elements.askAiMessage.focus();
});
elements.executeAskAi.addEventListener("click", executeAskAi);
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
  await copyText(elements.fetchJobId.textContent, "ID dokumen disalin.");
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

await Promise.all([checkHealth(), refreshAiConfig()]);
await refreshJobs();
refreshTimer = window.setInterval(() => {
  refreshJobs({ quiet: true });
  checkHealth();
}, 2_500);

window.addEventListener("beforeunload", () => {
  window.clearInterval(refreshTimer);
});
