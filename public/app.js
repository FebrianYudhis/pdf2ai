import Swal from "/vendor/sweetalert2.esm.all.min.js";
import { elements } from "/app-elements.js";
import { api, formatBytes, formatDuration, formatTime } from "/app-utils.js";
import { createConfigurationController } from "/configuration-controller.js";
import { initializeMobileMenu } from "/mobile-menu.js";

initializeMobileMenu(elements);

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
let latestJobs = [];
let virtualFolders = [];
let activeFolderFilter = "all";
let currentAiJob = null;
const pendingAiRequests = new Map();
let aiErrorAlertQueue = Promise.resolve();

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

function showAiRequestError(job, error) {
  const message = error instanceof Error ? error.message : String(error);
  aiErrorAlertQueue = aiErrorAlertQueue
    .catch(() => undefined)
    .then(() =>
      Swal.fire({
        target: elements.askAiDialog.open
          ? elements.askAiDialog
          : document.body,
        icon: "error",
        title: "AI gagal menjawab",
        text: `${job.originalName}: ${message}`,
        confirmButtonText: "Tutup",
        customClass: {
          popup: "pdf2ai-swal-popup",
          title: "pdf2ai-swal-title",
        },
      }),
    );
}

function syncAskAiDialogState(jobId = currentAiJob?.id) {
  if (!jobId || currentAiJob?.id !== jobId) {
    return;
  }
  const pending = pendingAiRequests.has(jobId);
  elements.executeAskAi.disabled = pending;
  elements.askAiProgress.textContent = pending
    ? "AI sedang membaca Markdown dan menyusun jawaban…"
    : "";
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

function currentFolder() {
  return virtualFolders.find((folder) => folder.id === activeFolderFilter) ?? null;
}

function updateFolderFilterState() {
  for (const button of elements.folderFilterList.querySelectorAll("[data-folder-filter]")) {
    const active = button.dataset.folderFilter === activeFolderFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "true" : "false");
  }
  elements.manageFolderButton.hidden = !currentFolder();
}

function setFolderFilter(filter) {
  activeFolderFilter = filter;
  updateFolderFilterState();
  renderJobs(latestJobs);
}

function folderFilterButton({ id, name, count, kind = "folder" }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `folder-filter ${kind}`;
  button.dataset.folderFilter = id;
  const label = document.createElement("span");
  label.textContent = name;
  const total = document.createElement("small");
  total.textContent = String(count);
  button.append(label, total);
  button.addEventListener("click", () => setFolderFilter(id));
  return button;
}

function renderFolderControls(collection) {
  virtualFolders = collection.folders;
  if (
    activeFolderFilter !== "all" &&
    activeFolderFilter !== "unfiled" &&
    !virtualFolders.some((folder) => folder.id === activeFolderFilter)
  ) {
    activeFolderFilter = "all";
  }

  elements.folderFilterList.replaceChildren(
    folderFilterButton({
      id: "all",
      name: "Semua dokumen",
      count: collection.totalJobCount,
      kind: "all",
    }),
    folderFilterButton({
      id: "unfiled",
      name: "Tanpa folder",
      count: collection.unfiledCount,
      kind: "unfiled",
    }),
    ...virtualFolders.map((folder) =>
      folderFilterButton({
        id: folder.id,
        name: folder.name,
        count: folder.jobCount,
      }),
    ),
  );
  updateFolderFilterState();

  const selectedUploadFolder = elements.uploadFolder.value;
  elements.uploadFolder.replaceChildren(
    new Option("Tanpa folder", ""),
    ...virtualFolders.map((folder) => new Option(folder.name, folder.id)),
  );
  elements.uploadFolder.value = virtualFolders.some(
    (folder) => folder.id === selectedUploadFolder,
  )
    ? selectedUploadFolder
    : "";
}

function visibleJobs(jobs) {
  if (activeFolderFilter === "all") {
    return jobs;
  }
  if (activeFolderFilter === "unfiled") {
    return jobs.filter((job) => !job.folderId);
  }
  return jobs.filter((job) => job.folderId === activeFolderFilter);
}

