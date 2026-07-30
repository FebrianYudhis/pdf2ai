# PDF2AI

**PDF to AI Ready** — pipeline lokal untuk mengubah PDF digital maupun hasil
scan menjadi Markdown terstruktur yang siap digunakan untuk RAG, pencarian,
dan automasi AI.

PDF2AI menyediakan dashboard web, antrean background persisten, OCR berbasis
CPU, viewer PDF/metadata/Markdown, serta HTTP API untuk integrasi aplikasi lain.
Parser dokumen menggunakan
[OpenDataLoader PDF](https://opendataloader.org/).

## Fitur utama

- Upload satu atau beberapa PDF melalui drag-and-drop.
- Pemrosesan background satu per satu agar stabil tanpa GPU.
- Antrean dan data job tetap tersedia setelah aplikasi dimulai ulang.
- OCR scan melalui Docling, RapidOCR, dan ONNX Runtime.
- Fallback text layer untuk PDF digital dengan hasil parser yang rusak.
- Viewer terpadu untuk PDF asli, metadata, dan Markdown.
- Copy link API untuk metadata, PDF, Markdown, dan penghapusan.
- Unduh PDF atau Markdown langsung dari dashboard.
- Hapus job beserta PDF, metadata, dan Markdown.
- API asynchronous dan endpoint synchronous untuk integrasi sederhana.
- Dashboard responsif dengan tema terang dan gelap otomatis.

## Quick Start

### 1. Persyaratan

| Runtime | Kebutuhan |
| --- | --- |
| Node.js | Versi 20.19 atau lebih baru |
| Java/JDK | Versi 11 atau lebih baru; JDK 17 direkomendasikan |
| Python | Python 3 untuk backend OCR |
| RAM | Sekitar 2–4 GB untuk OCR berbasis CPU |
| Disk | Sekitar 1–2 GB untuk dependency dan model |

Periksa runtime:

```bash
node --version
java -version
python3 --version
```

Setup juga dapat menemukan executable `python`, `py -3`, atau nilai environment
variable `PYTHON`.

### 2. Instal dependency

```bash
npm install
npm run setup:ocr
```

`setup:ocr` membuat virtual environment `.venv`, memasang dependency dari
`requirements-ocr.txt`, lalu menjalankan pemeriksaan dependency. Langkah ini
hanya perlu dijalankan sekali atau ketika dependency OCR berubah.

### 3. Jalankan aplikasi

```bash
npm start
```

Buka:

```text
http://127.0.0.1:3000
```

Launcher akan menyalakan backend OCR pada port `5002` jika diperlukan, menunggu
hingga OCR siap, lalu menjalankan dashboard dan API pada port `3000`. Gunakan
`Ctrl+C` untuk menghentikan seluruh proses yang dikelola launcher.

## Menggunakan dashboard

1. Pilih atau tarik satu atau beberapa PDF ke area upload.
2. Klik **Masukkan ke antrean**.
3. Pantau status `Mengantre`, `Memproses`, `Selesai`, atau `Gagal`.
4. Pada dokumen selesai, klik **Lihat hasil** untuk membuka:
   - PDF asli;
   - metadata job;
   - hasil Markdown.
5. Klik **Fetch Data** untuk melihat ID surat, URL API, contoh JavaScript, dan
   cara menghapus data melalui API.
6. Gunakan tombol **Hapus** untuk menghapus data secara permanen.

Browser boleh ditutup setelah upload selesai. Job akan terus diproses oleh
server dan dimuat kembali ketika aplikasi dimulai ulang.

## Arsitektur

```text
Browser / HTTP client
        |
        v
Fastify API + antrean persisten (Node.js)
        |
        +----> PDF dan metadata di data/jobs/
        |
        v
OpenDataLoader PDF (Java)
        |
        v
Docling + RapidOCR (Python, mode hybrid)
        |
        v
Markdown
```

Antrean menggunakan satu worker global. Pendekatan ini mencegah beberapa proses
Java/OCR berat berjalan bersamaan pada perangkat berbasis CPU.

## HTTP API

Base URL default:

```text
http://127.0.0.1:3000
```

### Ringkasan endpoint

| Method | Endpoint | Response |
| --- | --- | --- |
| `GET` | `/health` | Status API, OCR, dan statistik antrean |
| `POST` | `/v1/jobs` | Membuat job background |
| `GET` | `/v1/jobs` | Daftar job dan statistik |
| `GET` | `/v1/jobs/:id` | Metadata dan status job |
| `GET` | `/v1/jobs/:id/pdf` | PDF asli |
| `GET` | `/v1/jobs/:id/markdown` | Markdown hasil ekstraksi |
| `DELETE` | `/v1/jobs/:id` | Menghapus job dan seluruh file |
| `POST` | `/v1/extract/markdown` | Ekstraksi synchronous ke Markdown |

### Upload PDF

Kirim tepat satu PDF melalui multipart field bernama `file`:

```bash
curl -F "file=@document.pdf;type=application/pdf" \
  http://127.0.0.1:3000/v1/jobs
```

Response:

```http
HTTP/1.1 202 Accepted
Location: /v1/jobs/2a6cf34e-7c27-4ba8-afcc-8c91339e3f0c
Content-Type: application/json
```

```json
{
  "job": {
    "id": "2a6cf34e-7c27-4ba8-afcc-8c91339e3f0c",
    "originalName": "document.pdf",
    "size": 1048576,
    "status": "queued",
    "createdAt": "2026-07-30T08:00:00.000Z",
    "startedAt": null,
    "completedAt": null,
    "jobUrl": "/v1/jobs/2a6cf34e-7c27-4ba8-afcc-8c91339e3f0c",
    "pdfUrl": "/v1/jobs/2a6cf34e-7c27-4ba8-afcc-8c91339e3f0c/pdf",
    "markdownUrl": null
  }
}
```

### Periksa status

```bash
curl http://127.0.0.1:3000/v1/jobs/JOB_ID
```

| Status | Arti |
| --- | --- |
| `queued` | Menunggu giliran |
| `processing` | Sedang diekstrak |
| `completed` | PDF dan Markdown siap diambil |
| `failed` | Ekstraksi gagal; lihat field `error` |

`markdownUrl` bernilai `null` sampai job berstatus `completed`.

### Ambil PDF

```bash
curl http://127.0.0.1:3000/v1/jobs/JOB_ID/pdf \
  --output document.pdf
```

Gunakan `?download=1` untuk menambahkan header attachment:

```text
GET /v1/jobs/:id/pdf?download=1
```

### Ambil Markdown

```bash
curl http://127.0.0.1:3000/v1/jobs/JOB_ID/markdown \
  --output result.md
```

Response menggunakan `Content-Type: text/markdown; charset=utf-8`. Jika job
belum selesai, endpoint mengembalikan HTTP `409`.

Gunakan `?download=1` untuk mengunduh sebagai file:

```text
GET /v1/jobs/:id/markdown?download=1
```

### Hapus data

```bash
curl -X DELETE http://127.0.0.1:3000/v1/jobs/JOB_ID
```

Hanya job `completed` atau `failed` yang dapat dihapus. Penghapusan menghapus
PDF sumber, metadata, dan Markdown secara permanen.

### Contoh JavaScript lengkap

```javascript
const baseUrl = "http://127.0.0.1:3000";

async function ambilSurat(id) {
  const statusResponse = await fetch(`${baseUrl}/v1/jobs/${id}`);
  if (!statusResponse.ok) {
    throw new Error(`Surat tidak ditemukan (${statusResponse.status})`);
  }

  const { job } = await statusResponse.json();
  if (job.status !== "completed") {
    throw new Error(`Surat belum selesai: ${job.status}`);
  }

  const [pdfResponse, markdownResponse] = await Promise.all([
    fetch(`${baseUrl}${job.pdfUrl}`),
    fetch(`${baseUrl}${job.markdownUrl}`),
  ]);

  if (!pdfResponse.ok || !markdownResponse.ok) {
    throw new Error("Hasil surat tidak dapat diambil.");
  }

  const [pdf, markdown] = await Promise.all([
    pdfResponse.blob(),
    markdownResponse.text(),
  ]);

  return { metadata: job, pdf, markdown };
}

async function hapusSurat(id) {
  const response = await fetch(`${baseUrl}/v1/jobs/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(`Surat gagal dihapus (${response.status})`);
  }
}
```

Untuk JavaScript yang berjalan pada origin berbeda, browser memerlukan
konfigurasi CORS. Client backend-to-backend tidak terpengaruh aturan CORS
browser.

### Endpoint synchronous

```http
POST /v1/extract/markdown
Content-Type: multipart/form-data
```

Endpoint ini menunggu ekstraksi selesai dan mengembalikan body
`text/markdown`. Job sementara otomatis dihapus setelah response selesai.
Gunakan Job API untuk dokumen besar atau proses OCR yang lama.

## Konfigurasi

| Variable | Default | Keterangan |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Host dashboard dan API |
| `PORT` | `3000` | Port dashboard dan API |
| `ODL_DATA_DIR` | `data/jobs` | Direktori penyimpanan job |
| `ODL_MAX_FILE_SIZE_MB` | `25` | Batas ukuran satu PDF |
| `ODL_HYBRID` | `docling-fast` | `docling-fast` atau `off` |
| `ODL_HYBRID_MODE` | `auto` | `auto` atau `full` |
| `ODL_HYBRID_URL` | `http://127.0.0.1:5002` | URL backend OCR |
| `ODL_HYBRID_TIMEOUT` | `0` | Timeout hybrid dalam ms; `0` tanpa timeout |
| `ODL_OCR_ENGINE` | `rapidocr` | Engine OCR yang dijalankan launcher |
| `ODL_OCR_LANG` | `english` | Bahasa/model OCR |
| `ODL_OCR_DEVICE` | `cpu` | Device OCR |
| `ODL_FORCE_OCR` | `false` | Paksa OCR pada seluruh halaman |
| `PYTHON` | otomatis | Override executable Python untuk setup |

