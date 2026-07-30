# Changelog

Semua perubahan penting PDF2AI dicatat dalam file ini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-30

Rilis awal **PDF2AI — PDF to AI Ready**.

### Added

- Dashboard web responsif dengan sistem visual Slate Edge serta tema terang dan
  gelap otomatis.
- Upload multi-PDF melalui file picker dan drag-and-drop.
- Antrean background persisten dengan satu worker global untuk perangkat CPU.
- Pemulihan job terputus dengan mengembalikan status `processing` menjadi
  `queued` setelah restart.
- Integrasi OpenDataLoader PDF untuk parsing dokumen berbasis Java.
- Backend hybrid Docling dan RapidOCR melalui virtual environment Python.
- Konfigurasi default CPU tanpa ketergantungan GPU.
- Restart otomatis backend OCR ketika proses berhenti.
- Retry ekstraksi penuh ketika mode otomatis menghasilkan konten yang tidak
  memadai.
- Fallback text layer untuk PDF digital dengan hasil Markdown yang rusak.
- Viewer hasil dengan tab PDF, metadata, dan Markdown.
- Aksi salin Markdown serta unduh PDF dan Markdown.
- Dialog Fetch Data dengan ID job, URL metadata/PDF/Markdown, copy link, dan
  contoh JavaScript Fetch API.
- Dokumentasi penghapusan melalui `DELETE` Fetch API.
- Penyimpanan PDF, metadata, dan Markdown per job di `data/jobs/`.
- Penghapusan permanen untuk job berstatus `completed` atau `failed`.
- Job API asynchronous:
  - `POST /v1/jobs`
  - `GET /v1/jobs`
  - `GET /v1/jobs/:id`
  - `GET /v1/jobs/:id/pdf`
  - `GET /v1/jobs/:id/markdown`
  - `DELETE /v1/jobs/:id`
- Endpoint synchronous `POST /v1/extract/markdown`.
- Endpoint health check `GET /health`.
- Opsi attachment download melalui query `?download=1`.
- Launcher terpadu untuk backend OCR dan HTTP server.
- Script setup OCR otomatis melalui `npm run setup:ocr`.
- CLI Node.js untuk konversi file atau folder dan beberapa format output.
- Automated test untuk konfigurasi, antrean, API, fallback text layer, input,
  pemrosesan berurutan, dan lifecycle penghapusan job.

### Security

- Validasi multipart field dan signature file PDF.
- Sanitasi nama file untuk header download.
- Pembatasan ukuran upload yang dapat dikonfigurasi.
- Validasi UUID job sebelum mengakses direktori penyimpanan.
- Pembatasan penghapusan hanya untuk job terminal.
