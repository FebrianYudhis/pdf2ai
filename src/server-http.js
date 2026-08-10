export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function serializeFolder(folder, jobCount = undefined) {
  return {
    ...folder,
    folderUrl: `/v1/folders/${folder.id}`,
    ...(jobCount === undefined ? {} : { jobCount }),
  };
}

export function serializeJob(job, folders) {
  const folder = folders?.find(job.folderId);
  return {
    ...job,
    // Referensi folder yang sudah tidak ada diperlakukan sebagai "Tanpa folder".
    // Ini menjaga job lama tetap terlihat bila file folder dipulihkan/diubah
    // secara terpisah dari metadata job.
    folderId: folder?.id ?? null,
    folder: folder ? serializeFolder(folder) : null,
    folderUrl: folder ? `/v1/folders/${folder.id}` : null,
    jobUrl: `/v1/jobs/${job.id}`,
    pdfUrl: `/v1/jobs/${job.id}/pdf`,
    markdownUrl:
      job.status === "completed"
        ? `/v1/jobs/${job.id}/markdown`
        : null,
    aiModelsUrl: "/v1/ai/models",
    aiResultsUrl: `/v1/jobs/${job.id}/ai`,
  };
}

export function serializeAiResult(result) {
  const aiResultsUrl = `/v1/jobs/${result.jobId}/ai`;
  return {
    ...result,
    jobUrl: `/v1/jobs/${result.jobId}`,
    aiModelsUrl: "/v1/ai/models",
    aiResultsUrl,
    resultUrl: `${aiResultsUrl}/${result.id}`,
  };
}

export function markdownFilename(originalName) {
  const withoutPdf = originalName.replace(/\.pdf$/i, "");
  return `${withoutPdf || "result"}.md`
    .replace(/["\r\n]/g, "")
    .slice(0, 180);
}

export function pdfFilename(originalName) {
  const cleaned = originalName.replace(/["\r\n]/g, "").slice(0, 180);
  if (!cleaned) {
    return "document.pdf";
  }
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}
