import assert from "node:assert/strict";
import test from "node:test";

import { formatLastUpdated } from "../public/app-utils.js";

test("waktu pembaruan memakai tanggal Indonesia lengkap dan pemisah titik dua", () => {
  const value = new Date(2026, 7, 15, 23, 41, 43);

  assert.equal(
    formatLastUpdated(value),
    "Diperbarui pukul 15 Agustus 2026 - 23:41:43.",
  );
});
