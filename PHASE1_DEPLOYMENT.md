# SendaGo AI Dedicated Gateway — Phase 1 Deployment Playbook

Dokumen ini adalah panduan lengkap langkah-demi-langkah untuk mendeploy **SendaGo AI Gateway** ke server produksi (Dedicated VPS / Cloud Instance) dengan keamanan tingkat tinggi, SSL otomatis, dan proteksi Cloudflare.

---

## 🏗️ 1. Persyaratan Server (VPS Specs)

| Komponen | Spesifikasi Minimum | Rekomendasi Produksi |
| :--- | :--- | :--- |
| **OS** | Ubuntu 22.04 / 24.04 LTS atau Debian 12 | Ubuntu 24.04 LTS |
| **CPU** | 2 vCPU | 4 vCPU |
| **RAM** | 4 GB | 8 GB |
| **Storage** | 40 GB NVMe SSD | 80 GB NVMe SSD |
| **Network** | 1 Gbps Port, Public IPv4 | 1 Gbps, Static IPv4 |
| **Providers** | Hetzner, DigitalOcean, AWS Lightsail, Linode | Hetzner Cloud (CX32) |

---

## 🔒 2. Setup Awal & Keamanan Server (Hardening)

Setelah VPS aktif dan Anda login via SSH:

```bash
# 1. Update sistem operasi
sudo apt update && sudo apt upgrade -y

# 2. Pasang dependensi dasar
sudo apt install -y curl git ufw fail2ban jq htop gzip

# 3. Setup Firewall UFW (Hanya buka SSH, HTTP, HTTPS)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (Caddy Auto-SSL)
sudo ufw allow 443/tcp   # HTTPS (Caddy Auto-SSL)
sudo ufw enable

# 4. Pasang Docker & Docker Compose
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

---

## 🌐 3. Konfigurasi Cloudflare & DNS

1. Tambahkan **A Record** di dashboard Cloudflare:
   * **Type:** `A`
   * **Name:** `ai` (sehingga menjadi `ai.sendago.id`)
   * **IPv4 address:** `<IP_PUBLIC_VPS_ANDA>`
   * **Proxy status:** 🟠 **Proxied** (Aktifkan untuk proteksi DDoS & WAF)
2. Di menu **SSL/TLS**:
   * Ubah mode enkripsi menjadi **Full (Strict)**.
3. Di menu **Security ➡️ WAF ➡️ Rate Limiting Rules**:
   * Buat aturan batasan request untuk path `/v1/*` (misal maks 120 req/menit per IP) untuk mencegah abuse.

---

## 🚀 4. Deployment SendaGo Gateway di Server

Clone repositori atau upload folder `9router` ke server VPS:

```bash
# 1. Masuk ke direktori projek di VPS
cd /opt/sendago-gateway

# 2. Buat file .env produksi
cat << 'EOF' > .env
DOMAIN=ai.sendago.id
INITIAL_PASSWORD=KATA_SANDI_SUPER_RAHASIA_ADMIN_2026
POSTGRES_DB=sendago_gateway
POSTGRES_USER=sendago_admin
POSTGRES_PASSWORD=POSTGRES_SECURE_PASS_2026
REDIS_PASSWORD=REDIS_SECURE_PASS_2026
EOF

# 3. Jalankan seluruh stack produksi
docker compose -f docker-compose.prod.yml up -d

# 4. Cek status container
docker compose -f docker-compose.prod.yml ps
```

---

## 📦 5. Setup Backup Otomatis (Cron Job)

Pasang script backup harian yang berjalan setiap pukul 02:00 pagi:

```bash
# Buka crontab
crontab -e

# Tambahkan baris berikut di bagian paling bawah:
0 2 * * * cd /opt/sendago-gateway && ./scripts/backup_db.sh >> /var/log/sendago_backup.log 2>&1
```

---

## 👥 6. Manajemen API Key Anggota Tim

Gunakan script CLI internal untuk mengelola akses developer:

```bash
# 1. Lihat semua API Key aktif
./scripts/manage_keys.sh list

# 2. Buat API Key untuk anggota tim baru
./scripts/manage_keys.sh create "Budi (Backend Lead)"
./scripts/manage_keys.sh create "Siti (Frontend Dev)"

# 3. Cabut / hapus API Key jika developer resign/pindah perangkat
./scripts/manage_keys.sh revoke <KEY_ID>
```

---

## 💻 7. Konfigurasi di Laptop Anggota Tim

Setelah server VPS aktif di `https://ai.sendago.id`, bagikan file ekstensi:
📁 **`sendago-ai-assistant-0.1.0.vsix`**

Anggota tim cukup mengubah setting di VS Code / Antigravity mereka:
* **`sendago.routerUrl`**: `https://ai.sendago.id/v1`
* **`sendago.apiKey`**: `sk-sendago-...` *(Kunci personal yang dibuat di Langkah 6)*

---

## ✅ Verifikasi & Health Check

```bash
# Uji endpoint gateway via HTTPS publik
curl -i https://ai.sendago.id/v1/models \
  -H "Authorization: Bearer sk-sendago-..."
```
