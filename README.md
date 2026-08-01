# PDF2AI

**PDF to AI Ready** — aplikasi mandiri untuk mengubah PDF digital maupun hasil
scan menjadi Markdown, yaitu teks terstruktur yang mudah dibaca, disalin,
dicari, dan digunakan oleh aplikasi AI.

PDF diunggah melalui dashboard web dan diproses di komputer atau server tempat
PDF2AI berjalan. Setelah selesai, Anda dapat membaca hasilnya, mengunduh PDF
atau Markdown, dan—jika diinginkan—mengajukan pertanyaan kepada provider AI
yang Anda konfigurasi sendiri.

Ekstraksi PDF dan OCR berjalan secara lokal. Fitur **Tanya AI** bersifat
opsional; ketika digunakan, isi Markdown dan pertanyaan Anda dikirim ke provider
AI tersebut. Integrasi aplikasi lain melalui HTTP API juga tersedia, tetapi
tidak diperlukan untuk penggunaan dashboard sehari-hari.

## Fitur utama

- Upload satu atau beberapa PDF melalui drag-and-drop.
- Pemrosesan di latar belakang satu per satu agar stabil tanpa GPU.
- Antrean dan data dokumen tetap tersedia setelah aplikasi dimulai ulang.
- OCR scan melalui Docling, RapidOCR, dan ONNX Runtime.
- Fallback text layer untuk PDF digital dengan hasil parser yang rusak.
- Viewer terpadu untuk PDF asli, metadata, dan Markdown.
- Salin link API untuk mengambil metadata, PDF, Markdown, dan hasil AI.
- Unduh PDF atau Markdown langsung dari dashboard.
- Hapus job beserta PDF, metadata, dan Markdown.
- Konfirmasi SweetAlert sebelum penghapusan permanen atau pencabutan akses.
- HTTP API berbasis antrean untuk integrasi aplikasi lain.
- Dashboard responsif dengan tema terang dan gelap otomatis.
- Login dengan kode TOTP 6 digit dari aplikasi authenticator standar, tanpa
  password tambahan.
- API key yang dapat dibuat, dirotasi, dan dicabut oleh pengguna yang login.
- Tanya AI untuk setiap PDF selesai melalui provider OpenAI-compatible.
- Import model dari provider, template pertanyaan, dan riwayat jawaban persisten.

## Mulai menggunakan PDF2AI

