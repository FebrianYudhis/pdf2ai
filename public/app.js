import Swal from "/vendor/sweetalert2.esm.all.min.js";
import { elements } from "/app-elements.js";
import {
  api,
  formatBytes,
  formatDuration,
  formatLastUpdated,
  formatTime,
} from "/app-utils.js";
import { createConfigurationController } from "/configuration-controller.js";
import { initializeMobileMenu } from "/mobile-menu.js";

initializeMobileMenu(elements);

const statusLabels = {
  queued: "Mengantre",
  processing: "Memproses",
  completed: "Selesai",
  failed: "Gagal",
};

const actionIconPaths = {
  result:
    "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Zm9.5-2.75a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z",
  ai: "m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3ZM5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15Zm14-12 .6 1.4L21 5l-1.4.6L19 7l-.6-1.4L17 5l1.4-.6L19 3Z",
  api: "m8 8-4 4 4 4m8-8 4 4-4 4m-3-10-2 12",
  folder:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm6 6h6m-3-3 3 3-3 3",
  cancel:
    "M18.3 5.71a1 1 0 0 0-1.42 0L12 10.59 7.12 5.71a1 1 0 0 0-1.42 1.42L10.59 12l-4.89 4.88a1 1 0 0 0 1.42 1.42L12 13.41l4.88 4.89a1 1 0 0 0 1.42-1.42L13.41 12l4.89-4.88a1 1 0 0 0 0-1.41Z",
  danger: "M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13m-8 4v5m4-5v5",
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
let searchQuery = "";
const selectedJobIds = new Set();

if (elements.toastRegion && typeof elements.toastRegion.showPopover === "function") {
  try {
    elements.toastRegion.showPopover();
  } catch {
    // fallback if browser doesn't support popover
  }
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.textContent = message;
  elements.toastRegion?.append(toast);

  if (elements.toastRegion && typeof elements.toastRegion.showPopover === "function") {
    try {
      elements.toastRegion.hidePopover();
    } catch {}
    try {
      elements.toastRegion.showPopover();
    } catch {}
  }

  window.setTimeout(() => {
    toast.remove();
    if (elements.toastRegion && elements.toastRegion.children.length === 0) {
      try {
        elements.toastRegion.hidePopover();
      } catch {}
    }
  }, 4200);
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(successMessage);
  } catch {
    showToast("Browser tidak mengizinkan akses clipboard.", "error");
  }
}

function getSwalTarget() {
  return document.querySelector("dialog[open]") || document.body;
}

