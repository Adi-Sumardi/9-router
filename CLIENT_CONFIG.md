# Client Integration Guide — 9Router AI Gateway

Dokumen ini berisi panduan lengkap konfigurasi berbagai AI coding tools agar terhubung ke **9Router** lokal (`http://localhost:20128/v1`).

---

## 1. Claude Code CLI

Claude Code dapat dialihkan ke 9Router dengan mengeset variabel lingkungan (*environment variables*) sebelum menjalankan perintah `claude`.

### Cara Cepat (Per Sesi Terminal)
```bash
export ANTHROPIC_BASE_URL="http://localhost:20128/v1"
export ANTHROPIC_AUTH_TOKEN="<API_KEY_DARI_DASHBOARD_9ROUTER>"
export ANTHROPIC_MODEL="claude-virtually-unlimited"
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY="1"

# Jalankan claude
claude
```

### Cara Permanen (Tambahkan ke `~/.zshrc` atau `~/.bashrc`)
```bash
# 9Router Alias untuk Claude Code
function claude-router() {
  ANTHROPIC_BASE_URL="http://localhost:20128/v1" \
  ANTHROPIC_AUTH_TOKEN="<API_KEY_DARI_DASHBOARD_9ROUTER>" \
  ANTHROPIC_MODEL="claude-virtually-unlimited" \
  CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY="1" \
  claude "$@"
}
```

> **Catatan:**
> - `ANTHROPIC_AUTH_TOKEN` harus diisi API Key yang di-generate dari Dashboard 9Router (`http://localhost:20128`), **bukan** token asli Anthropic.
> - `claude-virtually-unlimited` memberi sinyal ke 9Router untuk mengeksekusi fallback cascade saat akun utama limit.

---

## 2. Cursor IDE

1. Buka **Cursor Settings** (`Cmd + ,` atau `Ctrl + ,`).
2. Masuk ke tab **Models** atau **OpenAI API Key**.
3. Centang / Aktifkan **Override OpenAI Base URL**.
4. Masukkan URL:
   ```text
   http://localhost:20128/v1
   ```
5. Masukkan **API Key** yang didapat dari 9Router Dashboard.
6. Pada daftar model, masukkan model ID yang aktif di 9Router (misal: `claude-3-7-sonnet`, `deepseek-chat`, `gpt-4o`).
7. Klik **Verify** untuk memastikan koneksi berhasil.

---

## 3. Cline / Roo Code (VS Code Extension)

1. Buka ekstensi **Cline** / **Roo Code** di sidebar VS Code.
2. Klik ikon **Settings** (roda gigi).
3. Pada dropdown **API Provider**, pilih **OpenAI Compatible**.
4. Masukkan konfigurasi:
   * **Base URL:** `http://localhost:20128/v1`
   * **API Key:** `<API_KEY_9ROUTER>`
   * **Model ID:** Model aktif di 9Router (misal: `claude-3-7-sonnet` atau `deepseek-chat`)
5. Klik **Done / Save**.

---

## 4. Antigravity Agent / Custom Python SDK

Jika Anda menggunakan Antigravity SDK atau skrip Python standar OpenAI:

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:20128/v1",
    api_key=os.environ.get("ROUTER_API_KEY", "your_9router_api_key"),
)

response = client.chat.completions.create(
    model="claude-3-7-sonnet", # atau model combo yang aktif
    messages=[
        {"role": "system", "content": "You are a helpful coding assistant."},
        {"role": "user", "content": "Tuliskan unit test untuk fungsi login."},
    ],
    stream=True,
)

for chunk in response:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()
```

---

## 5. Codex CLI / Gemini CLI / OpenCode

Untuk CLI berbasis OpenAI standard, cukup pasang:
```bash
export OPENAI_BASE_URL="http://localhost:20128/v1"
export OPENAI_API_KEY="<API_KEY_DARI_DASHBOARD_9ROUTER>"
```

---

## 6. Verifikasi Endpoint Aktif via Terminal

Sebelum menjalankan klien, lakukan tes koneksi sederhana menggunakan `curl`:

```bash
# 1. Cek Model yang tersedia di 9Router
curl -s http://localhost:20128/v1/models \
  -H "Authorization: Bearer <API_KEY_9ROUTER>" | jq .

# 2. Cek Request Chat Sederhana
curl -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <API_KEY_9ROUTER>" \
  -d '{
    "model": "claude-virtually-unlimited",
    "messages": [{"role": "user", "content": "ping"}]
  }'
```

---

## 7. Profil Pemilihan Pool (Free vs Paid vs Hybrid)

Anda dapat membuat alias terminal berbeda sesuai dengan kebutuhan biaya dan bobot tugas:

```bash
# 🟢 1. Mode Hemat / Free-Only ($0 Cost - Cocok untuk linter / unit test boilerplate)
alias claude-free='ANTHROPIC_BASE_URL="http://localhost:20128/v1" ANTHROPIC_AUTH_TOKEN="<KEY>" ANTHROPIC_MODEL="free/coding" claude'

# 🔵 2. Mode Pro / High-Performance (Akurasi & Reasoning Maksimal)
alias claude-pro='ANTHROPIC_BASE_URL="http://localhost:20128/v1" ANTHROPIC_AUTH_TOKEN="<KEY>" ANTHROPIC_MODEL="paid/claude-sonnet" claude'

# 🟡 3. Mode Hybrid (Default Cerdas: Subscription -> Cheap -> Free)
alias claude-hybrid='ANTHROPIC_BASE_URL="http://localhost:20128/v1" ANTHROPIC_AUTH_TOKEN="<KEY>" ANTHROPIC_MODEL="hybrid/coding" claude'
```

