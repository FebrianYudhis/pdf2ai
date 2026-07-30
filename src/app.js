import { convert } from "@opendataloader/pdf";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { delimiter, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

const SUPPORTED_FORMATS = new Set([
  "html",
  "json",
  "markdown",
  "pdf",
  "tagged-pdf",
  "text",
]);

const HELP = `
OpenDataLoader PDF - Node.js CLI

Penggunaan:
  node src/app.js <file-pdf|folder> [...] [opsi]

Opsi:
  -o, --output-dir <dir>       Direktori hasil (default: output)
  -f, --format <format>        Format; koma atau ulangi opsi (default: json,markdown)
      --pages <range>          Contoh: 1,3,5-7
      --image-output <mode>    off, external, embedded (default: external)
      --image-format <format>  png atau jpeg (default: png)
      --table-method <method>  default atau cluster
      --reading-order <mode>   xycut atau off
      --threads <jumlah>       Thread pipeline Java lokal (default: 1)
      --keep-line-breaks       Pertahankan line break asli
      --include-header-footer  Sertakan header dan footer
      --sanitize               Samarkan data sensitif yang didukung
      --use-struct-tree        Gunakan structure tree PDF
      --markdown-with-html     Izinkan HTML di dalam Markdown
      --hybrid <backend>       off atau docling-fast (default: off)
      --hybrid-mode <mode>     auto atau full (default: auto)
      --hybrid-url <url>       Default: http://localhost:5002
      --hybrid-timeout <ms>    0 berarti tanpa timeout
      --hybrid-fallback        Fallback ke Java jika backend gagal
      --quiet                  Kurangi log OpenDataLoader
  -h, --help                   Tampilkan bantuan

Contoh:
  node src/app.js "SRIKANDI.pdf" -o output -f json,markdown
  node src/app.js "SCAN.pdf" -o output --hybrid docling-fast
`.trim();

export function normalizeFormats(values) {
  if (!values?.length) {
    return ["json", "markdown"];
  }

  const formats = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const invalid = [...new Set(formats)].filter(
    (format) => !SUPPORTED_FORMATS.has(format),
  );
  if (invalid.length) {
    throw new Error(
      `Format tidak didukung: ${invalid.join(", ")}. ` +
        `Pilihan: ${[...SUPPORTED_FORMATS].sort().join(", ")}.`,
    );
  }

  return [...new Set(formats)];
}

function parseNonNegativeInteger(value, name) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} harus berupa bilangan bulat non-negatif.`);
  }
  return Number(value);
}

function parsePositiveInteger(value, name) {
  const parsed = parseNonNegativeInteger(value, name);
  if (parsed < 1) {
    throw new Error(`${name} harus minimal 1.`);
  }
  return parsed;
}

function validateChoice(value, allowed, name) {
  if (!allowed.includes(value)) {
    throw new Error(`${name} harus salah satu dari: ${allowed.join(", ")}.`);
  }
  return value;
}

export function validateInputs(inputPaths) {
  if (!inputPaths.length) {
    throw new Error("Berikan minimal satu file PDF atau folder.");
  }

  return inputPaths.map((inputPath) => {
    const absolutePath = resolve(inputPath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Input tidak ditemukan: ${inputPath}`);
    }
    if (
      statSync(absolutePath).isFile() &&
      extname(absolutePath).toLowerCase() !== ".pdf"
    ) {
      throw new Error(`Input file harus berformat PDF: ${inputPath}`);
    }
    return absolutePath;
  });
}

function javaVersion(javaPath) {
  const result = spawnSync(javaPath, ["-version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return null;
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = output.match(/version\s+"(\d+(?:\.\d+)*)/);
  if (!match) {
    return null;
  }

  const parts = match[1].split(".").map(Number);
  return parts[0] === 1 ? parts[1] : parts[0];
}

function windowsJavaCandidates() {
  if (process.platform !== "win32") {
    return [];
  }

  const candidates = [];
  const roots = [
    String.raw`C:\Program Files\Eclipse Adoptium`,
    String.raw`C:\Program Files\Java`,
    String.raw`C:\Program Files\Microsoft`,
  ];

  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.toLowerCase().startsWith("jdk-")) {
        continue;
      }
      candidates.push(join(root, entry.name, "bin", "java.exe"));
    }
  }

  return candidates.sort().reverse();
}

