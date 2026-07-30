import assert from "node:assert/strict";
import test from "node:test";

import {
  plainTextToMarkdown,
  shouldUseTextFallback,
  textQuality,
} from "../src/pdf-text-fallback.js";

test("quality score membedakan kalimat dan karakter PDF yang rusak", () => {
  assert.ok(textQuality("Surat pernyataan tanggung jawab tahun 2026") > 0.8);
  assert.ok(textQuality(`!"# $ %!"&! %!"#!" &' $!(!)`) < 0.4);
});

test("text layer yang sehat menggantikan Markdown rusak", () => {
  const broken = `!"# $ %!"&! %!"#!" &' $!(!) '"'\n`.repeat(5);
  const healthy =
    "SURAT PERNYATAAN TANGGUNG JAWAB MUTLAK\n" +
    "Perhitungan pembayaran bulan Juli tahun 2026 telah dihitung dengan benar.";

  assert.equal(shouldUseTextFallback(broken, healthy), true);
  assert.equal(plainTextToMarkdown(healthy), `${healthy}\n`);
});

test("text layer kosong tidak menggantikan hasil OCR", () => {
  assert.equal(
    shouldUseTextFallback("# Hasil OCR\n\nIsi dokumen terbaca.", ""),
    false,
  );
});
