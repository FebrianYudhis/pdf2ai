import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  normalizeApplicationSettings,
  saveApplicationSettings,
} from "./application-config.js";
import { normalizeAiBaseUrl } from "./ai.js";
import { saveMfaConfig } from "./server-auth.js";

const UUID_REGEX = /^[0-9a-f-]{36}$/i;
const ALLOWED_JOB_FILES = new Set([
  "input.pdf",
  "metadata.json",
  "result.md",
  "extracted-text.txt",
]);

export class BackupError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function exportConfiguration({ applicationSettings, aiConfig }) {
  return {
    version: 1,
    type: "pdf2ai-config",
    exportedAt: new Date().toISOString(),
    applicationSettings: applicationSettings ?? {},
    aiConfig: {
      baseUrl: aiConfig?.baseUrl ?? "",
      models: aiConfig?.models ?? [],
      defaultModel: aiConfig?.defaultModel ?? "",
      templates: aiConfig?.templates ?? [],
    },
  };
}

export async function importConfiguration({
  configData,
  applicationConfigFile,
  authFile,
  mfaConfig,
}) {
  if (!configData || typeof configData !== "object") {
    throw new BackupError(400, "Format data konfigurasi tidak valid.");
  }

  let updatedAppSettings = null;
  let updatedAiConfig = null;

  // 1. Simpan Application Settings
  if (
    configData.applicationSettings &&
    typeof configData.applicationSettings === "object"
  ) {
    const normalized = normalizeApplicationSettings(
      configData.applicationSettings,
    );
    updatedAppSettings = await saveApplicationSettings(
      applicationConfigFile,
      normalized,
    );
  }

  // 2. Simpan AI Config (jika ada data dan MFA/auth terpasang)
  if (
    configData.aiConfig &&
    typeof configData.aiConfig === "object" &&
    mfaConfig
  ) {
    const aiInput = configData.aiConfig;
    if (
      aiInput.baseUrl &&
      Array.isArray(aiInput.models) &&
      aiInput.models.length > 0
    ) {
      const baseUrl = normalizeAiBaseUrl(aiInput.baseUrl);
      const models = [
        ...new Set(
          aiInput.models.map((m) => String(m).trim()).filter(Boolean),
        ),
      ];
      const defaultModel =
        aiInput.defaultModel && models.includes(aiInput.defaultModel)
          ? aiInput.defaultModel
          : models[0];

      const templates = Array.isArray(aiInput.templates)
        ? aiInput.templates
            .map((t) => ({
              id: t.id ? String(t.id).trim() : randomUUID(),
              name: String(t.name || "").trim(),
              prompt: String(t.prompt || "").trim(),
            }))
            .filter((t) => t.name && t.prompt)
        : [];

      const nextConfig = {
        ...mfaConfig,
        ai: {
          baseUrl,
          token:
            mfaConfig.ai?.baseUrl === baseUrl
              ? (mfaConfig.ai?.token ?? "")
              : "",
          models,
          defaultModel,
          templates,
          updatedAt: new Date().toISOString(),
        },
      };

      await saveMfaConfig(authFile, nextConfig);
      updatedAiConfig = nextConfig.ai;
    }
  }

  return {
    ok: true,
    applicationSettings: updatedAppSettings,
    aiConfig: updatedAiConfig,
  };
}

export async function exportDataArchive({
  dataDirectory,
  aiResultDirectory,
  folderStore,
  includePdfs = true,
}) {
  const zip = new AdmZip();
  const manifest = {
    version: 1,
    type: "pdf2ai-data",
    exportedAt: new Date().toISOString(),
    includePdfs,
    jobCount: 0,
    aiResultCount: 0,
    folderCount: 0,
  };

  // 1. Folders
  if (folderStore) {
    const foldersList = folderStore.list();
    manifest.folderCount = foldersList.length;
    zip.addFile(
      "folders.json",
      Buffer.from(JSON.stringify({ version: 1, folders: foldersList }, null, 2), "utf8"),
    );
  }

  // 2. Jobs
  try {
    const jobEntries = await readdir(dataDirectory, { withFileTypes: true });
    for (const entry of jobEntries) {
      if (!entry.isDirectory() || !UUID_REGEX.test(entry.name)) {
        continue;
      }
      const jobId = entry.name;
      const jobDir = join(dataDirectory, jobId);

      try {
        const metadataRaw = await readFile(join(jobDir, "metadata.json"));
        zip.addFile(`jobs/${jobId}/metadata.json`, metadataRaw);
        manifest.jobCount += 1;
      } catch {
        continue;
      }

      for (const optionalFile of ["result.md", "extracted-text.txt"]) {
        try {
          const content = await readFile(join(jobDir, optionalFile));
          zip.addFile(`jobs/${jobId}/${optionalFile}`, content);
        } catch {}
      }

      if (includePdfs) {
        try {
          const pdfContent = await readFile(join(jobDir, "input.pdf"));
          zip.addFile(`jobs/${jobId}/input.pdf`, pdfContent);
        } catch {}
      }
    }
  } catch {}

  // 3. AI Results
  if (aiResultDirectory) {
    try {
      const aiEntries = await readdir(aiResultDirectory, { withFileTypes: true });
      for (const entry of aiEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
          continue;
        }
        try {
          const content = await readFile(join(aiResultDirectory, entry.name));
          zip.addFile(`ai-results/${entry.name}`, content);
          manifest.aiResultCount += 1;
        } catch {}
      }
    } catch {}
  }

  // 4. Manifest
  zip.addFile(
    "manifest.json",
    Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
  );

  return zip.toBuffer();
}