export function ensureJava() {
  const candidates = ["java"];

  if (process.env.JAVA_HOME) {
    candidates.push(
      join(
        process.env.JAVA_HOME,
        "bin",
        process.platform === "win32" ? "java.exe" : "java",
      ),
    );
  }
  candidates.push(...windowsJavaCandidates());

  for (const candidate of [...new Set(candidates)]) {
    const version = javaVersion(candidate);
    if (version === null || version < 11) {
      continue;
    }

    if (candidate !== "java") {
      const javaBin = dirname(candidate);
      process.env.PATH = `${javaBin}${delimiter}${process.env.PATH ?? ""}`;
      process.env.JAVA_HOME ??= dirname(javaBin);
    }

    return { path: candidate, version };
  }

  throw new Error(
    "Java 11+ tidak ditemukan. Pasang JDK 17 lalu buka ulang terminal, " +
      "atau atur JAVA_HOME/PATH.",
  );
}

function listFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort();
}

function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      "output-dir": { type: "string", short: "o", default: "output" },
      format: { type: "string", short: "f", multiple: true },
      pages: { type: "string" },
      "image-output": { type: "string", default: "external" },
      "image-format": { type: "string", default: "png" },
      "table-method": { type: "string", default: "default" },
      "reading-order": { type: "string", default: "xycut" },
      threads: { type: "string", default: "1" },
      "keep-line-breaks": { type: "boolean", default: false },
      "include-header-footer": { type: "boolean", default: false },
      sanitize: { type: "boolean", default: false },
      "use-struct-tree": { type: "boolean", default: false },
      "markdown-with-html": { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      hybrid: { type: "string", default: "off" },
      "hybrid-mode": { type: "string", default: "auto" },
      "hybrid-url": { type: "string", default: "http://localhost:5002" },
      "hybrid-timeout": { type: "string", default: "0" },
      "hybrid-fallback": { type: "boolean", default: false },
    },
  });

  return { values, positionals };
}

export async function run(argv = process.argv.slice(2)) {
  const { values, positionals } = parseCli(argv);
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const inputPaths = validateInputs(positionals);
  const formats = normalizeFormats(values.format);
  const outputDir = resolve(values["output-dir"]);
  const threads = parsePositiveInteger(values.threads, "--threads");
  const hybridTimeout = parseNonNegativeInteger(
    values["hybrid-timeout"],
    "--hybrid-timeout",
  );
  const hybrid = validateChoice(
    values.hybrid,
    ["off", "docling-fast"],
    "--hybrid",
  );
  const hybridMode = validateChoice(
    values["hybrid-mode"],
    ["auto", "full"],
    "--hybrid-mode",
  );

  validateChoice(
    values["image-output"],
    ["off", "external", "embedded"],
    "--image-output",
  );
  validateChoice(
    values["image-format"],
    ["png", "jpeg"],
    "--image-format",
  );
  validateChoice(
    values["table-method"],
    ["default", "cluster"],
    "--table-method",
  );
  validateChoice(
    values["reading-order"],
    ["xycut", "off"],
    "--reading-order",
  );

  const java = ensureJava();
  mkdirSync(outputDir, { recursive: true });

  console.log(`Java   : ${java.path} (versi ${java.version})`);
  console.log(`Input  : ${inputPaths.length} path`);
  console.log(`Format : ${formats.join(", ")}`);
  console.log(`Mode   : ${hybrid === "off" ? "lokal" : `hybrid ${hybridMode}`}`);
  console.log(`Output : ${outputDir}`);
  console.log("Memulai ekstraksi...");

  await convert(inputPaths, {
    outputDir,
    format: formats,
    quiet: values.quiet,
    keepLineBreaks: values["keep-line-breaks"],
    useStructTree: values["use-struct-tree"],
    tableMethod: values["table-method"],
    readingOrder: values["reading-order"],
    markdownWithHtml: values["markdown-with-html"],
    imageOutput: values["image-output"],
    imageFormat: values["image-format"],
    pages: values.pages,
    includeHeaderFooter: values["include-header-footer"],
    sanitize: values.sanitize,
    hybrid: hybrid === "off" ? undefined : hybrid,
    hybridMode: hybrid === "off" ? undefined : hybridMode,
    hybridUrl: hybrid === "off" ? undefined : values["hybrid-url"],
    hybridTimeout:
      hybrid === "off" || hybridTimeout === 0
        ? undefined
        : String(hybridTimeout),
    hybridFallback:
      hybrid === "off" ? false : values["hybrid-fallback"],
    threads: String(threads),
  });

  const generated = listFiles(outputDir);
  console.log(`Ekstraksi selesai. Ditemukan ${generated.length} file hasil:`);
  for (const file of generated) {
    console.log(`  - ${file.slice(outputDir.length + 1)}`);
  }
  return 0;
}

const isMain = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isMain) {
  run().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
