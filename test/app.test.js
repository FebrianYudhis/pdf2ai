import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { normalizeFormats, validateInputs } from "../src/app.js";

test("format default adalah JSON dan Markdown", () => {
  assert.deepEqual(normalizeFormats(undefined), ["json", "markdown"]);
});

test("format dapat dipisahkan koma, diulang, dan dideduplikasi", () => {
  assert.deepEqual(
    normalizeFormats(["json,markdown", "text", "json"]),
    ["json", "markdown", "text"],
  );
});

test("format tidak dikenal ditolak", () => {
  assert.throws(() => normalizeFormats(["csv"]), /tidak didukung/);
});

test("input yang tidak ada ditolak", () => {
  assert.throws(() => validateInputs(["missing.pdf"]), /tidak ditemukan/);
});

test("input file non-PDF ditolak", () => {
  const directory = mkdtempSync(join(tmpdir(), "odl-pdf-"));
  const file = join(directory, "document.txt");
  writeFileSync(file, "test");
  assert.throws(() => validateInputs([file]), /harus berformat PDF/);
});