async function createVirtualFolder() {
  const result = await Swal.fire({
    target: document.body,
    title: "Buat folder baru",
    text: "Folder hanya mengelompokkan dokumen secara virtual.",
    input: "text",
    inputPlaceholder: "Contoh: Invoice 2026",
    inputAttributes: { maxlength: "80", autocapitalize: "sentences" },
    showCancelButton: true,
    confirmButtonText: "Buat folder",
    cancelButtonText: "Batal",
    confirmButtonColor: "#3b82f6",
    cancelButtonColor: "#64748b",
    customClass: { popup: "pdf2ai-swal-popup", title: "pdf2ai-swal-title" },
  });
  if (!result.isConfirmed) {
    return;
  }
  const name = String(result.value ?? "").trim();
  if (!name) {
    showToast("Nama folder tidak boleh kosong.", "error");
    return;
  }
  try {
    const response = await api("/v1/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const { folder } = await response.json();
    activeFolderFilter = folder.id;
    await refreshJobs({ quiet: true });
    elements.uploadFolder.value = folder.id;
    showToast(`Folder “${folder.name}” berhasil dibuat.`);
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function manageCurrentFolder() {
  const folder = currentFolder();
  if (!folder) {
    return;
  }
  const choice = await Swal.fire({
    target: document.body,
    title: folder.name,
    text: `${folder.jobCount} dokumen berada di folder ini.`,
    icon: "info",
    showCancelButton: true,
    showDenyButton: true,
    confirmButtonText: "Ubah nama",
    denyButtonText: "Hapus folder",
    cancelButtonText: "Batal",
    confirmButtonColor: "#3b82f6",
    denyButtonColor: "#ef4444",
    cancelButtonColor: "#64748b",
    customClass: { popup: "pdf2ai-swal-popup", title: "pdf2ai-swal-title" },
  });

  if (choice.isConfirmed) {
    const renamed = await Swal.fire({
      target: document.body,
      title: "Ubah nama folder",
      input: "text",
      inputValue: folder.name,
      inputAttributes: { maxlength: "80" },
      showCancelButton: true,
      confirmButtonText: "Simpan nama",
      cancelButtonText: "Batal",
      customClass: { popup: "pdf2ai-swal-popup", title: "pdf2ai-swal-title" },
    });
    const name = String(renamed.value ?? "").trim();
    if (!renamed.isConfirmed || !name || name === folder.name) {
      return;
    }
    try {
      await api(`/v1/folders/${encodeURIComponent(folder.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await refreshJobs({ quiet: true });
      showToast("Nama folder berhasil diperbarui.");
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  if (!choice.isDenied) {
    return;
  }
  const confirmed = await confirmDeletion({
    title: `Hapus folder “${folder.name}”?`,
    text: "PDF tidak ikut dihapus dan akan dipindahkan ke Tanpa folder.",
    confirmButtonText: "Hapus folder",
  });
  if (!confirmed) {
    return;
  }
  try {
    await api(`/v1/folders/${encodeURIComponent(folder.id)}`, {
      method: "DELETE",
    });
    activeFolderFilter = "unfiled";
    await refreshJobs({ quiet: true });
    showToast("Folder dihapus. Dokumen tetap aman di Tanpa folder.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function moveJobToFolder(job) {
  const inputOptions = { __unfiled__: "Tanpa folder" };
  for (const folder of virtualFolders) {
    inputOptions[folder.id] = folder.name;
  }
  const result = await Swal.fire({
    target: document.body,
    title: "Pindahkan dokumen",
    text: job.originalName,
    input: "select",
    inputOptions,
    inputValue: job.folderId ?? "__unfiled__",
    showCancelButton: true,
    confirmButtonText: "Pindahkan",
    cancelButtonText: "Batal",
    customClass: { popup: "pdf2ai-swal-popup", title: "pdf2ai-swal-title" },
  });
  if (!result.isConfirmed) {
    return;
  }
  const folderId = result.value === "__unfiled__" ? null : result.value;
  if (folderId === (job.folderId ?? null)) {
    return;
  }
  try {
    await api(`/v1/jobs/${encodeURIComponent(job.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    await refreshJobs({ quiet: true });
    showToast("Dokumen berhasil dipindahkan.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderJobs(jobs) {
  latestJobs = jobs;
  const filteredJobs = visibleJobs(jobs);
  if (filteredJobs.length === 0) {
    const folder = currentFolder();
    elements.emptyStateTitle.textContent =
      activeFolderFilter === "all" ? "Belum ada dokumen" : "Folder masih kosong";
    elements.emptyStateCopy.textContent = folder
      ? `Pilih folder “${folder.name}” saat upload atau pindahkan dokumen ke sini.`
      : activeFolderFilter === "unfiled"
        ? "Semua dokumen saat ini sudah dikelompokkan ke dalam folder."
        : "PDF yang Anda unggah akan dipantau dari halaman ini.";
    elements.jobList.replaceChildren(elements.emptyState);
    return;
  }

  const rows = filteredJobs.map((job) => {
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
    const metaRow = document.createElement("div");
    metaRow.className = "file-meta-row";
    metaRow.append(meta);
    if (job.folder) {
      const folderBadge = document.createElement("span");
      folderBadge.className = "file-folder-badge";
      folderBadge.textContent = job.folder.name;
      folderBadge.title = `Folder: ${job.folder.name}`;
      metaRow.append(folderBadge);
    }
    details.append(name, metaRow);
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
    actions.append(
      actionButton(
        "Pindah",
        "small-action folder",
        () => moveJobToFolder(job),
        "Pindahkan dokumen ke folder virtual",
      ),
    );
    if (job.status === "completed") {
      if (configuration.aiConfig.configured) {
        const aiRequestPending = pendingAiRequests.has(job.id);
        const askAiButton = actionButton(
          aiRequestPending ? "AI menjawab…" : "Tanya AI",
          "small-action ai",
          () => openAskAi(job),
          aiRequestPending
            ? "Jawaban sedang diproses di latar belakang"
            : "Ajukan pertanyaan tentang dokumen kepada AI",
        );
        askAiButton.setAttribute("aria-busy", String(aiRequestPending));
        actions.append(askAiButton);
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
    const [jobsResponse, foldersResponse] = await Promise.all([
      api("/v1/jobs"),
      api("/v1/folders"),
    ]);
    const [body, foldersBody] = await Promise.all([
      jobsResponse.json(),
      foldersResponse.json(),
    ]);
    renderFolderControls(foldersBody);
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

const applicationFieldLabels = {
  ocrDevice: "perangkat OCR",
  ocrMode: "strategi ekstraksi",
  forceOcr: "paksa OCR",
  ocrLanguage: "bahasa OCR",
  maxFileSizeMb: "batas ukuran PDF",
  aiTimeoutSeconds: "timeout AI",
  sessionHours: "durasi sesi",
};

const configuration = createConfigurationController({
  Swal,
  elements,
  api,
  formatTime,
  showToast,
  refreshJobs,
});

const {
  closeConfiguration,
  createTemplateEditor,
  deleteAiConfiguration,
  generateApiKey,
  importAiModels,
  openConfiguration,
  refreshAiConfig,
  revokeApiKey,
  saveAiConfiguration,
  saveApplicationConfig,
  selectConfigTab,
  syncForceOcrAvailability,
} = configuration;
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
    if (currentAiJob?.id === jobId) {
      renderAiResults(body.results);
    }
    return body.results;
  } catch (error) {
    if (currentAiJob?.id === jobId) {
      elements.askAiWarning.textContent = error.message;
      elements.askAiWarning.hidden = false;
    }
    return null;
  }
}

async function openAskAi(job) {
  currentAiJob = job;
  elements.askAiTitle.textContent = "Tanya AI";
  elements.askAiJobName.textContent = job.originalName;
  elements.askAiMessage.value = "";
  elements.askAiWarning.hidden = true;
  elements.aiResultCount.textContent = "Memuat…";
  const loadingResults = document.createElement("p");
  loadingResults.className = "ai-empty-copy";
  loadingResults.textContent = "Memuat riwayat jawaban…";
  elements.aiResultList.replaceChildren(loadingResults);
  elements.askAiTemplate.replaceChildren(
    new Option("Tulis manual", ""),
    ...configuration.aiConfig.templates.map(
      (template) => new Option(template.name, template.id),
    ),
  );
  const orderedModels = configuration.aiConfig.defaultModel
    ? [
        configuration.aiConfig.defaultModel,
        ...configuration.aiConfig.models.filter(
          (model) => model !== configuration.aiConfig.defaultModel,
        ),
      ]
    : configuration.aiConfig.models;
  elements.askAiModel.replaceChildren(
    ...orderedModels.map(
      (model) => new Option(
        model === configuration.aiConfig.defaultModel
          ? `${model} (default)`
          : model,
        model,
      ),
    ),
  );
  elements.askAiDialog.showModal();
  syncAskAiDialogState(job.id);
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
  const job = currentAiJob;
  if (pendingAiRequests.has(job.id)) {
    return;
  }
  const message = elements.askAiMessage.value.trim();
  if (!message) {
    elements.askAiMessage.focus();
    showToast("Tuliskan pesan untuk AI.", "error");
    return;
  }

  const request = {
    model: elements.askAiModel.value,
    message,
    templateId: elements.askAiTemplate.value || null,
  };
  pendingAiRequests.set(job.id, request);
  renderJobs(latestJobs);
  closeAskAiDialog();
  showToast(
    `Pertanyaan untuk ${job.originalName} diproses di latar belakang. Anda dapat menanyakan file lain.`,
  );
  let completed = false;
  try {
    const response = await api(
      `/v1/jobs/${encodeURIComponent(job.id)}/ai`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    await response.json();
    if (currentAiJob?.id === job.id) {
      await loadAiResults(job.id);
      elements.askAiProgress.textContent = "Jawaban berhasil disimpan.";
    }
    completed = true;
    showToast(`AI selesai menjawab ${job.originalName}.`);
  } catch (error) {
    showAiRequestError(job, error);
  } finally {
    pendingAiRequests.delete(job.id);
    renderJobs(latestJobs);
    if (currentAiJob?.id === job.id) {
      elements.executeAskAi.disabled = false;
      if (!completed) {
        elements.askAiProgress.textContent = "";
      }
    }
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
    if (elements.uploadFolder.value) {
      form.append("folderId", elements.uploadFolder.value);
    }
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

function closeOnBackdropClick(dialog, closeDialog) {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) {
      return;
    }

    const bounds = dialog.getBoundingClientRect();
    const clickedBackdrop =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;

    if (clickedBackdrop) {
      closeDialog();
    }
  });
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
elements.createFolderButton.addEventListener("click", createVirtualFolder);
elements.manageFolderButton.addEventListener("click", manageCurrentFolder);
elements.configButton.addEventListener("click", () => openConfiguration("app"));
elements.closeConfigDialog.addEventListener("click", closeConfiguration);
closeOnBackdropClick(elements.configDialog, closeConfiguration);
elements.configDialog.addEventListener("close", () => {
  elements.aiToken.value = "";
  elements.apiKeyValue.textContent = "";
  elements.apiKeyReveal.hidden = true;
});
elements.configTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectConfigTab(tab.dataset.configTab));
  tab.addEventListener("keydown", (event) => {
    let nextIndex = index;
    if (["ArrowDown", "ArrowRight"].includes(event.key)) {
      nextIndex = (index + 1) % elements.configTabs.length;
    } else if (["ArrowUp", "ArrowLeft"].includes(event.key)) {
      nextIndex = (index - 1 + elements.configTabs.length) % elements.configTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = elements.configTabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    selectConfigTab(elements.configTabs[nextIndex].dataset.configTab, { focus: true });
  });
});
elements.appOcrMode.addEventListener("change", syncForceOcrAvailability);
elements.saveAppConfig.addEventListener("click", saveApplicationConfig);
elements.aiImportModels.addEventListener("click", importAiModels);
elements.addAiTemplate.addEventListener("click", () => {
  elements.aiTemplateList.append(createTemplateEditor());
  elements.aiTemplateEmpty.hidden = true;
});
elements.saveAiConfig.addEventListener("click", saveAiConfiguration);
elements.deleteAiConfig.addEventListener("click", deleteAiConfiguration);
elements.closeAskAiDialog.addEventListener("click", closeAskAiDialog);
closeOnBackdropClick(elements.askAiDialog, closeAskAiDialog);
elements.askAiDialog.addEventListener("close", () => {
  currentAiJob = null;
});
elements.askAiTemplate.addEventListener("change", () => {
  const template = configuration.aiConfig.templates.find(
    (candidate) => candidate.id === elements.askAiTemplate.value,
  );
  elements.askAiMessage.value = template?.prompt ?? "";
  elements.askAiMessage.focus();
});
elements.executeAskAi.addEventListener("click", executeAskAi);
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
closeOnBackdropClick(elements.dialog, closeResultDialog);
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
closeOnBackdropClick(elements.fetchDialog, () => elements.fetchDialog.close());

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
