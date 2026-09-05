# Provider Matrix — Experiment & Pool Tracking

Dokumen ini memetakan seluruh provider AI yang didukung, dikelompokkan berdasarkan kategori **Gratis (Free Tier)** dan **Berbayar (Paid / Subscription)**.

---

## 🟢 1. Free Tier Pool (`free/*`)
> **Tujuan:** $0 Cost, cocok untuk tugas repetitif, linting, unit test boilerplate, dan token-heavy subagent workflows.

| Provider | Auth Type | Model ID Rekomendasi | Rate Limit (RPM/TPM) | Streaming | Fallback Target | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Google AI Studio** | API Key (Free) | `gemini-2.5-flash` | 15 RPM / 1M TPM | `[OK]` | `groq/llama-3.3-70b` | `READY` |
| **Groq Cloud** | API Key (Free) | `llama-3.3-70b-versatile` | 30 RPM / 6k TPM | `[OK]` | `cloudflare/qwen` | `READY` |
| **Cloudflare Workers AI** | API Key (Free) | `@cf/meta/llama-3.3-70b` | 10k req/hari | `[OK]` | `opencode/free` | `TESTING` |
| **Kiro / OpenCode** | Built-in Free | `kiro-free-coder` | Dynamic Shared | `[OK]` | `None (End of Line)`| `TESTING` |

---

## 🔵 2. Paid / Subscription Pool (`paid/*` / `pro/*`)
> **Tujuan:** Maksimal akurasi, reasoning mendalam, refactoring arsitektur besar.

| Provider | Auth Type | Model ID Rekomendasi | Pricing Model | Streaming | Fallback Target | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Anthropic (Claude Code)**| OAuth / Pro Sub | `claude-3-7-sonnet` | $20/mo Subscription | `[OK]` | `deepseek/v3` | `READY` |
| **DeepSeek API** | API Key (Prepaid)| `deepseek-chat` (V3) | Pay-as-you-go ($0.14/1M) | `[OK]` | `deepseek/r1` | `READY` |
| **DeepSeek Reasoner** | API Key (Prepaid)| `deepseek-reasoner` (R1)| Pay-as-you-go ($0.55/1M) | `[OK]` | `openai/gpt-4o` | `READY` |
| **OpenAI** | API Key (Prepaid)| `gpt-4o` / `o3-mini` | Pay-as-you-go | `[OK]` | `google/gemini-pro` | `READY` |
| **MiniMax / GLM** | API Key (Prepaid)| `minimax-text-01` | Ultra-low cost pay-as-you-go| `[OK]`| `deepseek/v3` | `TESTING` |

---

## 🟡 3. Hybrid Cascade Pool (`hybrid/*`)
> **Tujuan:** Alur fallback cerdas dari subscription ke pay-per-token murah hingga safety net gratisan.

```text
[hybrid/coding]
  ├── Step 1 (Primary):   Claude 3.7 Sonnet (Akun Subscription)
  ├── Step 2 (Fallback 1): DeepSeek-V3 (Pay-as-you-go Murah)
  └── Step 3 (Fallback 2): Gemini 2.5 Flash / Groq (Free Tier Safety Net)
```

---

## 📋 Aturan Pengujian Provider
1. Catat model ID yang dikembalikan secara aktual oleh live endpoint `/v1/models`.
2. Jangan berasumsi provider gratis akan selalu gratis/aktif selamanya; uji status ketersediaan secara berkala.
3. Batasi kuota API key berbayar dengan *Hard Spending Limit* di dashboard masing-masing provider.
