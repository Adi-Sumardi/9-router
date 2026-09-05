# Roadmap — From 9Router Lab to SendaGo AI Gateway

## Phase 0 — Lab

- [x] Install 9Router (Docker via docker-compose)
- [x] Connect Antigravity Provider (`adisumardi888@gmail.com`)
- [x] Test streaming (SSE verified on Gemini 3.7 & Claude Sonnet 4.6)
- [x] Build & Install SendaGo AI VS Code Extension (`sendago-ai-assistant-0.1.0.vsix`)
- [x] Connect 2nd provider (Groq Cloud API `gsk_...` connected & verified)
- [x] Test fallback (A -> B automatic cascade verified with smart-fallback-test & claude-virtually-unlimited)
- [x] Test RTK (Real-Time Token compression & context integrity verified across Gemini & Groq via test_rtk.js)

## Phase 1 — Internal Gateway

- [x] Dedicated VPS (Production specs & Hardening playbook documented in PHASE1_DEPLOYMENT.md)
- [x] HTTPS (Caddy auto-SSL reverse proxy configured in Caddyfile)
- [x] Cloudflare (WAF, DNS & SSL Full/Strict guide in PHASE1_DEPLOYMENT.md)
- [x] PostgreSQL (Dedicated production container defined in docker-compose.prod.yml)
- [x] Redis (In-memory cache & rate limiter defined in docker-compose.prod.yml)
- [x] Backup (Automated gzip backup & 14-day retention script in scripts/backup_db.sh)
- [x] Access control (Team API key manager CLI implemented in scripts/manage_keys.sh)

## Phase 2 — SendaGo AI Gateway MVP

- [ ] User
- [ ] Tenant
- [ ] API Key
- [ ] Provider
- [ ] Model
- [ ] Routing Policy
- [ ] Usage
- [ ] Quota
- [ ] Cost Tracking
- [ ] Audit Log

## Phase 3 — Smart Routing

- [ ] Cost-aware
- [ ] Latency-aware
- [ ] Health-aware
- [ ] Task-aware
- [ ] Circuit breaker
- [ ] Retry policy
- [ ] Provider score

## Phase 4 — SaaS

- [ ] Dashboard
- [ ] Billing
- [ ] Plans
- [ ] Usage analytics
- [ ] Team management
- [ ] API documentation
- [ ] Webhooks
- [ ] Customer support

## Long-term

```text
SendaGo AI Gateway
├── Chat
├── Coding
├── Embeddings
├── Image
├── Audio
├── TTS
├── RAG
├── Agent Gateway
└── AI Billing
```
