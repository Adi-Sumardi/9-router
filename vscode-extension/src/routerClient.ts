import * as vscode from 'vscode';
import { ToolDefinition } from './toolSchemas';

/** Satu tool_call terstruktur (OpenAI-compatible function-calling format). */
export interface ToolCallData {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** null diperbolehkan untuk assistant message yang isinya murni tool_calls tanpa teks. */
  content: string | null;
  /** Hanya untuk role 'assistant' yang memanggil tool secara native. */
  tool_calls?: ToolCallData[];
  /** Hanya untuk role 'tool' — menautkan hasil eksekusi ke tool_calls id di atas. */
  tool_call_id?: string;
  /**
   * True untuk pesan `role: 'user'` yang di-inject SISTEM (directive/nudge internal ke
   * model, mis. "lanjutkan/rangkum sekarang") — BUKAN prompt asli yang diketik user.
   * Ditandai supaya lapisan persistence/tampilan (SessionManager, riwayat chat) bisa
   * membedakannya dari pesan user sungguhan tanpa mengandalkan pencocokan prefix teks
   * yang rapuh.
   */
  internal?: boolean;
}

export interface ModelInfo {
  id: string;
  owned_by?: string;
}

/** Secret Storage key untuk API Key gateway (menggantikan setting plaintext lama `sendago.apiKey`) */
export const API_KEY_SECRET = 'sendago.apiKey';

export class NineRouterClient {
  constructor(private readonly _context: vscode.ExtensionContext) {}

  private get baseUrl(): string {
    const config = vscode.workspace.getConfiguration('sendago');
    return (config.get<string>('gatewayUrl') || 'http://localhost:20128/v1').replace(/\/+$/, '');
  }

  /**
   * API Key sekarang disimpan di VS Code Secret Storage (terenkripsi oleh OS keychain),
   * BUKAN di settings.json plaintext — mencegah key bocor lewat Settings Sync/dotfiles.
   */
  private async getApiKey(): Promise<string> {
    return (await this._context.secrets.get(API_KEY_SECRET)) || '';
  }

  public async setApiKey(key: string): Promise<void> {
    await this._context.secrets.store(API_KEY_SECRET, key);
  }

  public get defaultModel(): string {
    const config = vscode.workspace.getConfiguration('sendago');
    return config.get<string>('defaultModel') || 'ag/gemini-3.7-flash-high';
  }

  public get modelPool(): string {
    const config = vscode.workspace.getConfiguration('sendago');
    return config.get<string>('modelPool') || 'hybrid';
  }

