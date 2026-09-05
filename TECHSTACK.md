# Tech Stack — 9Router Lab & Future AI Gateway

## 1. Current 9Router baseline

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Package manager | npm 10+ |
| Web framework | Next.js 16 |
| UI | React 19 |
| Database | SQLite |
| API | OpenAI-compatible `/v1` |
| Auth | API Key + OAuth/PKCE/JWT components |
| Streaming | SSE / streaming responses |
| Container | Docker |
| Architecture | Local AI gateway/router |
| License | MIT |

Versi dan dependency harus selalu diverifikasi dari repository sebelum deployment.

## 2. Local development

Recommended:

- macOS: native Node.js atau Docker
- Windows: WSL2 + Docker Desktop
- Linux: Node.js/Docker

### Baseline

```bash
node --version
npm --version
docker --version
```

Target:
- Node >= 20
- npm >= 10

## 3. Deployment

### Development
```text
Browser
  ↓
localhost:20128
  ↓
9Router
  ↓
SQLite
  ↓
AI Providers
```

### Docker
```text
Host
 └── Docker
      └── 9Router :20128
           └── /app/data
                └── SQLite
```

### Production/VPS
```text
Internet
   ↓
Cloudflare
   ↓
Nginx/Caddy
   ↓
HTTPS
   ↓
9Router
   ↓
Provider APIs
```

## 4. Future SendaGo stack

### Backend
- Node.js
- TypeScript
- Fastify atau NestJS
- PostgreSQL
- Redis
- BullMQ
- OpenTelemetry

### Gateway
- OpenAI-compatible API
- Anthropic-compatible translation layer
- Provider adapters
- Routing engine
- Fallback engine
- Circuit breaker

### Frontend
- Next.js
- React
- Tailwind CSS
- shadcn/ui

### Infrastructure
- Docker
- Docker Compose
- Nginx/Caddy
- Cloudflare
- GitHub Actions

### Monitoring
- OpenTelemetry
- Prometheus
- Grafana
- Loki/Sentry

## 5. Storage strategy

Development:
- SQLite

Production:
- PostgreSQL

Cache:
- Redis

Secrets:
- Environment variables untuk MVP
- Secret Manager/Vault untuk production

## 6. Coding standard

- TypeScript strict mode
- ESLint
- Prettier
- Unit test
- Integration test
- E2E test
- Conventional Commits
- `.env.example`
- No secrets in Git

## 7. Important design principle

Provider adapter harus dipisahkan dari routing engine.

```text
Provider Adapter
      ↓
Normalized Model Interface
      ↓
Routing Engine
      ↓
Policy
      ↓
Selected Provider
```

Dengan demikian penambahan provider tidak mengubah core router.
