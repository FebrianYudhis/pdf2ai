import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export class FolderError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizeName(value) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) {
    throw new FolderError(400, "Nama folder harus berisi 1 sampai 80 karakter.");
  }
  return name;
}

function validFolder(folder) {
  return (
    folder &&
    /^[0-9a-f-]{36}$/i.test(folder.id) &&
    typeof folder.name === "string" &&
    folder.name.length > 0 &&
    folder.name.length <= 80 &&
    typeof folder.createdAt === "string" &&
    typeof folder.updatedAt === "string"
  );
}

export class FolderStore {
  constructor({ path }) {
    this.path = resolve(path);
    this.folders = new Map();
  }

  async init() {
    let contents;
    try {
      contents = await readFile(this.path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    let document;
    try {
      document = JSON.parse(contents);
    } catch {
      throw new Error(`Data folder virtual bukan JSON yang valid: ${this.path}`);
    }
    if (
      document.version !== 1 ||
      !Array.isArray(document.folders) ||
      document.folders.some((folder) => !validFolder(folder))
    ) {
      throw new Error(`Data folder virtual tidak valid: ${this.path}`);
    }
    for (const folder of document.folders) {
      this.folders.set(folder.id, folder);
    }
  }

  list() {
    return [...this.folders.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "id", { sensitivity: "base" }),
    );
  }

  find(id) {
    return id ? this.folders.get(id) ?? null : null;
  }

  get(id) {
    const folder = this.find(id);
    if (!folder) {
      throw new FolderError(404, "Folder tidak ditemukan.");
    }
    return folder;
  }

  has(id) {
    return Boolean(this.find(id));
  }

  async create(name) {
    const normalized = normalizeName(name);
    this.#assertUniqueName(normalized);
    const now = new Date().toISOString();
    const folder = {
      id: randomUUID(),
      name: normalized,
      createdAt: now,
      updatedAt: now,
    };
    this.folders.set(folder.id, folder);
    try {
      await this.#persist();
    } catch (error) {
      this.folders.delete(folder.id);
      throw error;
    }
    return folder;
  }

  async rename(id, name) {
    const current = this.get(id);
    const normalized = normalizeName(name);
    this.#assertUniqueName(normalized, id);
    const folder = {
      ...current,
      name: normalized,
      updatedAt: new Date().toISOString(),
    };
    this.folders.set(id, folder);
    try {
      await this.#persist();
    } catch (error) {
      this.folders.set(id, current);
      throw error;
    }
    return folder;
  }

  async delete(id) {
    const folder = this.get(id);
    this.folders.delete(id);
    try {
      await this.#persist();
    } catch (error) {
      this.folders.set(id, folder);
      throw error;
    }
    return folder;
  }

  #assertUniqueName(name, ignoredId = null) {
    const duplicate = this.list().find(
      (folder) =>
        folder.id !== ignoredId &&
        folder.name.localeCompare(name, "id", { sensitivity: "base" }) === 0,
    );
    if (duplicate) {
      throw new FolderError(409, "Nama folder sudah digunakan.");
    }
  }

  async #persist() {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const document = { version: 1, folders: this.list() };
    try {
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
