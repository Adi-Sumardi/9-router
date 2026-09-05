# PRD — 9Router AI Gateway / Router Lab

## 1. Tujuan

Membangun lingkungan eksperimen lokal berbasis 9Router untuk menyatukan banyak AI provider/model di belakang satu endpoint OpenAI-compatible, sehingga client seperti Antigravity, Claude Code, Cursor, Codex, Gemini CLI, Cline, OpenCode, dan client kompatibel lainnya dapat menggunakan satu gateway.

> Catatan: dokumen ini adalah PRD untuk **integrasi/eksperimen menggunakan 9Router**, bukan rencana fork atau menyalin implementasi proprietary. 9Router sendiri berlisensi MIT.

## 2. Referensi versi

Baseline dokumentasi disusun berdasarkan repository publik `decolua/9router` yang saat pemeriksaan terbaru menunjukkan v0.5.40 (20 Juli 2026). Repository juga memiliki issue yang membahas build/dashboard v0.5.45, sehingga versi image/tag perlu diverifikasi sebelum deployment produksi.

## 3. Problem

Tanpa gateway:
- setiap AI client memiliki konfigurasi provider sendiri;
- perpindahan provider ketika quota/rate-limit terjadi bersifat manual;
- API key/OAuth tersebar di banyak aplikasi;
- sulit membuat strategi subscription → cheap → free;
- tool-result besar dapat meningkatkan konsumsi token.

## 4. Solusi

9Router ditempatkan sebagai AI gateway:

Client → 9Router → Provider Adapter → AI Provider → Response

Fungsi utama:
- unified endpoint;
- provider/model registry;
- OAuth/API-key provider connections;
- routing;
- fallback;
- multi-account/round-robin bila tersedia;
- streaming;
- token-saving/RTK;
- dashboard;
- usage/health visibility.

## 5. Target pengguna

- Developer individual
- AI coding power user
- Tim development kecil
- Eksperimen AI Gateway internal
- Prototype menuju SendaGo AI Gateway

## 6. Scope MVP

### P0 — wajib
- [ ] Install 9Router lokal
- [ ] Dashboard dapat dibuka
- [ ] API endpoint `/v1` aktif
- [ ] API key client dapat dibuat
- [ ] Minimal 2 provider terhubung
- [ ] Minimal 3 model dapat terdeteksi
- [ ] Antigravity dapat mengirim request melalui gateway
- [ ] Streaming response berjalan
- [ ] Fallback provider diuji
- [ ] Data SQLite persisten
- [ ] Log request/error dapat diperiksa

### P1 — setelah MVP
- [ ] Claude Code
- [ ] Cursor
- [ ] Codex
- [ ] Gemini CLI
- [ ] Cline/OpenCode
- [ ] Multi-account
- [ ] Round-robin
- [ ] RTK/token saver
- [ ] Health check provider
- [ ] Backup/restore database

### P2 — eksperimen lanjutan
- [ ] Smart routing berdasarkan model/task
- [ ] Cost-aware routing
- [ ] Latency-aware routing
- [ ] Circuit breaker
- [ ] Observability
- [ ] Multi-user gateway
- [ ] Reverse proxy + HTTPS
- [ ] VPS deployment

## 7. User stories

### US-01 — Unified endpoint
Sebagai developer, saya ingin semua AI client mengarah ke satu endpoint sehingga konfigurasi provider tidak perlu diulang.

### US-02 — Provider fallback
Sebagai developer, saya ingin request otomatis berpindah provider ketika provider utama gagal/rate-limit.

### US-03 — Model selection
Sebagai developer, saya ingin memilih model melalui model ID yang tersedia dari gateway.

### US-04 — Provider management
Sebagai admin, saya ingin melihat dan mengelola koneksi provider dari dashboard.

### US-05 — Persistence
Sebagai operator, saya ingin konfigurasi dan credential metadata tetap ada setelah restart.

### US-06 — Troubleshooting
Sebagai developer, saya ingin mengetahui provider mana yang gagal, status HTTP, dan error routing.

## 8. Functional requirements

### FR-01 Gateway
- Menyediakan endpoint OpenAI-compatible `/v1`.
- Mendukung request chat/completion yang sesuai dengan provider yang dipilih.
- Mendukung streaming jika client/provider mendukungnya.

### FR-02 Provider
- Provider dapat dikonfigurasi melalui dashboard.
- Mendukung provider OAuth dan API-key sesuai implementasi 9Router.
- Provider memiliki status connected/disconnected/error.

### FR-03 Routing
Routing minimal harus mendukung:
1. explicit model (pemanggilan langsung model ID);
2. provider/model mapping;
3. pool segmentation (`free/*`, `paid/*`, `hybrid/*`);
4. fallback cascade berjenjang;
5. round-robin untuk skenario multi-account jika tersedia.

### FR-04 Authentication
- Client menggunakan API key gateway.
- OAuth credential provider tidak boleh ditampilkan sebagai plaintext di UI.
- Jangan expose gateway tanpa authentication.

### FR-05 Persistence
- SQLite digunakan untuk data lokal sesuai implementasi 9Router.
- Data directory harus persistent pada Docker.

### FR-06 Observability
Minimal:
- request timestamp;
- provider/model;
- success/error;
- latency;
- HTTP status;
- error message yang aman.

## 9. Non-functional requirements

- Local endpoint default: `http://localhost:20128`
- API base: `http://localhost:20128/v1`
- Node.js baseline: 20+
- npm baseline: 10+
- macOS/Linux/Windows; WSL direkomendasikan untuk Windows.
- Docker image harus mendukung amd64/arm64 bila menggunakan Docker.
- Startup sederhana dan reproducible.

## 10. Security requirements

CRITICAL:
- Jangan expose port 20128 langsung ke internet.
- Untuk VPS gunakan HTTPS + reverse proxy + authentication.
- Jangan commit `.env`, OAuth token, API key, atau database credential.
- Backup database secara aman.
- Batasi provider endpoint dan outbound request sesuai kebutuhan.
- Review GitHub Security Advisories sebelum upgrade.
- Uji authentication setelah setiap upgrade.

## 11. Acceptance criteria

MVP dianggap berhasil jika:

1. `9router` berjalan tanpa crash.
2. Dashboard dapat dibuka.
3. API key berhasil dibuat.
4. `/v1/models` mengembalikan model yang valid.
5. Antigravity berhasil melakukan minimal satu request.
6. Streaming berhasil.
7. Provider A sengaja dibuat gagal/rate-limit dan request dapat fallback ke Provider B.
8. Restart gateway tidak menghilangkan konfigurasi.
9. Credential tidak muncul di log.
10. Gateway hanya dapat diakses dari localhost pada lab setup.

## 12. Out of scope

- Membuat model AI sendiri.
- Menjual akses provider secara ilegal.
- Membypass subscription/ToS provider.
- Menyimpan API key user secara plaintext.
- Membuka gateway publik tanpa authentication.
- Mengklaim semua provider gratis tanpa memeriksa ketentuan provider masing-masing.

## 13. Future — SendaGo AI Gateway

Jika eksperimen berhasil, arsitektur dapat dikembangkan menjadi produk internal:

Client → SendaGo Gateway → Router → Provider Adapter → AI Provider

Tambahan:
- tenant;
- user;
- API key management;
- quota;
- billing;
- cost tracking;
- routing policy;
- provider health;
- audit log;
- analytics.
