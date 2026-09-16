# PDF2AI

**PDF to AI Ready** — Aplikasi mandiri (*self-hosted*) untuk mengubah PDF digital maupun hasil scan menjadi format Markdown terstruktur yang siap dibaca, dicari, dan diolah oleh model AI.

Semua proses ekstraksi PDF dan OCR berjalan secara **lokal** di komputer Anda. Fitur **Tanya AI** bersifat opsional dan kompatibel dengan berbagai provider AI (*OpenAI-compatible*).

---

## ✨ Fitur Utama

- 📄 **Ekstraksi PDF & OCR Lokal**: Didukung oleh OpenDataLoader PDF, Docling, dan RapidOCR (ONNX Runtime) tanpa bergantung pada cloud eksternal.
- 🧠 **Manajemen Memori OCR Cerdas**: Pemangkasan buffer bitmap instan per-dokumen dan pelepasan bobot model otomatis saat idle 3 menit (*in-process lazy-unload*), memangkas konsumsi RAM dari ~3 GB ke ~80–120 MB tanpa mematikan proses server, dengan pemuatan ulang otomatis (*on-demand*) saat ada dokumen baru.
- 🎯 **Seleksi Halaman Fleksibel**: Pilih untuk mengekstrak seluruh halaman PDF atau tentukan rentang halaman kustom per berkas (misal `1-5, 8`), serta kemampuan mengubah rentang halaman di antrean saat dokumen belum diproses.
- ⚡ **Antrean Job Persisten**: Unggah banyak PDF sekaligus via drag-and-drop. Antrean dapat dijeda, dilanjutkan, dibatalkan, dan statusnya tetap aman saat server di-restart.
- 📁 **Folder Virtual**: Kelompokkan dokumen dengan mudah tanpa memindahkan file fisik dari disk.

- 💬 **Tanya AI & Template**: Ajukan pertanyaan langsung ke dokumen hasil ekstraksi menggunakan provider AI pilihan Anda.
- 🔐 **Keamanan TOTP & API Key**: Login dashboard aman menggunakan kode 6-digit authenticator (tanpa password). Akses API eksternal dilindungi oleh rotasi API Key.
- 📖 **Dokumentasi API Interaktif**: Dokumentasi terintegrasi langsung di dashboard dalam tampilan **Simple Docs** dan **Scalar API Reference**.
- 🌓 **Antarmuka Modern & Responsif**: Dashboard bersih dengan dukungan tema terang (*light*) dan gelap (*dark*) otomatis.
- 💾 **Backup & Restore**: Ekspor dan impor konfigurasi serta seluruh data dokumen dalam bentuk arsip ZIP dengan mudah.

---

## 📋 Persyaratan Sistem

| Runtime | Kebutuhan Minimum | Rekomendasi |
| :--- | :--- | :--- |
| **Node.js** | Versi 20.19.0+ | Versi LTS terbaru |
| **Java / JDK** | Versi 11+ | JDK 17 atau 21 |
| **Python** | Python 3.9+ | Python 3.10 / 3.11 |
| **RAM** | 2 GB (mode hemat memori) | 4 GB+ untuk performa optimal |

---

## 🚀 Panduan Cepat (Quick Start)

### 1. Unduh Kode Aplikasi
```bash
git clone https://github.com/FebrianYudhis/pdf2ai.git
cd pdf2ai
```

### 2. Pasang Komponen & Dependensi
```bash
npm install
npm run setup:ocr
```
> [!NOTE]
> Perintah `npm run setup:ocr` akan membuat virtual environment Python (`.venv`) dan memasang dependensi OCR lokal secara otomatis. Langkah ini hanya perlu dijalankan satu kali saat setup awal.

### 3. Jalankan Aplikasi
```bash
npm start
```
Buka browser dan akses:
```text
http://127.0.0.1:3000
```

---

## 📱 Panduan Penggunaan Dashboard

1. **Setup Keamanan Pertama Kali**:
   - Pindai kode QR yang muncul di layar dengan aplikasi Authenticator (Google Authenticator, Microsoft Authenticator, 2FAS, dll.).
   - Masukkan kode 6 digit untuk aktivasi. Login berikutnya hanya membutuhkan kode TOTP 6 digit.
2. **Unggah & Antrean Dokumen**:
   - Tarik (*drag-and-drop*) satu atau beberapa berkas PDF ke area upload.
   - Atur cakupan halaman (**Semua** atau **Kustom**, misal `1-5, 8`) per masing-masing file yang dipilih.
   - Pilih folder tujuan (opsional), lalu klik **Masukkan ke antrean**.
   - *Tips:* Anda juga dapat mengubah rentang halaman kapan saja saat dokumen masih mengantre via menu opsi (**⋮**) → **Ubah halaman**.
