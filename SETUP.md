# Setup Guide — 9Router Lab

## 1. Recommended path

Untuk eksperimen pertama, gunakan desktop/local installation.

Repository docs menyebut:
- Node.js >= 20
- npm >= 10

## 2. Install via npm

```bash
npm install -g 9router
```

Start:

```bash
9router
```

Dashboard:

```text
http://localhost:20128/dashboard
```

API:

```text
http://localhost:20128/v1
```

## 3. Alternative: npx

```bash
npx 9router
```

## 4. Docker (Recommended)

Jalankan via Docker Compose:

```bash
# Pastikan INITIAL_PASSWORD sudah diset di .env
docker compose up -d
```

Atau manual via Docker CLI:

```bash
docker run -d \
  --name 9router \
  -p 127.0.0.1:20128:20128 \
  -v "$(pwd)/data:/app/data" \
  -e DATA_DIR=/app/data \
  -e INITIAL_PASSWORD=admin123456 \
  decolua/9router:latest
```

Check logs:

```bash
docker logs -f 9router
```

## 5. First test

Open:

```text
http://localhost:20128
```

Then:

1. Open Providers.
2. Connect an available provider.
3. Generate/copy gateway API key.
4. Open model list.
5. Test one model.
6. Configure Antigravity.
7. Send a small coding request.
8. Verify streaming.
9. Configure second provider.
10. Test fallback.

## 6. API test

Example:

```bash
curl http://localhost:20128/v1/models   -H "Authorization: Bearer YOUR_9ROUTER_API_KEY"
```

Do not put the real key into Git or documentation.

## 7. Antigravity

Configure the client to use:

```text
Base URL:
http://localhost:20128/v1

API Key:
<9Router API key>

Model:
<model ID shown by 9Router>
```

Do not hardcode a model ID in automation. First query `/v1/models` and use a currently available model.

## 8. Security

For local lab:

```text
localhost:20128
```

Do NOT expose:

```text
0.0.0.0:20128
```

directly to the public internet.

Before VPS deployment:
- HTTPS
- reverse proxy
- authentication
- firewall
- restricted admin access
- backups
- security advisory review

## 9. Troubleshooting

### Port busy

```bash
lsof -i :20128
```

### Docker logs

```bash
docker logs -f 9router
```

### Restart

```bash
docker restart 9router
```

### Stop/remove

```bash
docker stop 9router
docker rm 9router
```

### Update Docker image

```bash
docker pull decolua/9router:latest
docker stop 9router
docker rm 9router
# recreate using the same persistent volume
```

Always verify the image/release version before upgrading production.

## 10. Upgrade rule

Do not blindly upgrade.

Before upgrade:
1. backup `~/.9router`;
2. check release notes;
3. check GitHub Security Advisories;
4. check open issues;
5. test `/v1/models`;
6. test one provider;
7. test streaming;
8. test fallback.
