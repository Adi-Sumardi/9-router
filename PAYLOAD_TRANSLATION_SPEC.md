# Payload Translation Specification — AI Gateway

Spesifikasi teknis untuk adapter translasi payload antara berbagai standar API AI di gateway 9Router & SendaGo AI Gateway.

---

## 1. Arsitektur Adapter Translasi

```
           [ Client Request ]
  (OpenAI Format OR Anthropic Messages Format)
                   │
                   ▼
       ┌───────────────────────┐
       │ Inbound Normalizer    │ ──► Menghasilkan Intermediate Representation (IR)
       └───────────┬───────────┘
                   │
       ┌───────────▼───────────┐
       │     Router Core       │ ──► Menentukan Target Provider
       └───────────┬───────────┘
                   │
       ┌───────────▼───────────┐
       │ Outbound Serializer   │ ──► Mengubah IR ke Format Native Provider Target
       └───────────┬───────────┘
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
  OpenAI       Anthropic      Google Gemini
(/v1/chat)   (/v1/messages)  (:generateContent)
```

---

## 2. Pemetaan Format Request Utama

| Elemen Payload | OpenAI Standard | Anthropic Messages | Google Gemini Native |
| :--- | :--- | :--- | :--- |
| **System Prompt** | `messages[role='system']` | Parameter root: `system: "..."` | `systemInstruction: { parts: [...] }` |
| **Message Roles** | `system`, `user`, `assistant`, `tool` | `user`, `assistant` | `user`, `model` |
| **Tool / Function Schema** | `tools: [{ type: "function", function: { ... } }]` | `tools: [{ name, description, input_schema: { ... } }]` | `tools: [{ functionDeclarations: [{ ... }] }]` |
| **Tool Call Result** | `messages[role='tool', tool_call_id='...']` | `messages[role='user', content: [{ type: 'tool_result', tool_use_id: '...' }]]` | `contents[{ role: 'user', parts: [{ functionResponse: { ... } }] }]` |
| **Max Tokens** | `max_tokens` / `max_completion_tokens` | `max_tokens` (Wajib diisi) | `generationConfig.maxOutputTokens` |
| **Temperature** | `temperature` (0.0 - 2.0) | `temperature` (0.0 - 1.0) | `generationConfig.temperature` (0.0 - 2.0) |

---

## 3. Penanganan Reasoning / Extended Thinking Token

Model generasi terbaru (Claude 3.7 Sonnet, DeepSeek-R1, OpenAI o1/o3-mini) memiliki mekanisme penalaran yang berbeda:

1. **DeepSeek-R1 (OpenAI Compatible):**
   * Output menyertakan field `reasoning_content` di dalam `delta` streaming.
2. **Claude 3.7 Sonnet (Anthropic Native):**
   * Menggunakan block `{ type: "thinking", thinking: "...", signature: "..." }` di dalam content array.
3. **Gateway Normalization Rule:**
   * Jika client adalah OpenAI-compatible, block `thinking` dari Anthropic dipetakan ke field `reasoning_content` atau diteruskan secara transparan jika client mendukung delta thinking.
   * Parameter `budget_tokens` pada Anthropic dipetakan dari `reasoning_effort` pada OpenAI jika tersedia.

---

## 4. Streaming Response Normalization (SSE)

Gateway wajib menstandarkan *Server-Sent Events* ke format OpenAI chunk:

```text
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1740000000,"model":"claude-3-7-sonnet","choices":[{"index":0,"delta":{"content":"Halo"},"finish_reason":null}]}
```

Ketika target provider adalah Anthropic (`content_block_delta`):
* Event `content_block_delta` dengan `text_delta` diubah menjadi `delta.content`.
* Event `message_stop` diubah menjadi `finish_reason: "stop"` diikuti chunk akhir `data: [DONE]`.

---

## 5. Tool Calling Translation Flow

### Dari OpenAI Client ➡️ Menuju Anthropic Provider:
1. Ekstrak `tools[i].function` ➡️ ubah menjadi `tools[i]` dengan `input_schema: function.parameters`.
2. Saat model mengembalikan response `tool_use`, ubah menjadi OpenAI format `tool_calls: [{ id, type: 'function', function: { name, arguments } }]`.
3. Saat client mengirim hasil `role: "tool"`, ubah menjadi format `role: "user"` dengan block `tool_result` yang sesuai untuk Anthropic.