Contoh Bash:

```bash
PORT=8080 \
ODL_MAX_FILE_SIZE_MB=50 \
ODL_OCR_LANG=english \
npm start
```

### PDF digital tanpa OCR

Gunakan jika seluruh dokumen memiliki text layer yang sehat:

```bash
ODL_HYBRID=off npm start
```

### OCR penuh

Gunakan jika mode otomatis tidak dapat membaca hasil scan:

```bash
ODL_HYBRID_MODE=full ODL_FORCE_OCR=true npm start
```

Mode penuh lebih lambat pada CPU.

## NPM scripts

| Command | Keterangan |
| --- | --- |
| `npm start` | Menjalankan dashboard, API, dan backend OCR |
| `npm run server` | Menjalankan dashboard/API tanpa mengelola OCR |
| `npm run setup:ocr` | Membuat `.venv` dan memasang dependency OCR |
| `npm run cli -- <args>` | Menjalankan CLI OpenDataLoader |
| `npm test` | Menjalankan seluruh automated test |

## Penyimpanan data

Setiap job disimpan di:

```text
data/jobs/<job-id>/
├── input.pdf
├── metadata.json
└── result.md
```

`result.md` tersedia setelah job selesai. Job yang berstatus `processing` ketika
server berhenti akan dikembalikan menjadi `queued` saat startup berikutnya.

