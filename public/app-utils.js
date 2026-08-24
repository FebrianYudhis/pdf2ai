export function formatBytes(bytes) {
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

export function formatTime(value) {
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

export function formatLastUpdated(value = new Date()) {
  const date = new Date(value);
  const formattedDate = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const formattedTime = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(date)
    .replace(/\./g, ":");

  return `Diperbarui pukul ${formattedDate} - ${formattedTime}.`;
}

export function formatDuration(job) {
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

export function calculatePaginationPages(currentPage, totalPages, maxVisible = 7) {
  if (!Number.isInteger(totalPages) || totalPages <= 0) {
    return [];
  }
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const current = Math.min(Math.max(1, currentPage), totalPages);
  if (current <= 4) {
    return [1, 2, 3, 4, 5, "...", totalPages];
  }
  if (current >= totalPages - 3) {
    return [
      1,
      "...",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }
  return [
    1,
    "...",
    current - 1,
    current,
    current + 1,
    "...",
    totalPages,
  ];
}

export async function api(path, options = {}) {
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