  public async checkHealth(): Promise<{ ok: boolean; latencyMs: number; modelCount: number; error?: string }> {
    const startTime = Date.now();
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return { ok: false, latencyMs: 0, modelCount: 0, error: 'API Key belum diatur. Jalankan "SendaGo: Set API Key" dari Command Palette.' };
    }
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        return { ok: false, latencyMs, modelCount: 0, error: `HTTP ${res.status}: ${res.statusText}` };
      }

      const json = await res.json() as { data?: ModelInfo[] };
      const modelCount = json.data?.length || 0;
      return { ok: true, latencyMs, modelCount };
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - startTime, modelCount: 0, error: err.message || 'Connection refused' };
    }
  }

  public async getAvailableModels(): Promise<string[]> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return [];
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      if (!res.ok) return [];
      const json = await res.json() as { data?: ModelInfo[] };
      return (json.data || []).map(m => m.id);
    } catch {
      return [];
    }
  }

  private _modelsCache: { list: string[]; fetchedAt: number } | null = null;
  private static readonly MODELS_CACHE_TTL_MS = 60000;

  /** getAvailableModels() di-cache singkat — dipanggil setiap awal turn untuk membangun
   *  fallback chain, jadi tidak perlu hit /v1/models berkali-kali per detik. */
  private async getCachedModels(): Promise<string[]> {
    if (this._modelsCache && Date.now() - this._modelsCache.fetchedAt < NineRouterClient.MODELS_CACHE_TTL_MS) {
      return this._modelsCache.list;
    }
    const list = await this.getAvailableModels();
    this._modelsCache = { list, fetchedAt: Date.now() };
    return list;
  }

  /**
   * Klasifikasi kasar model berdasarkan pola nama ID-nya saja (9Router tidak mengekspos
   * metadata tier/biaya lewat /v1/models, cuma {id, owned_by}) — dipakai untuk menyusun
   * urutan fallback yang masuk akal per pool. Ini heuristik, bukan sumber kebenaran:
   * kalau nama model di gateway Anda tidak cocok pola ini, dia jatuh ke 'other' dan tetap
   * ikut di fallback chain, cuma urutannya mungkin kurang optimal.
   */
  private categorizeModel(id: string): 'free' | 'pro' | 'other' {
    const lower = id.toLowerCase();
    if (/\bfree\b|groq|gemma|flash-free/.test(lower)) return 'free';
    if (/unlimited|\bpro\b|opus|sonnet|gpt-4|\bo3\b|\br1\b|deepseek/.test(lower)) return 'pro';
    return 'other';
  }

  /**
   * Bangun daftar model fallback untuk satu pool — BUKAN cuma satu model ID seperti
   * resolveModelForPool(). Diambil dari model yang BENERAN aktif di gateway Anda
   * (/v1/models), jadi kalau Anda mengaktifkan banyak provider, semuanya jadi kandidat
   * fallback nyata — bukan cuma satu alias tetap yang selama ini dikirim.
   *
   * Urutan per pool (heuristik berdasarkan ARCHITECTURE.md):
   * - `pro`: primary -> model 'pro' lain -> lainnya. TIDAK fallback ke 'free' sama sekali
   *   (paid/* pool tidak boleh turun ke model gratisan yang kualitasnya lebih rendah).
   * - `free`: primary -> model 'free' lain -> lainnya -> 'pro' (usaha terakhir).
   * - `hybrid`: primary -> 'pro' -> lainnya -> 'free' (cascade subscription -> murah -> free).
   * - lainnya (mis. Sonnet 5 High/fusion): primary -> semua model lain, tanpa preferensi tier.
   */
  public async resolveModelChainForPool(poolOverride?: string): Promise<string[]> {
    const primary = this.resolveModelForPool(poolOverride);
    const pool = (poolOverride || this.modelPool || '').toLowerCase();

    let available: string[];
    try {
      available = await this.getCachedModels();
    } catch {
      available = [];
    }

    const others = available.filter(m => m !== primary);
    if (others.length === 0) return [primary];

    const free = others.filter(m => this.categorizeModel(m) === 'free');
    const pro = others.filter(m => this.categorizeModel(m) === 'pro');
    const rest = others.filter(m => this.categorizeModel(m) === 'other');

    if (pool === 'pro' || pool === 'paid' || pool === 'claude') {
      return [primary, ...pro, ...rest];
    }
    if (pool === 'free' || pool === 'free-coding') {
      return [primary, ...free, ...rest, ...pro];
    }
    if (pool === 'hybrid' || pool === 'hybrid-coding') {
      return [primary, ...pro, ...rest, ...free];
    }
    return [primary, ...rest, ...pro, ...free];
  }

  /**
   * @param tools Skema tool OpenAI-compatible (opsional). Model/provider yang mendukung
   *   native function-calling akan membalas lewat `delta.tool_calls` alih-alih teks tag
   *   <sendago_*> — provider yang tidak mendukungnya cukup mengabaikan field ini dan
   *   tetap membalas teks biasa sesuai instruksi system prompt (fallback tag parsing
   *   di agentEngine.ts tetap berjalan seperti sebelumnya). Ini yang membuat pendekatan
   *   HYBRID ini aman dipakai di pool free/hybrid 9Router yang model-nya beragam.
   */
  public async streamChat(
    messages: ChatMessage[],
    modelOverride?: string,
    onChunk?: (text: string) => void,
    signal?: AbortSignal,
    tools?: ToolDefinition[]
  ): Promise<{ text: string; toolCalls: ToolCallData[] }> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error('SendaGo: API Key belum diatur. Jalankan "SendaGo: Set API Key" dari Command Palette (Cmd+Shift+P).');
    }

    const model = modelOverride || this.resolveModelForPool();
    const config = vscode.workspace.getConfiguration('sendago');
    const temperature = config.get<number>('temperature') ?? 0.2;

    // BUG FIX: sebelumnya tidak ada batas waktu sama sekali di luar `signal` milik user
    // (tombol Stop) — kalau gateway/model provider hang di tengah jalan (network hiccup,
    // upstream provider gantung), `await reader.read()` bisa menunggu SELAMANYA tanpa
    // error apa pun, dan UI cuma diam menampilkan shimmer loader tanpa batas (dilaporkan
    // user: macet total di step terakhir tanpa pesan apa pun). Sekarang setiap fase
    // (menunggu response awal, menunggu potongan stream berikutnya) punya inactivity
    // timeout terpisah dari AbortController milik user, supaya kalau macet, user dapat
    // pesan error yang jelas alih-alih diam selamanya.
    const INACTIVITY_TIMEOUT_MS = 90000;
    const internalController = new AbortController();
    const onExternalAbort = () => internalController.abort();
    signal?.addEventListener('abort', onExternalAbort);

    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    const armInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => internalController.abort(), INACTIVITY_TIMEOUT_MS);
    };
    const disarmInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = undefined;
    };
    // True hanya kalau abort ini berasal dari timer inactivity kita, BUKAN dari user klik Stop
    // (yang juga men-trigger internalController via forwarding) — jaga pesan 'stopped' asli
    // tombol Stop tetap seperti semula, hanya hang murni yang dapat pesan timeout baru ini.
    const isInactivityAbort = (err: unknown) =>
      err instanceof Error && err.name === 'AbortError' && !signal?.aborted;

    try {
      armInactivityTimer();
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            stream: true,
            ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {})
          }),
          signal: internalController.signal
        });
      } catch (err) {
        if (isInactivityAbort(err)) {
          throw new Error(`SendaGo: Gateway 9Router tidak merespons selama lebih dari ${INACTIVITY_TIMEOUT_MS / 1000} detik (koneksi kemungkinan macet). Periksa status gateway lalu coba lagi.`);
        }
        throw err;
      }

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`9Router error (${res.status}): ${errBody}`);
      }

      let fullText = '';
      const body = res.body;
      if (!body) throw new Error('Response body is empty');

      const reader = body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      // Delta tool_calls datang bertahap (nama & argumen di-stream per-karakter/potongan),
      // diindeks oleh `index` per OpenAI streaming spec — harus diakumulasi sampai selesai.
      const toolCallAccum = new Map<number, { id: string; name: string; args: string }>();

      while (true) {
        armInactivityTimer(); // reset tiap menunggu potongan berikutnya — timeout = INACTIVITY, bukan total durasi
        let readResult;
        try {
          readResult = await reader.read();
        } catch (err) {
          if (isInactivityAbort(err)) {
            throw new Error(`SendaGo: Tidak ada data baru dari gateway selama lebih dari ${INACTIVITY_TIMEOUT_MS / 1000} detik (koneksi kemungkinan macet di tengah jalan). Coba ulangi permintaan.`);
          }
          throw err;
        }

        const { done, value } = readResult;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const delta = data.choices?.[0]?.delta;
              if (delta?.content) {
                fullText += delta.content;
                onChunk?.(delta.content);
              }
              if (Array.isArray(delta?.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = typeof tc.index === 'number' ? tc.index : 0;
                  const existing = toolCallAccum.get(idx) || { id: '', name: '', args: '' };
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name += tc.function.name;
                  if (tc.function?.arguments) existing.args += tc.function.arguments;
                  toolCallAccum.set(idx, existing);
                }
              }
            } catch {
              // ignore non-JSON stream chunks
            }
          }
        }
      }

      const toolCalls: ToolCallData[] = Array.from(toolCallAccum.entries())
        .sort(([a], [b]) => a - b)
        .map(([idx, tc]) => ({
          id: tc.id || `call_${idx}_${Date.now()}`,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.args }
        }))
        .filter(tc => tc.function.name);

      return { text: fullText, toolCalls };
    } finally {
      disarmInactivityTimer();
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  public resolveModelForPool(poolOverride?: string): string {
    const pool = poolOverride || this.modelPool;
    if (!pool) return 'claude-sonnet-5-fusion';
    if (pool === 'sonnet-5' || pool === 'claude-sonnet-5' || pool === 'claude-sonnet-5-fusion') {
      return 'claude-sonnet-5-fusion';
    } else if (pool === 'free' || pool === 'free-coding') {
      return 'free-coding';
    } else if (pool === 'pro' || pool === 'paid' || pool === 'claude') {
      return 'claude-virtually-unlimited';
    } else if (pool === 'hybrid' || pool === 'hybrid-coding') {
      return 'claude-sonnet-5-fusion';
    }
    // Anything else is treated as a direct model ID — either a discovered model
    // (e.g. "claude-virtually-unlimited", "smart-fallback-test") or a namespaced
    // one (e.g. "ag/gemini-3.7-flash-high") — both pass straight through.
    return pool;
  }
}