## Struktur proyek

```text
.
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── scripts/
│   ├── extract-text-layer.py
│   └── setup-ocr.js
├── src/
│   ├── app.js
│   ├── job-queue.js
│   ├── pdf-text-fallback.js
│   ├── server.js
│   └── start.js
├── test/
├── CHANGELOG.md
├── package.json
└── requirements-ocr.txt
```

## Troubleshooting

### `EADDRINUSE` pada port 3000

Sudah ada proses yang memakai port tersebut. Hentikan proses lama atau gunakan
port lain:

```bash
PORT=3001 npm start
```

### Endpoint baru mengembalikan `Route ... not found`

Proses Node.js masih menjalankan kode lama. Hentikan dengan `Ctrl+C`, jalankan
`npm start` kembali, lalu muat ulang browser.

### OCR terasa lambat

OCR berbasis CPU dapat memerlukan beberapa menit untuk dokumen kompleks. PDF2AI
sengaja hanya menjalankan satu job pada satu waktu agar pemakaian RAM dan CPU
tetap stabil.

### Scan tidak menghasilkan teks

Coba mode OCR penuh:

```bash
ODL_HYBRID_MODE=full ODL_FORCE_OCR=true npm start
```

Pastikan backend OCR siap melalui:

```bash
curl http://127.0.0.1:5002/health
```

## Batasan dan keamanan

- Konfigurasi default hanya menerima koneksi dari mesin yang menjalankan
  aplikasi.
- Belum tersedia autentikasi, otorisasi per pengguna, rate limit, atau HTTPS.
- Tambahkan autentikasi, HTTPS, rate limit, dan kebijakan CORS sebelum
  menggunakannya sebagai service bersama atau production.
- Dokumen sensitif sebaiknya diproses pada lingkungan yang tepercaya.

## Changelog

Riwayat perubahan tersedia di [CHANGELOG.md](CHANGELOG.md).
