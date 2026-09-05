# Security & Risk Register — 9Router Lab

## 1. Threat model

9Router is an AI proxy. A compromised or exposed gateway can become:
- unauthorized AI relay;
- API credential exposure point;
- SSRF pivot;
- abuse endpoint;
- cost amplification point.

## 2. Critical controls

### Network
- Bind local lab to localhost where possible.
- Never publish port 20128 directly.
- Use firewall on VPS.
- Put HTTPS reverse proxy in front of public deployment.

### Credentials
- Never commit API keys.
- Never commit OAuth tokens.
- Never upload SQLite database containing credentials.
- Rotate credentials after accidental exposure.

### Logs
Do not log:
- Authorization headers
- API keys
- OAuth refresh tokens
- sensitive prompt content unless explicitly required.

### Updates
Review:
- GitHub releases
- Security advisories
- open issues
- provider-specific breaking changes

## 3. Known repository security context

The public repository has published security advisories in July 2026 covering issues including authentication bypass, SSRF, MCP-related RCE, mass-assignment authorization downgrade, and unauthenticated proxy access in older versions.

Therefore:
- use a current patched release;
- do not assume an old image tag is safe;
- verify the exact installed version.

## 4. Production security target

```text
Internet
  ↓
Cloudflare
  ↓
WAF / Rate Limit
  ↓
Nginx/Caddy HTTPS
  ↓
Auth
  ↓
9Router
  ↓
Provider APIs
```

## 5. Future SendaGo controls

- tenant isolation
- RBAC
- per-user API keys
- per-tenant quotas
- budget limits
- provider allowlist
- outbound URL validation
- SSRF protection
- circuit breaker
- request size limit
- rate limit
- audit log
- secret manager
- encryption at rest
