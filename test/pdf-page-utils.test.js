import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPageRange,
  parsePageRange,
  resolveJobPages,
} from "../src/pdf-page-utils.js";

test("parsePageRange: mem-parsing format rentang halaman kustom dengan benar", () => {
  assert.deepEqual(parsePageRange("1, 3, 5-7, 10"), [1, 3, 5, 6, 7, 10]);
  assert.deepEqual(parsePageRange("1-3, 5, 5, 2"), [1, 2, 3, 5]);
  assert.deepEqual(parsePageRange("7-5"), [5, 6, 7]);
  assert.deepEqual(parsePageRange("4"), [4]);
});

test("parsePageRange: membatasi nomor halaman jika totalPages disediakan", () => {
  assert.deepEqual(parsePageRange("1-10, 15", 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(parsePageRange("3, 5, 8", 4), [3]);
});

test("parsePageRange: melempar error untuk format yang tidak valid", () => {
  assert.throws(() => parsePageRange(""), /Rentang halaman tidak boleh kosong/);
  assert.throws(() => parsePageRange("abc"), /Format rentang halaman tidak valid/);
  assert.throws(() => parsePageRange("1, , 3"), /Format rentang halaman tidak valid/);
  assert.throws(() => parsePageRange("0"), /Nomor halaman harus berupa bilangan bulat positif/);
  assert.throws(() => parsePageRange("-5"), /Nomor halaman harus berupa bilangan bulat positif/);
  assert.throws(() => parsePageRange("10-15", 5), /Tidak ada halaman dalam rentang dokumen yang valid/);
});

test("formatPageRange: memformat array nomor halaman menjadi string ringkas", () => {
  assert.equal(formatPageRange([1, 2, 3, 5, 8, 9, 10]), "1-3,5,8-10");
  assert.equal(formatPageRange([4]), "4");
  assert.equal(formatPageRange([1, 3, 5]), "1,3,5");
  assert.equal(formatPageRange([]), "");
});

test("resolveJobPages: mengembalikan konfigurasi yang sesuai dengan mode", async () => {
  const allRes = await resolveJobPages({ pageMode: "all" });
  assert.equal(allRes.pageMode, "all");
  assert.equal(allRes.pages, null);
  assert.equal(allRes.extractedPages, null);

  const customRes = await resolveJobPages({ pageMode: "custom", pages: "1-3, 5" });
  assert.equal(customRes.pageMode, "custom");
  assert.equal(customRes.pages, "1-3,5");
  assert.equal(customRes.extractedPages, "1-3,5");
});

