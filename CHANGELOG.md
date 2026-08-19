# Changelog

Semua perubahan penting PDF2AI dicatat dalam file ini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.1] - 2026-08-19

### Changed

- Memperbarui tampilan tab **Konfigurasi API Key** dengan desain yang lebih modern dan informatif:
  - Indikator status key berbentuk badge (Aktif / Nonaktif) beserta ringkasan spesifikasi header (`X-API-Key`), prefix key, dan cakupan scope akses (`/v1/*`).
  - Tautan langsung (_pills_) ke dokumentasi Simple Guide dan Scalar OpenAPI.
  - Kartu contoh integrasi cURL interaktif lengkap dengan tombol salin cepat.
  - Peningkatan dialog konfirmasi rotasi API key menggunakan SweetAlert terintegrasi menggantikan `window.confirm` bawaan browser.

## [1.7.0] - 2026-08-19

### Added

- Fitur **Jeda & Lanjutkan Antrean (Pause & Resume)** untuk menahan atau melanjutkan pemrosesan dokumen secara manual dari dashboard maupun REST API.
- Persistensi status jeda antrean ke disk (`.queue-state.json`), menjaga status antrean tetap terjeda saat server dimatikan atau di-restart.
- Banner notifikasi **"Antrean dijeda"** di dashboard dengan tombol aksi cepat untuk melanjutkan antrean.
- Fitur **Batalkan Dokumen (Cancel Job)** untuk membatalkan proses dokumen yang masih mengantre (`queued`) maupun yang sedang diekstrak (`processing`), dengan status akhir diubah menjadi `failed` ("Dibatalkan oleh pengguna.").
- Endpoint REST API baru:
  - `POST /v1/queue/pause` untuk menjeda pemrosesan antrean.
  - `POST /v1/queue/resume` untuk melanjutkan kembali pemrosesan antrean.
  - `POST /v1/jobs/:id/cancel` untuk membatalkan dokumen tertentu.
- Informasi status `paused: boolean` pada objek `stats` di endpoint `GET /v1/jobs` dan `GET /v1/health`.
- Fitur **Paginasi Riwayat Dokumen** dengan batas 6 item per halaman, lengkap dengan kontrol navigasi halaman (Sebelumnya, Nomor Halaman, Selanjutnya) dan informasi rentang dokumen yang otomatis aktif saat dokumen melebihi 6 item.
- Dokumentasi interaktif OpenAPI (Scalar) dan dokumentasi Simple (`/docs`) untuk endpoint kontrol antrean dan pembatalan dokumen.

### Changed

- Mengganti garis animasi horizontal (_progress track_) pada kartu dokumen yang sedang diproses dengan animasi _spinning loader_ mikro di dalam badge status "Memproses" agar tampilan kartu lebih bersih dan lega.

### Fixed

- Memperbaiki aturan CSS specificity pada atribut `[hidden]` sehingga banner antrean tidak lagi muncul saat status antrean aktif/berjalan.
- Memperbaiki masalah _stacking context_ pada menu aksi dokumen dengan menaikkan `z-index` kartu yang aktif (`.is-action-open` / `:has(.job-action-menu[open])`) agar panel dropdown tidak tertutup atau muncul di belakang kartu dokumen lain di dalam grid.

## [1.6.0] - 2026-08-15

### Added

- Opsi **Mode hemat memori** pada konfigurasi aplikasi untuk membatasi batch
  halaman dan thread Docling, lengkap dengan environment override
  `ODL_LOW_MEMORY_MODE` dan indikator restart.
- Pilihan bahasa OCR berbentuk select dengan informasi model dan kecocokan
  bahasa yang diperbarui langsung saat pilihan berubah.

### Changed

- Redesign riwayat dokumen menjadi grid card responsif dengan status yang lebih
  mudah dipindai serta menu tiga titik yang dilengkapi ikon untuk setiap aksi.
- Sinkronisasi dua arah antara filter folder riwayat dan pilihan folder tujuan
  upload; **Semua dokumen** tidak mengubah tujuan karena bukan folder fisik.
- Batas ukuran pada area upload kini mengikuti konfigurasi aktif serta
  menampilkan nilai yang baru berlaku setelah restart atau berasal dari
  environment override.
- Menghapus card informasi OCR di area hero agar tampilan utama lebih ringkas.
- Menghapus catatan privasi di bagian bawah panel upload.
- Memindahkan status kesiapan API dan OCR dari navbar ke card pada area utama.
- Waktu pembaruan riwayat kini menyertakan tanggal lengkap dan memakai pemisah
  waktu titik dua.

