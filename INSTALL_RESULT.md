# SendaGo AI Gateway — Live Installation & Deployment Results

> ⚠️ **Redacted.** This file previously contained a real VPS IP address, the admin dashboard
> password, and two live API keys in plaintext. Anyone with access to this repo could use them.
> Treat all of the following as **compromised** — rotate them (see checklist below) before
> relying on this deployment again. Do not put real credentials back into this file; reference
> a secrets manager or your `.env` (which is gitignored) instead.

## 🚀 Live VPS Production Deployment (Verified)

- **VPS Host:** `<REDACTED — see your secrets manager / .env>`
- **Container Name:** `sendago-gateway`
- **Gateway Endpoint:** `http://<VPS_HOST>:20128/v1`
- **Dashboard Web UI:** `http://<VPS_HOST>:20128`
- **Zero-Disruption Audit:**
  - SIAKAD Stack (6 containers): 100% Untouched (Up 5 days uninterrupted)
  - Odoo 18 (Port 8069): 100% Untouched & Active

---

## 🔑 Authentication Credentials

Credentials are **not stored in this file**. Retrieve current values from your `.env` /
secrets manager. If you are reading this because the file used to contain real secrets:

- [ ] Rotate the admin dashboard password (`INITIAL_PASSWORD`) — the old value was the weak
      default `admin123456`.
- [ ] Revoke the Master API Key and the Team API Key via `./scripts/manage_keys.sh revoke <id>`,
      then issue new ones with `./scripts/manage_keys.sh create '<name>'`.
- [ ] Confirm port `20128` is **not** exposed directly to the public internet — put it behind
      the Caddy reverse proxy / firewall as described in [SECURITY.md](SECURITY.md).

---

## 🧪 Verified Multi-Provider Cluster & Combos

| Model / Combo ID | Provider | Latency | Status |
| :--- | :--- | :--- | :--- |
| `groq/openai/gpt-oss-120b` | Groq LPU | ~1.6s | 🟢 ACTIVE & TESTED |
| `ag/claude-sonnet-4-6` | Antigravity Claude | ~2.1s | 🟢 ACTIVE & TESTED |
| `ag/gemini-3.7-flash-high` | Antigravity Gemini | ~1.8s | 🟢 ACTIVE & TESTED |
| `claude-virtually-unlimited` | Combo Tier 1 ➡️ 2 | ~2.0s | 🟢 ACTIVE & TESTED |
| `smart-fallback-test` | Simulated Cascade | ~1.5s | 🟢 ACTIVE & TESTED |

---

## 💻 Client Configuration

Set your SendaGo VS Code Extension / Cursor / Claude Code settings to:
- **Base URL:** `http://<VPS_HOST>:20128/v1` (from your `.env`)
- **API Key:** the key you generate via `./scripts/manage_keys.sh create` (never hardcode it)