function showAiRequestError(job, error) {
  const message = error instanceof Error ? error.message : String(error);
  aiErrorAlertQueue = aiErrorAlertQueue
    .catch(() => undefined)
    .then(() =>
      Swal.fire({
        target: getSwalTarget(),
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

function actionIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", actionIconPaths[name]);
  svg.append(path);
  return svg;
}

function actionButton(label, className, handler, title = label, iconName = null) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = title;
  if (iconName) {
    button.append(actionIcon(iconName));
  }
  const text = document.createElement("span");
  text.textContent = label;
  button.append(text);
  button.addEventListener("click", handler);
  return button;
}

function closeJobActionMenus(except = null) {
  for (const menu of document.querySelectorAll(".job-action-menu[open]")) {
    if (menu !== except) {
      menu.removeAttribute("open");
      menu.closest(".job-card")?.classList.remove("is-action-open");
    }
  }
}

function jobActionMenu(job, buttons) {
  const menu = document.createElement("details");
  menu.className = "job-action-menu";

  const trigger = document.createElement("summary");
  trigger.className = "job-action-trigger";
  trigger.setAttribute("role", "button");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", `Buka aksi untuk ${job.originalName}`);
  trigger.title = "Aksi dokumen";
  trigger.textContent = "•••";

  const panel = document.createElement("div");
  panel.className = "job-action-panel";
  panel.setAttribute("role", "menu");
  for (const button of buttons) {
    button.setAttribute("role", "menuitem");
    panel.append(button);
  }

  menu.addEventListener("toggle", () => {
    trigger.setAttribute("aria-expanded", String(menu.open));
    menu.closest(".job-card")?.classList.toggle("is-action-open", menu.open);
    if (menu.open) {
      closeJobActionMenus(menu);
    }
  });
  panel.addEventListener("click", () => {
    menu.removeAttribute("open");
    menu.closest(".job-card")?.classList.remove("is-action-open");
  });
  menu.append(trigger, panel);
  return menu;
}

document.addEventListener("click", (event) => {
  closeJobActionMenus(event.target.closest(".job-action-menu"));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeJobActionMenus();
  }
});

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

function setFolderFilter(filter, { syncUploadFolder = true } = {}) {
  activeFolderFilter = filter;
  currentJobsPage = 1;
  updateFolderFilterState();
  if (syncUploadFolder) {
    if (filter === "unfiled") {
      elements.uploadFolder.value = "";
    } else if (virtualFolders.some((folder) => folder.id === filter)) {
      elements.uploadFolder.value = filter;
    }
  }
  renderJobs(latestJobs);
}

function syncFolderFilterFromUploadDestination() {
  setFolderFilter(elements.uploadFolder.value || "unfiled", {
    syncUploadFolder: false,
  });
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
  let list = jobs;
  if (activeFolderFilter === "unfiled") {
    list = list.filter((job) => !job.folderId);
  } else if (activeFolderFilter !== "all") {
    list = list.filter((job) => job.folderId === activeFolderFilter);
  }

  const query = searchQuery.trim().toLowerCase();
  if (query) {
    list = list.filter((job) =>
      job.originalName.toLowerCase().includes(query),
    );
  }

  return list;
}

function updateBatchActionBar(pageJobs = []) {
  if (!elements.batchActionBar) {
    return;
  }

  const existingJobIds = new Set(latestJobs.map((j) => j.id));
  for (const id of selectedJobIds) {
    if (!existingJobIds.has(id)) {
      selectedJobIds.delete(id);
    }
  }

  const count = selectedJobIds.size;
  if (count === 0) {
    elements.batchActionBar.hidden = true;
    if (elements.batchSelectAllCheckbox) {
      elements.batchSelectAllCheckbox.checked = false;
      elements.batchSelectAllCheckbox.indeterminate = false;
    }
    return;
  }

  elements.batchActionBar.hidden = false;
  if (elements.batchSelectedCount) {
    elements.batchSelectedCount.textContent = `${count} dokumen dipilih`;
  }

  if (elements.batchSelectAllCheckbox) {
    const allPageSelected =
      pageJobs.length > 0 && pageJobs.every((j) => selectedJobIds.has(j.id));
    const somePageSelected =
      !allPageSelected && pageJobs.some((j) => selectedJobIds.has(j.id));

    elements.batchSelectAllCheckbox.checked = allPageSelected;
    elements.batchSelectAllCheckbox.indeterminate = somePageSelected;
  }
}

async function batchMoveSelected() {
  const count = selectedJobIds.size;
  if (count === 0) {
    return;
  }

  const inputOptions = { __unfiled__: "Tanpa folder" };
  for (const folder of virtualFolders) {
    inputOptions[folder.id] = folder.name;
  }

  const result = await Swal.fire({
    target: getSwalTarget(),
    title: "Pindahkan Dokumen Terpilih",
    text: `Pindahkan ${count} dokumen terpilih ke folder tujuan:`,
    input: "select",
    inputOptions,
    inputValue: "__unfiled__",
    showCancelButton: true,
    confirmButtonText: "Pindahkan Semua",
    cancelButtonText: "Batal",
    customClass: { popup: "pdf2ai-swal-popup", title: "pdf2ai-swal-title" },
  });

  if (!result.isConfirmed) {
    return;
  }

  const folderId = result.value === "__unfiled__" ? null : result.value;
  const targetIds = Array.from(selectedJobIds);

  let successCount = 0;
  await Promise.allSettled(
    targetIds.map(async (id) => {
      await api(`/v1/jobs/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      successCount++;
    }),
  );

  selectedJobIds.clear();
  await refreshJobs({ quiet: true });
  showToast(`${successCount} dokumen berhasil dipindahkan.`);
}

async function batchDeleteSelected() {
  const count = selectedJobIds.size;
  if (count === 0) {
    return;
  }

  const confirmed = await confirmDeletion({
    title: `Hapus ${count} dokumen terpilih?`,
    text: "Dokumen yang dipilih akan dihapus dari antrean dan riwayat hasil.",
    confirmButtonText: `Hapus (${count})`,
  });

  if (!confirmed) {
    return;
  }

  const targetIds = Array.from(selectedJobIds);
  let successCount = 0;
  await Promise.allSettled(
    targetIds.map(async (id) => {
      await api(`/v1/jobs/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      successCount++;
    }),
  );

  selectedJobIds.clear();
  await refreshJobs({ quiet: true });
  showToast(`${successCount} dokumen berhasil dihapus.`);
}

async function createVirtualFolder() {
  const result = await Swal.fire({
    target: getSwalTarget(),
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
    target: getSwalTarget(),
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
      target: getSwalTarget(),
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
    target: getSwalTarget(),
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

const ITEMS_PER_PAGE = 6;
let currentJobsPage = 1;

function renderPagination(totalItems) {
  if (!elements.paginationNav) return;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  if (totalPages <= 1) {
    elements.paginationNav.hidden = true;
    return;
  }

  elements.paginationNav.hidden = false;
  currentJobsPage = Math.min(Math.max(1, currentJobsPage), totalPages);

  const startItem = (currentJobsPage - 1) * ITEMS_PER_PAGE + 1;
  const endItem = Math.min(currentJobsPage * ITEMS_PER_PAGE, totalItems);

  if (elements.paginationInfo) {
    elements.paginationInfo.textContent = `Menampilkan ${startItem}–${endItem} dari ${totalItems} dokumen`;
  }
  if (elements.paginationPrev) {
    elements.paginationPrev.disabled = currentJobsPage <= 1;
  }
  if (elements.paginationNext) {
    elements.paginationNext.disabled = currentJobsPage >= totalPages;
  }

  if (elements.paginationPages) {
    elements.paginationPages.replaceChildren(
      ...Array.from({ length: totalPages }, (_, index) => {
        const pageNumber = index + 1;
        const pageBtn = document.createElement("button");
        pageBtn.type = "button";
        pageBtn.className = `pagination-page-button${pageNumber === currentJobsPage ? " active" : ""}`;
        pageBtn.textContent = String(pageNumber);
        pageBtn.setAttribute("aria-label", `Halaman ${pageNumber}`);
        if (pageNumber === currentJobsPage) {
          pageBtn.setAttribute("aria-current", "page");
        }
        pageBtn.addEventListener("click", () => {
          if (currentJobsPage !== pageNumber) {
            currentJobsPage = pageNumber;
            renderJobs(latestJobs);
          }
        });
        return pageBtn;
      }),
    );
  }
}

function renderJobs(jobs) {
  latestJobs = jobs;
  const filteredJobs = visibleJobs(jobs);
  if (filteredJobs.length === 0) {
    currentJobsPage = 1;
    if (elements.paginationNav) {
      elements.paginationNav.hidden = true;
    }
    updateBatchActionBar([], filteredJobs);
    const folder = currentFolder();
    const query = searchQuery.trim();
    if (query) {
      elements.emptyStateTitle.textContent = "Dokumen tidak ditemukan";
      elements.emptyStateCopy.textContent = `Tidak ada dokumen yang cocok dengan kata kunci “${query}”.`;
    } else {
      elements.emptyStateTitle.textContent =
        activeFolderFilter === "all" ? "Belum ada dokumen" : "Folder masih kosong";
      elements.emptyStateCopy.textContent = folder
        ? `Pilih folder “${folder.name}” saat upload atau pindahkan dokumen ke sini.`
        : activeFolderFilter === "unfiled"
          ? "Semua dokumen saat ini sudah dikelompokkan ke dalam folder."
          : "PDF yang Anda unggah akan dipantau dari halaman ini.";
    }
    elements.jobList.replaceChildren(elements.emptyState);
    return;
  }

  const totalPages = Math.ceil(filteredJobs.length / ITEMS_PER_PAGE);
  if (currentJobsPage > totalPages) {
    currentJobsPage = Math.max(1, totalPages);
  }

  const startIndex = (currentJobsPage - 1) * ITEMS_PER_PAGE;
  const pageJobs = filteredJobs.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  updateBatchActionBar(pageJobs, filteredJobs);

  const cards = pageJobs.map((job) => {
    const isSelected = selectedJobIds.has(job.id);
    const card = document.createElement("article");
    card.className = `job-card ${job.status}${isSelected ? " is-selected" : ""}`;
    card.setAttribute("role", "listitem");

    const header = document.createElement("div");
    header.className = "job-card-header";

    const main = document.createElement("div");
    main.className = "job-main";

    const selectLabel = document.createElement("label");
    selectLabel.className = "job-card-select-label";
    selectLabel.title = `Pilih ${job.originalName}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "job-card-checkbox";
    checkbox.checked = isSelected;
    checkbox.setAttribute("aria-label", `Pilih ${job.originalName}`);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", (event) => {
      if (event.target.checked) {
        selectedJobIds.add(job.id);
      } else {
        selectedJobIds.delete(job.id);
      }
      renderJobs(latestJobs);
    });
    selectLabel.append(checkbox);
    main.append(selectLabel);

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
    const isPendingAi = pendingAiRequests.has(job.id);
    const hasAi = Boolean(job.hasAiResults || (job.aiResultsCount ?? 0) > 0);
    if (isPendingAi || hasAi) {
      const aiBadge = document.createElement("button");
      aiBadge.type = "button";
      aiBadge.className = `file-ai-badge${isPendingAi ? " is-pending" : ""}`;
      const count = job.aiResultsCount ?? 1;
      aiBadge.title = isPendingAi
        ? "Jawaban AI sedang diproses di latar belakang"
        : `Dokumen ini sudah ditanyakan ke AI (${count} jawaban). Klik untuk melihat riwayat atau bertanya lagi.`;
      const aiIcon = actionIcon("ai");
      aiIcon.classList.add("file-ai-badge-icon");
      const aiText = document.createElement("span");
      aiText.textContent = isPendingAi
        ? "AI menjawab…"
        : `Tanya AI (${count})`;
      aiBadge.append(aiIcon, aiText);
      if (job.status === "completed") {
        aiBadge.addEventListener("click", (event) => {
          event.stopPropagation();
          openAskAi(job);
        });
      } else {
        aiBadge.style.cursor = "default";
      }
      metaRow.append(aiBadge);
    }
    details.append(name, metaRow);
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

    const actionButtons = [];
    if (job.status === "completed") {
      actionButtons.push(
        actionButton(
          "Lihat hasil",
          "job-menu-action result",
          () => openResult(job),
          "Lihat PDF, metadata, dan Markdown",
          "result",
        ),
      );
      const aiRequestPending = pendingAiRequests.has(job.id);
      const askAiButton = actionButton(
        aiRequestPending ? "AI menjawab…" : "Tanya AI",
        "job-menu-action ai",
        () => openAskAi(job),
        aiRequestPending
          ? "Jawaban sedang diproses di latar belakang"
          : "Ajukan pertanyaan tentang dokumen kepada AI",
        "ai",
      );
      askAiButton.setAttribute("aria-busy", String(aiRequestPending));
      actionButtons.push(askAiButton);
      actionButtons.push(
        actionButton(
          "Fetch Data",
          "job-menu-action api",
          () => openFetchData(job),
          "Lihat ID dan panduan API",
          "api",
        ),
      );
    }
    actionButtons.push(
      actionButton(
        "Pindah",
        "job-menu-action folder",
        () => moveJobToFolder(job),
        "Pindahkan dokumen ke folder virtual",
        "folder",
      ),
    );
    if (job.status === "queued" || job.status === "processing") {
      actionButtons.push(
        actionButton(
          "Batalkan",
          "job-menu-action cancel",
          () => cancelJob(job),
          "Batalkan pemrosesan dokumen ini",
          "cancel",
        ),
      );
    }
    if (job.status === "completed" || job.status === "failed") {
      actionButtons.push(
        actionButton(
          "Hapus",
          "job-menu-action danger",
          () => deleteJob(job),
          "Hapus dokumen",
          "danger",
        ),
      );
    }

    const actions = document.createElement("div");
    actions.className = "job-actions";
    actions.append(jobActionMenu(job, actionButtons));

    const footer = document.createElement("div");
    footer.className = "job-card-footer";
    footer.append(status, time);

    header.append(main, actions);
    card.append(header, footer);
    return card;
  });

  elements.jobList.replaceChildren(...cards);
  renderPagination(filteredJobs.length);
}

function updateStats(stats) {
  for (const [status, element] of Object.entries(elements.counts)) {
    element.textContent = stats[status] ?? 0;
  }
  updateQueueState(stats.paused);
}

async function refreshJobs({ quiet = false } = {}) {
  if (quiet && document.querySelector(".job-action-menu[open]")) {
    return;
  }
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
    elements.lastUpdated.textContent = formatLastUpdated();
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
  const result = await Swal.fire({
    target: getSwalTarget(),
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
  lowMemoryMode: "mode hemat memori",
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
  applicationFieldLabels,
  confirmDeletion,
});

const {
  closeConfiguration,
  createTemplateEditor,
  deleteAiConfiguration,
  generateApiKey,
  importAiModels,
  openConfiguration,
  refreshAiConfig,
  refreshApplicationConfig,
  revokeApiKey,
  saveAiConfiguration,
  saveApplicationConfig,
  selectConfigTab,
  syncForceOcrAvailability,
  syncOcrLanguageInformation,
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
  if (orderedModels.length === 0) {
    elements.askAiModel.replaceChildren(new Option("Belum ada model AI", ""));
    elements.askAiWarning.textContent =
      "Integrasi AI belum dikonfigurasi. Silakan buka Pengaturan > Integrasi AI untuk menghubungkan model AI Anda.";
    elements.askAiWarning.hidden = false;
    elements.executeAskAi.disabled = true;
  } else {
    elements.askAiWarning.hidden = true;
    elements.askAiModel.replaceChildren(
      ...orderedModels.map(
        (model) =>
          new Option(
            model === configuration.aiConfig.defaultModel
              ? `${model} (default)`
              : model,
            model,
          ),
      ),
    );
  }
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
    completed = true;
    job.hasAiResults = true;
    job.aiResultsCount = (job.aiResultsCount ?? 0) + 1;
    if (currentAiJob?.id === job.id) {
      await loadAiResults(job.id);
      elements.askAiProgress.textContent = "Jawaban berhasil disimpan.";
    }
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

async function cancelJob(job) {
  const isProcessing = job.status === "processing";
  const result = await Swal.fire({
    target: getSwalTarget(),
    title: isProcessing ? "Batalkan pemrosesan?" : "Batalkan antrean dokumen?",
    text: `Hentikan pemrosesan “${job.originalName}”?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Ya, batalkan",
    cancelButtonText: "Kembali",
    confirmButtonColor: "#ef4444",
    cancelButtonColor: "#64748b",
    customClass: {
      popup: "pdf2ai-swal-popup",
      title: "pdf2ai-swal-title",
    },
  });
  if (!result.isConfirmed) {
    return;
  }

  try {
    await api(`/v1/jobs/${encodeURIComponent(job.id)}/cancel`, {
      method: "POST",
    });
    showToast(`Dokumen “${job.originalName}” berhasil dibatalkan.`);
    await refreshJobs({ quiet: true });
  } catch (error) {
    showToast(error.message, "error");
  }
}

let queuePaused = false;

function updateQueueState(paused) {
  queuePaused = Boolean(paused);
  if (elements.queueToggleButton) {
    elements.queueToggleButton.classList.toggle("is-paused", queuePaused);
    elements.queueToggleLabel.textContent = queuePaused
      ? "Lanjutkan antrean"
      : "Jeda antrean";
    elements.queueToggleButton.title = queuePaused
      ? "Lanjutkan antrean dokumen"
      : "Jeda antrean dokumen";
    if (elements.queueIconPause && elements.queueIconResume) {
      elements.queueIconPause.hidden = queuePaused;
      elements.queueIconResume.hidden = !queuePaused;
    }
  }
  if (elements.queuePausedBanner) {
    elements.queuePausedBanner.hidden = !queuePaused;
  }
}

async function toggleQueue() {
  const nextAction = queuePaused ? "resume" : "pause";
  if (elements.queueToggleButton) {
    elements.queueToggleButton.disabled = true;
  }
  try {
    const response = await api(`/v1/queue/${nextAction}`, { method: "POST" });
    const data = await response.json();
    updateQueueState(data.paused);
    updateStats(data.stats);
    showToast(
      data.paused
        ? "Antrean dokumen dijeda."
        : "Antrean dokumen dilanjutkan.",
    );
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    if (elements.queueToggleButton) {
      elements.queueToggleButton.disabled = false;
    }
  }
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
elements.uploadFolder.addEventListener(
  "change",
  syncFolderFilterFromUploadDestination,
);
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
elements.appOcrLanguage.addEventListener("change", syncOcrLanguageInformation);
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

elements.queueToggleButton?.addEventListener("click", toggleQueue);
elements.pausedResumeAction?.addEventListener("click", toggleQueue);

elements.paginationPrev?.addEventListener("click", () => {
  if (currentJobsPage > 1) {
    currentJobsPage--;
    renderJobs(latestJobs);
  }
});

elements.paginationNext?.addEventListener("click", () => {
  const totalPages = Math.ceil(visibleJobs(latestJobs).length / ITEMS_PER_PAGE);
  if (currentJobsPage < totalPages) {
    currentJobsPage++;
    renderJobs(latestJobs);
  }
});

elements.searchDocsInput?.addEventListener("input", (event) => {
  searchQuery = event.target.value;
  if (elements.searchClearButton) {
    elements.searchClearButton.hidden = !searchQuery;
  }
  currentJobsPage = 1;
  renderJobs(latestJobs);
});

elements.searchClearButton?.addEventListener("click", () => {
  if (elements.searchDocsInput) {
    elements.searchDocsInput.value = "";
  }
  searchQuery = "";
  if (elements.searchClearButton) {
    elements.searchClearButton.hidden = true;
  }
  currentJobsPage = 1;
  renderJobs(latestJobs);
});

elements.batchSelectAllCheckbox?.addEventListener("change", (event) => {
  const filteredJobs = visibleJobs(latestJobs);
  const totalPages = Math.ceil(filteredJobs.length / ITEMS_PER_PAGE);
  const currentPage = Math.min(currentJobsPage, Math.max(1, totalPages));
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const pageJobs = filteredJobs.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  if (event.target.checked) {
    for (const job of pageJobs) {
      selectedJobIds.add(job.id);
    }
  } else {
    for (const job of pageJobs) {
      selectedJobIds.delete(job.id);
    }
  }
  renderJobs(latestJobs);
});

elements.batchMoveButton?.addEventListener("click", batchMoveSelected);
elements.batchDeleteButton?.addEventListener("click", batchDeleteSelected);
elements.batchClearButton?.addEventListener("click", () => {
  selectedJobIds.clear();
  renderJobs(latestJobs);
});

await Promise.all([checkHealth(), refreshAiConfig(), refreshApplicationConfig()]);
await refreshJobs();
refreshTimer = window.setInterval(() => {
  refreshJobs({ quiet: true });
  checkHealth();
}, 2_500);

window.addEventListener("beforeunload", () => {
  window.clearInterval(refreshTimer);
});