### Fixed

- Toast dan SweetAlert kini ditempatkan pada modal aktif agar selalu tampil di
  depan, bukan di balik backdrop dialog.
- Mode hemat memori kini membatasi antrean serta batch internal OCR, layout,
  dan tabel menjadi satu item, lalu memakai skala OCR 144 DPI.

## [1.5.0] - 2026-08-10

### Changed

- File backend dan frontend berukuran besar dipisahkan berdasarkan tanggung
  jawab: konfigurasi, autentikasi, HTTP, OCR, referensi DOM, utilitas UI, menu
  mobile, controller konfigurasi, serta stylesheet autentikasi dan dokumentasi.

## [1.4.0] - 2026-08-10

### Added

- Sub-navbar dokumentasi untuk berpindah langsung antara panduan **Simple** di
  `/docs` dan dokumentasi interaktif **Scalar** di `/docs/scalar`.
- Spesifikasi OpenAPI JSON/YAML yang dibuat otomatis, dukungan **Try it**, serta
  autentikasi `X-API-Key` dan cookie sesi melalui Scalar.
- Rute dokumentasi manual lama `/guide` tetap kompatibel dan dialihkan ke
  `/docs`.

## [1.3.2] - 2026-08-10

### Fixed

- Panel hasil PDF, metadata, dan Markdown kini mempertahankan tinggi area
  tampilannya serta dapat di-scroll ketika isi dokumen panjang.
- Klik pada backdrop kini menutup dialog hasil dokumen, Fetch Data,
  konfigurasi, dan Tanya AI tanpa menutup dialog saat area di dalamnya diklik.

### Changed

- Dialog utama kini memiliki nama aksesibel yang terhubung ke judulnya melalui
  `aria-labelledby` agar konteks dialog lebih jelas bagi pembaca layar.

## [1.3.1] - 2026-08-01

### Added

- Indikator **AI menjawab…** per dokumen selama permintaan Tanya AI masih
  diproses di latar belakang.
- Dialog error SweetAlert2 yang langsung menampilkan nama dokumen dan pesan
  kegagalan dari provider AI atau jaringan.

### Changed

- Permintaan Tanya AI kini berjalan independen dan paralel antar-dokumen.
  Setelah pertanyaan dikirim, dialog ditutup otomatis sehingga pengguna dapat
  langsung menanyakan dokumen lain tanpa menunggu respons sebelumnya selesai.
- Konteks setiap permintaan dikunci ke dokumen, model, template, dan pesan saat
  eksekusi agar respons paralel tidak tertukar ketika pengguna berpindah file.

## [1.3.0] - 2026-08-01

### Added

- Folder virtual persisten untuk mengelompokkan dokumen tanpa memindahkan file
  fisiknya, lengkap dengan filter dashboard, pilihan folder saat upload,
  pemindahan dokumen, ubah nama, dan penghapusan folder yang aman bagi PDF.
- Endpoint `/v1/folders` untuk membaca isi dan mengelola folder dari dashboard,
  serta `PATCH /v1/jobs/:id` untuk attach/detach dokumen.

### Changed

- API key dapat membaca daftar folder, melihat job di dalam folder, serta
  attach/detach job. Pembuatan, rename, dan penghapusan folder dibatasi ke sesi
  dashboard.

## [1.2.1] - 2026-08-01

### Added

- Konfigurasi aplikasi persisten dari dashboard untuk perangkat OCR
  (`cpu`, `auto`, `cuda`, `mps`, atau `xpu`), strategi ekstraksi, paksa OCR,
  bahasa OCR, batas upload, timeout AI, dan durasi sesi.
- Endpoint berbasis sesi `GET /auth/app-config` dan `PUT /auth/app-config`
  untuk membaca serta menyimpan pengaturan aplikasi di `data/app-config.json`.
- Indikator restart dan environment override agar pengguna dapat membedakan
  pengaturan tersimpan dengan runtime yang sedang aktif.

### Changed

- Navigasi dashboard disederhanakan menjadi tiga aksi berikon: **Docs**,
  **Konfigurasi**, dan **Keluar**.
- Pengaturan aplikasi, provider AI, template pertanyaan, dan API key kini
  dikelola dari satu modal konfigurasi responsif.

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