PDF2AI saat ini dipasang dan dijalankan sendiri melalui terminal. Jika
administrator sudah menyiapkan aplikasinya, Anda dapat langsung melanjutkan ke
bagian [Menggunakan dashboard](#menggunakan-dashboard).

### 1. Siapkan kebutuhan sistem

| Runtime | Kebutuhan |
| --- | --- |
| Node.js | Versi 20.19 atau lebih baru |
| Java/JDK | Versi 11 atau lebih baru; JDK 17 direkomendasikan |
| Python | Python 3 untuk backend OCR |
| Git | Opsional; diperlukan jika mengunduh aplikasi dengan `git clone` |
| RAM | Sekitar 2–4 GB untuk OCR berbasis CPU |
| Disk | Sekitar 1–2 GB untuk dependency dan model |

Pastikan perintah berikut tersedia:

```bash
node --version
java -version
python --version
```

Jika perintah `python` tidak tersedia, setup juga dapat menemukan `python3`,
`py -3`, atau executable yang ditentukan melalui environment variable `PYTHON`.

### 2. Unduh kode aplikasi

Unduh ZIP dari [repository PDF2AI](https://github.com/FebrianYudhis/pdf2ai),
ekstrak, lalu buka terminal di folder tersebut. Pengguna Git dapat menjalankan:

```bash
git clone https://github.com/FebrianYudhis/pdf2ai.git
cd pdf2ai
```

### 3. Instal komponen aplikasi

```bash
npm install
npm run setup:ocr
```

Perintah `setup:ocr` menyiapkan komponen yang diperlukan untuk membaca PDF hasil
scan. Langkah ini biasanya hanya perlu dijalankan sekali.

### 4. Jalankan aplikasi

```bash
npm start
```

Buka:

```text
http://127.0.0.1:3000
```

Perintah tersebut menjalankan pemroses OCR, dashboard, dan API. Gunakan
`Ctrl+C` di terminal untuk menghentikan aplikasi.

Pada penggunaan pertama, browser akan membuka halaman konfigurasi TOTP:

1. Tampilkan lalu pindai kode QR menggunakan aplikasi authenticator.
2. Masukkan kode 6 digit untuk mengaktifkan TOTP.

Konfigurasi ini hanya dilakukan sekali. Login berikutnya selalu memerlukan
kode TOTP 6 digit tanpa password.

## Menggunakan dashboard

1. Masuk menggunakan kode TOTP 6 digit dari aplikasi authenticator.
2. Pilih atau tarik satu atau beberapa PDF ke area upload, lalu klik
   **Masukkan ke antrean**.
3. Pantau status **Mengantre**, **Memproses**, **Selesai**, atau **Gagal**.
4. Pada dokumen yang selesai, klik **Lihat hasil** untuk membuka:
   - PDF asli;
   - informasi pemrosesan; dan
   - hasil Markdown.
5. Opsional: klik **Konfigurasi AI** untuk menghubungkan provider, memeriksa
   token, mengimpor model, memilih model default, dan membuat template
   pertanyaan. Tombol **Tanya AI** akan tersedia setelah konfigurasi valid.
6. Opsional: klik **API Key** jika aplikasi lain perlu mengambil data PDF2AI.
   Panduan lengkap tersedia melalui menu **API Docs**.
7. Gunakan tombol **Hapus** hanya jika Anda ingin menghapus PDF dan seluruh
   hasilnya secara permanen.

Browser boleh ditutup setelah upload selesai. Job akan terus diproses oleh
server dan dimuat kembali ketika aplikasi dimulai ulang.

## Cara kerja (gambaran teknis)

```text
Browser / HTTP client
        |
        v
Fastify API + antrean persisten (Node.js)
        |
        +----> PDF dan metadata di data/jobs/
        +----> Hasil Tanya AI di data/jobs/.ai-results/
        |
        v
OpenDataLoader PDF (Java)
        |
        v
Docling + RapidOCR (Python, mode hybrid)
        |
        v
Markdown
        |
        v
Provider AI OpenAI-compatible (opsional)
```

Antrean menggunakan satu worker global. Pendekatan ini mencegah beberapa proses
Java/OCR berat berjalan bersamaan pada perangkat berbasis CPU.
Parser dokumen menggunakan
[OpenDataLoader PDF](https://opendataloader.org/).

## Integrasi HTTP API (opsional)

Bagian ini ditujukan untuk developer atau pengguna yang ingin menghubungkan
PDF2AI dengan aplikasi lain. Pengguna dashboard dapat melewatinya.

Base URL default:

```text
http://127.0.0.1:3000
```

Dokumentasi interaktif tersedia di `/docs` setelah login TOTP. Halaman tersebut
menyediakan navigasi semua endpoint, contoh response, status error, serta tombol
salin untuk contoh cURL dan JavaScript.

TOTP melindungi dashboard web. Setelah login, buka **API Key** di bagian atas
dashboard untuk membuat key. Key lengkap hanya ditampilkan sekali; membuat key
baru otomatis menonaktifkan key lama.

Client eksternal harus mengirim key melalui header:

```http
X-API-Key: <API_KEY>
```

Endpoint `/v1/health` tetap tersedia tanpa autentikasi untuk health check.

### Ringkasan endpoint

| Method | Endpoint | Response |
| --- | --- | --- |
| `GET` | `/v1/health` | Status API, OCR, dan statistik antrean |
| `GET` | `/v1/ai/models` | Daftar model AI tersimpan dan model default |
| `POST` | `/v1/jobs` | Membuat job background |
| `GET` | `/v1/jobs` | Daftar job dan statistik |
| `GET` | `/v1/jobs/:id` | Metadata, status, dan URL resource job |
| `GET` | `/v1/jobs/:id/pdf` | PDF asli |
| `GET` | `/v1/jobs/:id/markdown` | Markdown hasil ekstraksi |
| `DELETE` | `/v1/jobs/:id` | Menghapus job dan seluruh file |
| `POST` | `/v1/jobs/:jobId/ai` | Menjalankan Tanya AI pada job selesai |
| `GET` | `/v1/jobs/:jobId/ai` | Daftar hasil AI milik job |
| `GET` | `/v1/jobs/:jobId/ai/:aiId` | Satu hasil AI berdasarkan ID |

### Upload PDF

Kirim tepat satu PDF melalui multipart field bernama `file`:

```bash
curl -F "file=@document.pdf;type=application/pdf" \
  -H "X-API-Key: $PDF2AI_API_KEY" \
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
    "markdownUrl": null,
    "aiModelsUrl": "/v1/ai/models",
    "aiResultsUrl": "/v1/jobs/2a6cf34e-7c27-4ba8-afcc-8c91339e3f0c/ai"
  }
}
```

### Periksa status

```bash
curl -H "X-API-Key: $PDF2AI_API_KEY" \
  http://127.0.0.1:3000/v1/jobs/JOB_ID
```

| Status | Arti |
| --- | --- |
| `queued` | Menunggu giliran |
| `processing` | Sedang diekstrak |
| `completed` | PDF dan Markdown siap diambil |
| `failed` | Ekstraksi gagal; lihat field `error` |

`markdownUrl` bernilai `null` sampai job berstatus `completed`.
`aiResultsUrl` selalu tersedia dan dapat dipakai untuk membuat pertanyaan baru
atau mengambil daftar hasil AI. Dengan demikian client cukup mengikuti URL pada
response dan tidak perlu menyusun path endpoint turunannya sendiri.
`aiModelsUrl` mengarah ke daftar model AI yang dapat digunakan saat membuat
pertanyaan.

### Ambil PDF

```bash
curl http://127.0.0.1:3000/v1/jobs/JOB_ID/pdf \
  -H "X-API-Key: $PDF2AI_API_KEY" \
  --output document.pdf
```

Gunakan `?download=1` untuk menambahkan header attachment:

```text
GET /v1/jobs/:id/pdf?download=1
```

### Ambil Markdown

```bash
curl http://127.0.0.1:3000/v1/jobs/JOB_ID/markdown \
  -H "X-API-Key: $PDF2AI_API_KEY" \
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
curl -X DELETE \
  -H "X-API-Key: $PDF2AI_API_KEY" \
  http://127.0.0.1:3000/v1/jobs/JOB_ID
```

Hanya job `completed` atau `failed` yang dapat dihapus. Penghapusan menghapus
PDF sumber, metadata, Markdown, dan seluruh hasil Tanya AI secara permanen.

### Tanya AI

Sebelum memakai endpoint AI, login TOTP lalu buka **Konfigurasi AI**:

1. Isi Base URL OpenAI-compatible hingga prefix versinya, misalnya
   `https://api.openai.com/v1`.
2. Isi token provider. Token boleh kosong untuk provider lokal tanpa autentikasi.
3. Klik **Cek & import model**. Server memanggil `GET <baseUrl>/models` dan
   mengimport nilai `data[].id`.
4. Pilih **Model default** yang otomatis muncul pertama saat membuka Tanya AI.
5. Tambahkan template pertanyaan bila diperlukan, kemudian simpan.

Konfigurasi lama yang belum memiliki model default otomatis memakai model
pertama dari daftar impor. Pemanggilan melalui API tetap harus mengirim field
`model` secara eksplisit.

Periksa model yang dapat digunakan oleh client eksternal:

```bash
curl -H "X-API-Key: $PDF2AI_API_KEY" \
  http://127.0.0.1:3000/v1/ai/models
```

```json
{
  "configured": true,
  "modelsUrl": "/v1/ai/models",
  "models": ["model-cepat", "model-teliti"],
  "defaultModel": "model-teliti",
  "updatedAt": "2026-08-01T09:00:00.000Z"
}
```

Endpoint tersebut membaca konfigurasi tersimpan tanpa menghubungi provider
ulang dan tidak mengembalikan Base URL atau token provider. Jika AI belum
dikonfigurasi, response tetap `200 OK` dengan `configured: false` dan
`models: []`.

Kirim pertanyaan untuk PDF yang sudah berstatus `completed`:

```bash
curl -X POST http://127.0.0.1:3000/v1/jobs/JOB_ID/ai \
  -H "X-API-Key: $PDF2AI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_ID",
    "message": "Ringkas dokumen dan tuliskan poin tindakan."
  }'
```

Response `201 Created` berisi object `result`. Markdown dokumen disertakan oleh
server secara otomatis dan tidak perlu dikirim oleh client. Header `Location`
dan field `result.resultUrl` menunjuk ke hasil yang baru dibuat:

```json
{
  "result": {
    "id": "HASIL_AI_ID",
    "jobId": "JOB_ID",
    "model": "MODEL_ID",
    "prompt": "Ringkas dokumen dan tuliskan poin tindakan.",
    "content": "Jawaban dari AI...",
    "jobUrl": "/v1/jobs/JOB_ID",
    "aiModelsUrl": "/v1/ai/models",
    "aiResultsUrl": "/v1/jobs/JOB_ID/ai",
    "resultUrl": "/v1/jobs/JOB_ID/ai/HASIL_AI_ID"
  }
}
```

Ambil semua hasil untuk satu PDF:

```bash
curl -H "X-API-Key: $PDF2AI_API_KEY" \
  "http://127.0.0.1:3000/v1/jobs/JOB_ID/ai"
```

Response daftar menghubungkan kembali koleksi ke job asal dan menyediakan URL
setiap hasil:

```json
{
  "jobUrl": "/v1/jobs/JOB_ID",
  "aiModelsUrl": "/v1/ai/models",
  "aiResultsUrl": "/v1/jobs/JOB_ID/ai",
  "results": [
    {
      "id": "HASIL_AI_ID",
      "jobId": "JOB_ID",
      "aiModelsUrl": "/v1/ai/models",
      "resultUrl": "/v1/jobs/JOB_ID/ai/HASIL_AI_ID"
    }
  ]
}
```

Ambil satu hasil:

```bash
curl -H "X-API-Key: $PDF2AI_API_KEY" \
  http://127.0.0.1:3000/v1/jobs/JOB_ID/ai/HASIL_AI_ID
```

Pada riwayat jawaban di dashboard, tombol **Salin link** memakai `resultUrl`
dari API dan menyalinnya sebagai URL absolut. Client eksternal tetap perlu
menyertakan header `X-API-Key` saat melakukan fetch.

Endpoint AI menerima cookie sesi dashboard atau header `X-API-Key`, sama seperti
endpoint terproteksi lain di bawah `/v1/*`.

### Contoh JavaScript lengkap

```javascript
const baseUrl = "http://127.0.0.1:3000";
const auth = { "X-API-Key": process.env.PDF2AI_API_KEY };

async function ambilModelAi() {
  const response = await fetch(`${baseUrl}/v1/ai/models`, { headers: auth });
  if (!response.ok) {
    throw new Error(`Daftar model tidak dapat diambil (${response.status})`);
  }
  return response.json();
}

async function ambilDokumen(id) {
  const statusResponse = await fetch(`${baseUrl}/v1/jobs/${id}`, {
    headers: auth,
  });
  if (!statusResponse.ok) {
    throw new Error(`Dokumen tidak ditemukan (${statusResponse.status})`);
  }

  const { job } = await statusResponse.json();
  if (job.status !== "completed") {
    throw new Error(`Dokumen belum selesai: ${job.status}`);
  }

  const [pdfResponse, markdownResponse, aiResultsResponse] = await Promise.all([
    fetch(`${baseUrl}${job.pdfUrl}`, { headers: auth }),
    fetch(`${baseUrl}${job.markdownUrl}`, { headers: auth }),
    fetch(`${baseUrl}${job.aiResultsUrl}`, { headers: auth }),
  ]);

  if (!pdfResponse.ok || !markdownResponse.ok || !aiResultsResponse.ok) {
    throw new Error("Data dokumen tidak dapat diambil.");
  }

  const [pdf, markdown, ai] = await Promise.all([
    pdfResponse.blob(),
    markdownResponse.text(),
    aiResultsResponse.json(),
  ]);

  return { metadata: job, pdf, markdown, aiResults: ai.results };
}

async function hapusDokumen(jobUrl) {
  const response = await fetch(`${baseUrl}${jobUrl}`, {
    method: "DELETE",
    headers: auth,
  });

  if (!response.ok) {
    throw new Error(`Dokumen gagal dihapus (${response.status})`);
  }
}

const [konfigurasiModel, dokumen] = await Promise.all([
  ambilModelAi(),
  ambilDokumen("JOB_ID"),
]);
console.log(konfigurasiModel.defaultModel, dokumen.markdown, dokumen.aiResults);

// Jalankan hanya ketika data memang ingin dihapus:
// await hapusDokumen(dokumen.metadata.jobUrl);
```

Untuk JavaScript yang berjalan pada origin berbeda, browser memerlukan
konfigurasi CORS. Client backend-to-backend tidak terpengaruh aturan CORS
browser.

## Konfigurasi lanjutan (opsional)

| Variable | Default | Keterangan |
| --- | --- | --- |
| `APP_SESSION_HOURS` | `12` | Durasi sesi login browser dalam jam |
| `APP_AUTH_FILE` | `data/auth.json` | Lokasi konfigurasi rahasia TOTP |
| `APP_TOTP_ISSUER` | `PDF2AI` | Nama aplikasi di authenticator |
| `APP_TOTP_ACCOUNT` | `Dashboard` | Nama akun di authenticator |
| `APP_AI_TIMEOUT_MS` | `300000` | Timeout request jawaban AI dalam milidetik |
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

## Perintah administrator dan developer

| Command | Keterangan |
| --- | --- |
| `npm start` | Menjalankan dashboard, API, dan backend OCR |
| `npm run server` | Menjalankan dashboard/API tanpa mengelola OCR |
| `npm run setup:ocr` | Membuat `.venv` dan memasang dependency OCR |
| `npm run cli -- <args>` | Menjalankan CLI OpenDataLoader |
| `npm test` | Menjalankan seluruh automated test |

## Lokasi penyimpanan data

Setiap job disimpan di:

```text
data/jobs/<job-id>/
├── input.pdf
├── metadata.json
└── result.md

data/jobs/.ai-results/
└── <hasil-ai-id>.json
```

`result.md` tersedia setelah job selesai. Job yang berstatus `processing` ketika
server berhenti akan dikembalikan menjadi `queued` saat startup berikutnya.

## Struktur proyek (referensi developer)

```text
.
├── public/
│   ├── app.js
│   ├── docs.html
│   ├── docs.js
│   ├── fonts/
│   ├── index.html
│   └── styles.css
├── scripts/
│   ├── extract-text-layer.py
│   └── setup-ocr.js
├── src/
│   ├── app.js
│   ├── ai.js
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
- Dashboard web dilindungi kode TOTP. Percobaan kode yang gagal dibatasi lima
  kali per alamat IP dalam lima menit.
- Endpoint `/v1/*` memerlukan header `X-API-Key`. Dashboard yang sudah login
  tetap dapat memakai endpoint tersebut melalui cookie sesi.
- Endpoint `/v1/jobs/:jobId/ai*` memerlukan API key atau cookie sesi dashboard.
- API key dibuat dari bilangan acak kriptografis dan hanya hash SHA-256-nya
  yang disimpan. Key lengkap hanya ditampilkan saat dibuat atau dirotasi.
- Secret TOTP disimpan lokal di `data/auth.json` dengan mode `0600` pada sistem
  yang mendukung permission POSIX. Jangan membagikan file ini atau key manual
  yang ditampilkan saat setup.
- Token provider AI perlu tersedia dalam bentuk asli untuk request keluar dan
  disimpan lokal di `data/auth.json`. Endpoint konfigurasi hanya mengembalikan
  status serta potongan token, tidak pernah token lengkap.
- Cookie sesi menggunakan `HttpOnly` dan `SameSite=Strict`; atribut `Secure`
  aktif ketika aplikasi diakses melalui HTTPS.
- Setup pertama tidak memiliki password pelindung. Selesaikan enrollment saat
  aplikasi masih hanya dapat diakses dari `127.0.0.1`, lalu gunakan HTTPS
  sebelum membuka service ke jaringan atau production.
- Dokumen sensitif sebaiknya diproses pada lingkungan yang tepercaya.
- Ekstraksi PDF berlangsung lokal, tetapi fitur **Tanya AI** mengirim hasil
  Markdown dan pertanyaan ke provider AI yang dikonfigurasi. Periksa kebijakan
  privasi provider sebelum mengirim dokumen sensitif.
- Font antarmuka disimpan di `public/fonts/`; browser tidak perlu mengambil font
  dari CDN eksternal.
- SweetAlert2 disajikan dari aset lokal di `public/vendor/` tanpa request ke CDN.

Jika perangkat authenticator hilang, hentikan aplikasi, hapus
`data/auth.json`, lalu jalankan aplikasi kembali untuk melakukan enrollment
ulang. Tindakan pemulihan ini memerlukan akses langsung ke mesin server dan
akan membuka kembali halaman setup TOTP.

## Changelog

Riwayat perubahan tersedia di [CHANGELOG.md](CHANGELOG.md).
