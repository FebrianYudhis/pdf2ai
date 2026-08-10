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