3. **Lihat Hasil & Tanya AI**:

   - Klik menu tiga titik (⋮) pada kartu dokumen yang sudah berstatus **Selesai**, lalu pilih **Lihat hasil**.
   - Anda dapat melihat PDF asli, metadata ekstraksi, serta menyalin/mengunduh format Markdown.
   - Buka menu **Tanya AI** untuk mulai berdiskusi dengan AI seputar isi dokumen tersebut.
4. **Pengaturan Aplikasi & AI**:
   - Buka menu **Konfigurasi** di pojok kanan atas untuk menghubungkan provider AI (OpenAI, Ollama, Groq, OpenRouter, dll.), mengatur model OCR, mengaktifkan mode hemat memori, dan mengelola API Key.

---

## 🔌 Integrasi API & Dokumentasi

PDF2AI menyediakan REST API lengkap untuk integrasi dengan aplikasi pihak ketiga.

Setelah login ke dashboard, Anda dapat mengakses dokumentasi API terintegrasi:

* **Simple Docs (`/docs`)**: Panduan cepat dan contoh penggunaan API yang ringkas.
* **Scalar Interactive Docs (`/docs/scalar`)**: Referensi API interaktif berbasis OpenAPI/Swagger. Anda dapat menguji endpoint langsung dari browser dengan memasukkan API Key Anda.

### Autentikasi API Key
Buat API Key melalui **Konfigurasi → API Key**, lalu kirimkan key tersebut melalui HTTP header:
```http
X-API-Key: <KODE_API_KEY_ANDA>
```

---

## ⚙️ Variabel Lingkungan & Konfigurasi (Opsional)

Aplikasi dapat dikonfigurasi melalui menu **Konfigurasi** di dashboard atau melalui Environment Variables:

| Variabel | Default | Deskripsi |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port server web dan API |
| `HOST` | `127.0.0.1` | Host binding server |
| `ODL_OCR_LANG` | `english` | Bahasa model OCR (`english`, `chinese_cht`, dll.) |
| `ODL_OCR_DEVICE` | `cpu` | Perangkat akselerasi OCR (`cpu`, `cuda`, `mps`, `xpu`) |
| `ODL_OCR_IDLE_TIMEOUT` | `180` | Batas idle antrean (detik) sebelum bobot model OCR dilepas dari RAM (`0` untuk nonaktif) |
| `ODL_LOW_MEMORY_MODE` | `false` | Batasi RAM & thread untuk komputer berspesifikasi rendah |
| `ODL_MAX_FILE_SIZE_MB` | `25` | Batas maksimum ukuran file upload (MB) |
| `APP_SESSION_HOURS` | `12` | Durasi sesi login dashboard (jam) |

---

## 🛠️ Perintah Administrator & Developer

```bash
# Menjalankan server aplikasi lengkap (Fastify + Python OCR)
npm start

# Menjalankan Fastify server saja
npm run server

# Menjalankan CLI konversi PDF mandiri (mendukung opsi rentang halaman: -p "1-5, 8")
npm run cli -- "dokumen.pdf" -p "1-5, 8" -o output -f markdown


# Menjalankan seluruh rangkaian automated test
npm test
```

---

## ❓ Masalah yang Sering Ditemui (Troubleshooting)

<details>
<summary><b>Port 3000 sudah digunakan (<code>EADDRINUSE</code>)</b></summary>

Gunakan port lain dengan mengatur variabel `PORT`:
```bash
PORT=3001 npm start
```
</details>

<details>
<summary><b>OCR Kehabisan Memori (<code>std::bad_alloc</code>) pada RAM Terbatas</b></summary>

Aktifkan **Mode hemat memori** di **Konfigurasi → Aplikasi**, atau jalankan dengan perintah:
```bash
ODL_LOW_MEMORY_MODE=true npm start
```
</details>

<details>
<summary><b>Penggunaan RAM Tetap Tinggi setelah Pemrosesan Dokumen</b></summary>

PDF2AI versi 1.11.0+ dilengkapi manajemen memori idle otomatis. Jika tidak ada dokumen baru dalam antrean selama 3 menit, bobot model Docling akan otomatis dilepas (*in-process lazy-unloaded*) dan memori RAM dipangkas kembali ke kisaran **~80–120 MB** tanpa mematikan proses server. Anda dapat mempercepat waktu pemangkasan RAM (misal menjadi 1 menit) melalui variabel lingkungan:
```bash
ODL_OCR_IDLE_TIMEOUT=60 npm start
```
</details>

<details>
<summary><b>Perangkat Authenticator Hilang</b></summary>

Hentikan server (`Ctrl+C`), hapus berkas `data/auth.json`, lalu jalankan kembali `npm start`. Anda akan diminta melakukan setup autentikator baru di browser.
</details>

---

## 📄 Lisensi & Riwayat Perubahan

- Riwayat pembaruan versi dapat dilihat di [CHANGELOG.md](CHANGELOG.md).
