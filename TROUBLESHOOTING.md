# Troubleshooting Guide — 9Router AI Gateway

Dokumen ini berisi panduan diagnostik dan pemecahan masalah (*troubleshooting*) yang sering terjadi saat menjalankan dan mengintegrasikan 9Router.

---

## 1. Masalah: Masih Terkena Limit / Error 429 Terus-menerus

### Gejala:
Klien (Claude Code / Cursor) menampilkan pesan `429 Too Many Requests` atau `Rate Limit Exceeded` meskipun 9Router sudah dipasang.

### Penyebab & Solusi:

| Penyebab | Cara Memeriksa | Solusi |
| :--- | :--- | :--- |
| **Hanya ada 1 provider di 9Router** | Cek dashboard `http://localhost:20128/dashboard` menu *Providers*. | 9Router adalah *router*, bukan *unlimited quota generator*. Tambahkan minimal 1 provider Tier 2 (DeepSeek/Gemini) atau Tier 3 (Free). |
| **Model Combo / Mapping belum di-set** | Cek menu *Model Mapping* di Dashboard. | Pastikan model yang dipanggil klien (misal `claude-virtually-unlimited`) memiliki fallback target yang valid. |
| **Provider Tier 3 (Free) juga kena limit** | Cek status/log request di Dashboard 9Router. | Provider gratisan (Kiro/Groq) sering habis kuota RPM-nya. Siapkan provider berbayar murah ($2-$5) seperti DeepSeek API. |
| **Client nembak server asli, bukan 9Router** | Cek terminal environment variable. | Pastikan `ANTHROPIC_BASE_URL="http://localhost:20128/v1"` sudah di-export di terminal yang sama. |

---

## 2. Masalah: Error 401 Unauthorized / Token Revoked

### Gejala:
Request ditolak dengan error `401 Unauthorized` atau `Invalid Authentication`.

### Solusi:
1. **Periksa API Key Client:** Pastikan API Key yang dipakai di klien adalah **API Key yang dibuat dari Dashboard 9Router**, bukan token asli provider.
2. **Sesi OAuth Claude Kedaluwarsa:** Jika menggunakan akun Claude Pro via OAuth, Anthropic dapat me-revoke sesi login sewaktu-waktu. Buka Dashboard 9Router ➡️ *Providers* ➡️ klik *Re-authenticate / Re-login*.
3. **Format Authorization Header:** Pastikan header yang dikirim berformat `Authorization: Bearer <KEY>`.

---

## 3. Masalah: Port 20128 Bentrok (`EADDRINUSE`)

### Gejala:
9Router gagal start dengan error `listen EADDRINUSE: address already in use :::20128`.

### Solusi:
Cek proses apa yang sedang menggunakan port 20128:
```bash
# Cek PID proses di port 20128
lsof -i :20128

# Matikan proses yang bentrok (ganti PID sesuai hasil lsof)
kill -9 <PID>

# Atau jika container Docker lama masih berjalan:
docker ps -a | grep 9router
docker rm -f 9router
```

---

## 4. Masalah: Claude Code Tidak Merespons Proxy Baru

### Gejala:
Claude Code versi baru menolak model dari proxy lokal atau gagal melakukan *model discovery*.

### Solusi:
Pastikan variabel `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` diset ke `1`:
```bash
export ANTHROPIC_BASE_URL="http://localhost:20128/v1"
export ANTHROPIC_AUTH_TOKEN="<API_KEY_9ROUTER>"
export ANTHROPIC_MODEL="claude-virtually-unlimited"
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY="1"
claude
```

---

## 5. Masalah: SQLite Database Locked / Corrupted

### Gejala:
Log 9Router menampilkan `SQLITE_BUSY: database is locked` saat menerima banyak request bersamaan.

### Solusi:
1. Pastikan folder data memiliki izin baca/tulis yang benar:
   ```bash
   chmod -R 755 ~/.9router
   # atau untuk docker volume
   chmod -R 755 ./data
   ```
2. Jangan menjalankan 2 instance 9Router bersamaan yang mengakses direktori data/database yang sama.
3. Jika database rusak:
   * Backup file database: `cp ~/.9router/9router.db ~/.9router/9router.db.bak`
   * Restart 9Router untuk inisialisasi ulang skema.

---

## 6. Masalah: Docker Container Tidak Menyimpan Konfigurasi Setelah Restart

### Gejala:
Setiap kali `docker restart` atau `docker run` ulang, semua setting provider dan API key hilang.

### Solusi:
Pastikan volume mount diarahkan dengan benar ke `$HOME/.9router` atau `./data`:
```bash
# Jalankan dengan volume persisten
docker run -d \
  --name 9router \
  -p 127.0.0.1:20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  decolua/9router:latest
```

---

## 7. Masalah: Streaming Putus di Tengah Jalan (SSE Hang)

### Gejala:
Output AI berhenti mengalir di tengah kalimat saat proses pembuatan kode panjang.

### Solusi:
1. **Cek Timeout Provider:** Provider sekunder mungkin mengalami lonjakan latensi (*high latency spike*). Tambahkan timeout limit di router jika opsi tersedia.
2. **Matikan Fitur RTK Sementara:** Jika kompresi token RTK aktif dan menyebabkan stream terdistorsi, coba nonaktifkan toggle RTK di dashboard untuk mengisolasi penyebab.
3. **Cek Koneksi Internet / VPN:** Pastikan tidak ada VPN atau proxy korporat yang memutus koneksi Server-Sent Events (SSE).
