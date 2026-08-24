import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePaginationPages,
  formatLastUpdated,
} from "../public/app-utils.js";

test("waktu pembaruan memakai tanggal Indonesia lengkap dan pemisah titik dua", () => {
  const value = new Date(2026, 7, 15, 23, 41, 43);

  assert.equal(
    formatLastUpdated(value),
    "Diperbarui pukul 15 Agustus 2026 - 23:41:43.",
  );
});

test("calculatePaginationPages menghitung nomor halaman dan ellipsis dengan benar", () => {
  assert.deepEqual(calculatePaginationPages(1, 0), []);
  assert.deepEqual(calculatePaginationPages(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(calculatePaginationPages(1, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(calculatePaginationPages(1, 10), [1, 2, 3, 4, 5, "...", 10]);
  assert.deepEqual(calculatePaginationPages(4, 10), [1, 2, 3, 4, 5, "...", 10]);
  assert.deepEqual(calculatePaginationPages(5, 10), [1, "...", 4, 5, 6, "...", 10]);
  assert.deepEqual(calculatePaginationPages(6, 10), [1, "...", 5, 6, 7, "...", 10]);
  assert.deepEqual(calculatePaginationPages(7, 10), [1, "...", 6, 7, 8, 9, 10]);
  assert.deepEqual(calculatePaginationPages(10, 10), [1, "...", 6, 7, 8, 9, 10]);
});

