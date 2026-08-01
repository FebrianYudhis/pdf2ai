# Changelog

Semua perubahan penting PDF2AI dicatat dalam file ini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-08-01

### Added

- Konfigurasi provider AI OpenAI-compatible dari dashboard, termasuk Base URL,
  token opsional, pemeriksaan koneksi, dan import model melalui endpoint `/models`.
- Client provider AI mengirim `stream: false` secara eksplisit serta mendukung
  response JSON, SSE, dan NDJSON OpenAI-compatible.
- Template pertanyaan AI yang dapat dibuat, dipilih, diedit, dan digunakan
  kembali untuk PDF yang berbeda.
- Model default yang dapat dipilih dari hasil import dan otomatis diprioritaskan
  saat membuka dialog Tanya AI.
- Tombol **Tanya AI** untuk setiap PDF selesai, dengan pilihan template, model,
  prompt manual, serta riwayat jawaban persisten.
- Penyimpanan hasil AI persisten di `data/jobs/.ai-results/` dan pembersihan
  otomatis ketika job PDF asal dihapus.
- Tombol **Salin link** endpoint hasil pada setiap jawaban AI.
- Dialog konfirmasi SweetAlert2 untuk penghapusan job, konfigurasi AI, dan
  pencabutan API key, dengan aset library yang disajikan secara lokal.
- Endpoint Tanya AI berbasis sesi atau API key:
  - `GET /v1/ai/models`
  - `POST /v1/jobs/:jobId/ai`
  - `GET /v1/jobs/:jobId/ai`
  - `GET /v1/jobs/:jobId/ai/:aiId`
- Response `POST /v1/jobs/:jobId/ai` menyertakan header `Location` menuju hasil
  AI yang baru dibuat.
- Endpoint `GET /v1/ai/models` mengembalikan model yang sudah diimpor, model
  default, status konfigurasi, dan waktu pembaruan tanpa mengekspos token.
- Object job menyertakan `aiModelsUrl` dan `aiResultsUrl`, sedangkan object hasil
  AI menyertakan `jobUrl`, `aiModelsUrl`, `aiResultsUrl`, dan `resultUrl` agar
  seluruh endpoint terkait dapat diikuti langsung tanpa menyusun path manual.
- Response daftar hasil AI menyertakan URL job asal dan URL koleksi, serta
  dashboard **Fetch Data** menampilkan endpoint hasil AI milik dokumen.
- Automated test untuk kontrak provider AI, import model, default model,
  eksekusi Tanya AI, fallback SSE, persistensi hasil, nested endpoint, dan URL
  relasi antar-resource.

### Changed

- Endpoint health check dipindahkan dari `/health` ke `/v1/health` dan tetap
  tersedia tanpa autentikasi.
- Navigasi dashboard pada layar mobile menggunakan hamburger menu tanpa
  menyembunyikan brand PDF2AI.
- Focus ring pada form hanya menyorot input aktif, bukan seluruh wrapper label
  dan teks bantuannya.
- Input TOTP pada setup dan login menerima paste kode dengan separator, misalnya
  `123 456` atau `123-456`.

### Security

- Token provider AI tidak pernah dikirim kembali secara lengkap ke browser atau
  endpoint API setelah disimpan.
- Hasil AI hanya dapat diakses melalui job asalnya; kombinasi `jobId` dan `aiId`
  yang tidak sesuai ditolak sebagai resource yang tidak ditemukan.

## [1.1.0] - 2026-08-01

### Added

- Enrollment TOTP satu kali melalui QR code yang kompatibel dengan aplikasi
  authenticator standar.
- Halaman login TOTP tanpa ketergantungan pada `APP_PASSWORD`.
- Sesi dashboard dengan cookie `HttpOnly` dan `SameSite=Strict`, tombol keluar,
  serta masa berlaku sesi yang dapat dikonfigurasi.
- Pengelolaan satu API key aktif dari dashboard setelah login TOTP, termasuk
  pembuatan, penyalinan, rotasi, dan pencabutan.
- Endpoint manajemen API key berbasis sesi:
  - `GET /auth/api-key`
  - `POST /auth/api-key`
  - `DELETE /auth/api-key`
- Konfigurasi TOTP dan metadata API key persisten di `data/auth.json`.
- Dukungan header `X-API-Key` untuk client eksternal yang mengakses `/v1/*`.
- Halaman khusus `/docs` setelah login TOTP, berisi quick start, referensi semua
  endpoint, model data, status error, dan contoh cURL/JavaScript yang dapat disalin.
- Automated test untuk enrollment TOTP, login, logout, persistensi, API key
  salah/valid, rotasi, pencabutan, dan pemulihan setelah restart.

### Changed

- Endpoint `/v1/*` kini menerima cookie sesi dashboard atau API key yang valid.
- Contoh Fetch API dan `curl` kini menyertakan header `X-API-Key`.
- Dashboard memiliki dialog khusus untuk melihat status dan mengelola API key.
- Endpoint `/health` tetap publik untuk kebutuhan health check.
- Cabinet Grotesk dan Inter kini disajikan dari aset lokal tanpa request font ke
  CDN eksternal.

### Removed

- Endpoint synchronous `POST /v1/extract/markdown`; ekstraksi kini hanya melalui
  job asynchronous agar client selalu membuat job, memantau status, lalu mengambil
  hasil Markdown.

### Security

- API key dibuat dari bilangan acak kriptografis 256-bit dan hanya ditampilkan
  satu kali kepada pengguna.
- Server hanya menyimpan hash SHA-256 dan prefix API key, bukan key asli.
- Perbandingan hash API key menggunakan operasi constant-time.
- Rotasi langsung menonaktifkan key sebelumnya dan pencabutan menghapus akses
  client eksternal.
- Login dan konfirmasi enrollment dibatasi lima percobaan gagal per alamat IP
  dalam lima menit.
- Secret TOTP ditulis dengan mode file `0600` pada sistem yang mendukung
  permission POSIX.

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
