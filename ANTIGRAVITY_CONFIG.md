# Antigravity Integration Config — 9Router Gateway

Dokumen ini adalah panduan integrasi khusus untuk menghubungkan **Antigravity IDE & SDK** dengan **9Router**.

---

## 1. Konfigurasi Antigravity Client

### Environment Variables
Pastikan environment variable berikut terbaca oleh Antigravity:

```bash
export OPENAI_BASE_URL="http://localhost:20128/v1"
export OPENAI_API_KEY="<9ROUTER_GATEWAY_API_KEY>"
export ANTIGRAVITY_ROUTER_ENDPOINT="http://localhost:20128/v1"
```

---

## 2. Dynamic Model Discovery

Antigravity **tidak boleh meng-hardcode nama model**. Selalu lakukan discovery model secara dinamis dari endpoint `/v1/models`.

### Langkah-langkah Discovery:
1. Panggil `GET http://localhost:20128/v1/models` dengan header `Authorization: Bearer <KEY>`.
2. Parse JSON response untuk mendapatkan daftar `id` model yang aktif:
   ```json
   {
     "object": "list",
     "data": [
       {"id": "claude-virtually-unlimited", "object": "model"},
       {"id": "claude-3-7-sonnet-20250219", "object": "model"},
       {"id": "deepseek-chat", "object": "model"},
       {"id": "gemini-2.5-pro", "object": "model"}
     ]
   }
   ```
3. Pilih model yang sesuai dengan task:
   * **Coding / Complex Agentic Work:** `claude-virtually-unlimited` atau `claude-3-7-sonnet`.
   * **Fast / Cost-Effective Tasks:** `deepseek-chat`.

---

## 3. Streaming & Tool Calling Verification

Saat menggunakan Antigravity dengan 9Router, pastikan:
* Header `Accept: text/event-stream` dikirim saat request streaming.
* Handler chunk SSE (`data: {...}`) mendukung parsing token reasoning/thinking jika model mengembalikan delta reasoning.
* Format tool calling (`tools` dan `tool_choice`) terpetakan dengan benar sesuai provider yang aktif di 9Router.

---

## 4. Fallback Health Check Test

Untuk menguji apakah Antigravity menerima fallback dengan benar dari 9Router:
1. Buat request dengan model `claude-virtually-unlimited`.
2. Simulasikan error/limit di Provider Tier 1 pada 9Router.
3. Pastikan Antigravity tetap menerima response valid (HTTP 200) yang dialihkan ke Provider Tier 2 tanpa crash atau hanging stream.