export async function importDataArchive({
  zipBuffer,
  dataDirectory,
  aiResultDirectory,
  folderStore,
  jobQueue,
  aiResultStore,
}) {
  let zip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new BackupError(400, "File ZIP corrupt atau tidak dapat dibaca.");
  }

  const entries = zip.getEntries();
  if (!entries || entries.length === 0) {
    throw new BackupError(400, "File ZIP kosong.");
  }

  // Validasi seluruh entri untuk mencegah Zip-Slip / path traversal
  for (const entry of entries) {
    const entryName = entry.entryName.replace(/\\/g, "/");
    if (
      entryName.includes("..") ||
      entryName.startsWith("/") ||
      entryName.includes("\0")
    ) {
      throw new BackupError(400, `Nama file di dalam ZIP tidak aman: ${entry.entryName}`);
    }

    if (entry.isDirectory) {
      continue;
    }

    const isManifest = entryName === "manifest.json";
    const isFolders = entryName === "folders.json";
    const isAiResult = /^ai-results\/[0-9a-f-]{36}\.json$/i.test(entryName);
    const isJobFile = /^jobs\/[0-9a-f-]{36}\/[a-zA-Z0-9_.-]+$/.test(entryName);

    if (!isManifest && !isFolders && !isAiResult && !isJobFile) {
      throw new BackupError(
        400,
        `Struktur file di dalam ZIP tidak dikenali: ${entryName}`,
      );
    }

    if (isJobFile) {
      const fileName = basename(entryName);
      if (!ALLOWED_JOB_FILES.has(fileName)) {
        throw new BackupError(
          400,
          `File job tidak diizinkan di dalam ZIP: ${fileName}`,
        );
      }
    }
  }

  let importedFoldersCount = 0;
  const importedJobIds = new Set();
  const importedAiResultIds = new Set();

  await mkdir(dataDirectory, { recursive: true });
  if (aiResultDirectory) {
    await mkdir(aiResultDirectory, { recursive: true });
  }

  // Ekstraksi entri
  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }
    const entryName = entry.entryName.replace(/\\/g, "/");

    if (entryName === "folders.json" && folderStore) {
      try {
        const parsed = JSON.parse(entry.getData().toString("utf8"));
        const list = Array.isArray(parsed.folders) ? parsed.folders : (Array.isArray(parsed) ? parsed : []);
        const before = folderStore.list().length;
        await folderStore.importFolders(list);
        importedFoldersCount = folderStore.list().length - before;
      } catch {}
    } else if (entryName.startsWith("jobs/")) {
      const parts = entryName.split("/");
      const jobId = parts[1];
      const filename = parts[2];

      if (UUID_REGEX.test(jobId) && ALLOWED_JOB_FILES.has(filename)) {
        const jobDir = join(dataDirectory, jobId);
        await mkdir(jobDir, { recursive: true });
        await writeFile(join(jobDir, filename), entry.getData());
        importedJobIds.add(jobId);
      }
    } else if (entryName.startsWith("ai-results/") && aiResultDirectory) {
      const filename = basename(entryName);
      const id = filename.replace(/\.json$/, "");
      if (UUID_REGEX.test(id)) {
        await writeFile(join(aiResultDirectory, filename), entry.getData());
        importedAiResultIds.add(id);
      }
    }
  }

  // Reload stores
  if (jobQueue?.reload) {
    await jobQueue.reload();
  }
  if (aiResultStore?.reload) {
    await aiResultStore.reload();
  }
  if (folderStore?.reload) {
    await folderStore.reload();
  }

  return {
    ok: true,
    importedJobs: importedJobIds.size,
    importedAiResults: importedAiResultIds.size,
    importedFolders: importedFoldersCount,
  };
}
