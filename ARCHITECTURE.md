# Architecture — 9Router Lab

## 1. High-level

```text
┌─────────────────────────────────────────────┐
│                  AI CLIENTS                 │
│ Antigravity │ Claude │ Cursor │ Codex │ CLI │
└──────────────────────┬──────────────────────┘
                       │
                       │ OpenAI-compatible
                       ▼
┌─────────────────────────────────────────────┐
│                  9ROUTER                    │
│                                             │
│ API Gateway                                 │
│ Authentication                              │
│ Model Registry                               │
│ Provider Manager                             │
│ Routing                                      │
│ Fallback                                     │
│ Streaming                                    │
│ Token Saver / RTK                            │
│ Dashboard                                    │
└──────────────┬──────────────────────────────┘
               │
       ┌───────┼────────┬─────────┐
       ▼       ▼        ▼         ▼
    OpenAI  Anthropic  Google   Other APIs
       │       │        │         │
       └───────┴────────┴─────────┘
                       │
                       ▼
                    Response
```

## 2. Local topology

```text
Mac/Windows/Linux
│
├── 9Router :20128
│    ├── Web Dashboard
│    ├── /v1 API
│    ├── Provider Manager
│    └── SQLite
│
└── AI Clients
     ├── Antigravity
     ├── Claude Code
     ├── Cursor
     ├── Codex
     └── Cline/OpenCode
```

## 3. Request flow

```text
Client
  ↓
API Key validation
  ↓
Request normalization
  ↓
Model lookup
  ↓
Routing policy
  ↓
Provider selection
  ↓
Provider adapter
  ↓
External AI API
  ↓
Response normalization
  ↓
Streaming/non-streaming response
  ↓
Client
```

## 4. Fallback flow

```text
Request
  ↓
Primary Provider
  ├── success → response
  │
  └── failure
       ↓
   Secondary Provider
       ├── success → response
       │
       └── failure
            ↓
       Tertiary Provider
            ↓
         response
```

Recommended policy:

```text
Subscription
    ↓
Cheap
    ↓
Free
```

Do not assume a provider is free forever. Validate provider policy.

## 5. Data

```text
9Router
  │
  └── SQLite
       ├── provider configuration
       ├── model metadata
       ├── OAuth state/token metadata
       ├── API keys
       ├── settings
       └── usage/routing metadata
```

Exact schema must follow the installed 9Router version rather than this conceptual document.

## 6. Future SendaGo architecture

```text
                  Clients
                     │
                     ▼
             ┌───────────────┐
             │ API Gateway   │
             └───────┬───────┘
                     │
             ┌───────▼───────┐
             │ Auth / Tenant │
             └───────┬───────┘
                     │
             ┌───────▼───────┐
             │ Smart Router  │
             └───────┬───────┘
                     │
          ┌──────────┼───────────┐
          ▼          ▼           ▼
       OpenAI     Anthropic    Google
          │          │           │
          └──────────┼───────────┘
                     ▼
              Observability
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
       PostgreSQL              Redis
```

## 7. Routing policy abstraction

Future router should expose policies:

- `explicit`
- `fallback`
- `round_robin`
- `least_latency`
- `lowest_cost`
- `health_based`
- `task_based`

Example:

```text
task = coding
preferred:
  1. claude
  2. codex
  3. gemini

task = cheap
preferred:
  1. deepseek
  2. qwen
  3. kimi
```

## 8. Model Pools & Separation Strategy

Gateway membagi model ke dalam 3 virtual routing pool untuk mengontrol biaya dan performa:

```text
                     [ Incoming Client Request ]
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   [ free/* ]               [ paid/* ]             [ hybrid/* ]
 (Zero-Cost Pool)        (High-Performance)     (Smart Cascade Pool)
        │                       │                       │
 ┌──────┴──────┐         ┌──────┴──────┐         ┌──────┴──────┐
 │ Groq Cloud  │         │ Claude Pro  │         │ Step 1: Sub │
 │ Gemini Free │         │ DeepSeek API│         │ Step 2: PayG│
 │ Cloudflare  │         │ OpenAI GPT  │         │ Step 3: Free│
 └─────────────┘         └─────────────┘         └─────────────┘
```

1. **`free/*` (Zero-Cost Pool):**
   - Menjamin pengeluaran $0.
   - Mengalihkan trafik hanya ke model dengan kuota gratisan (Groq, Gemini Flash Free Tier, Cloudflare AI).
   - Cocok untuk task background: linter, git commit message, quick script, boilerplate tests.

2. **`paid/*` / `pro/*` (High-Performance Pool):**
   - Menjamin model terbaik dengan penalaran tinggi (*deep reasoning*).
   - Memanfaatkan akun subscription (Claude Pro) atau direct prepaid token (DeepSeek R1/V3, OpenAI o3/GPT-4o).
   - Tidak akan pernah di-fallback ke model gratisan yang lebih rendah kualitasnya.

3. **`hybrid/*` (Resilience & Cost Optimization Pool):**
   - Menggabungkan kelebihan keduanya: Memprioritaskan kuota subscription ➡️ fallback ke token murah (DeepSeek) ➡️ fallback terakhir ke free tier jika darurat.

