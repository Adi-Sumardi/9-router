/**
 * Logika penyusunan urutan model — sengaja dipisah sebagai fungsi murni (tanpa dependency
 * ke `vscode`) supaya bisa diuji otomatis. Aturan urutan di sini menentukan model mana yang
 * dipakai dan kapan, jadi kesalahan kecil di sini efeknya langsung ke biaya & kualitas.
 */

export type ModelTier = 'free' | 'pro' | 'other';

/**
 * Klasifikasi kasar berdasarkan pola nama ID saja — `/v1/models` di 9Router hanya
 * mengembalikan {id, owned_by}, tidak ada metadata tier/biaya. Ini heuristik, bukan sumber
 * kebenaran: model yang namanya tidak cocok pola mana pun jatuh ke 'other' dan tetap ikut
 * dalam rantai fallback, hanya urutannya yang mungkin kurang optimal.
 */
export function categorizeModel(id: string): ModelTier {
  const lower = id.toLowerCase();
  if (/\bfree\b|groq|gemma|flash-free/.test(lower)) return 'free';
  if (/unlimited|\bpro\b|opus|sonnet|gpt-4|\bo3\b|\br1\b|deepseek/.test(lower)) return 'pro';
  return 'other';
}

function isProPool(pool: string): boolean {
  const p = pool.toLowerCase();
  return p === 'pro' || p === 'paid' || p === 'claude';
}

function isFreePool(pool: string): boolean {
  const p = pool.toLowerCase();
  return p === 'free' || p === 'free-coding';
}

function isHybridPool(pool: string): boolean {
  const p = pool.toLowerCase();
  return p === 'hybrid' || p === 'hybrid-coding';
}

function dedupe(models: string[]): string[] {
  return models.filter((m, i, arr) => arr.indexOf(m) === i);
}

/**
 * Rantai fallback untuk langkah BERAT (menulis kode, menjalankan perintah, memperbaiki error).
 * `primary` selalu dicoba pertama; sisanya diurutkan sesuai maksud tiap pool:
 * - pro    : model pro lain -> lainnya. TIDAK PERNAH turun ke model gratisan.
 * - free   : model gratisan lain -> lainnya -> pro (upaya terakhir).
 * - hybrid : pro -> lainnya -> gratisan (cascade subscription -> murah -> free).
 * - lainnya: semua model aktif, tanpa preferensi tier.
 */
export function buildModelChain(pool: string, primary: string, available: string[]): string[] {
  const others = available.filter(m => m !== primary);
  if (others.length === 0) return [primary];

  const free = others.filter(m => categorizeModel(m) === 'free');
  const pro = others.filter(m => categorizeModel(m) === 'pro');
  const rest = others.filter(m => categorizeModel(m) === 'other');

  if (isProPool(pool)) return dedupe([primary, ...pro, ...rest]);
  if (isFreePool(pool)) return dedupe([primary, ...free, ...rest, ...pro]);
  if (isHybridPool(pool)) return dedupe([primary, ...pro, ...rest, ...free]);
  return dedupe([primary, ...rest, ...pro, ...free]);
}

/**
 * Rantai untuk langkah RINGAN (mencerna hasil grep/find/read, menyusun kesimpulan akhir):
 * dahulukan model termurah. `primary` tetap ditaruh paling belakang sebagai jaring pengaman
 * supaya langkah ringan tidak pernah kehabisan kandidat.
 *
 * Pool `pro` sengaja tidak diturunkan ke model gratisan bahkan untuk langkah ringan,
 * mengikuti kebijakan paid/* di ARCHITECTURE.md.
 */
export function buildLightChain(pool: string, chain: string[]): string[] {
  if (chain.length <= 1) return chain;

  const primary = chain[0];
  const others = chain.slice(1);
  const free = others.filter(m => categorizeModel(m) === 'free');
  const rest = others.filter(m => categorizeModel(m) === 'other');
  const pro = others.filter(m => categorizeModel(m) === 'pro');

  const preferred = isProPool(pool) ? [...rest, ...pro] : [...free, ...rest, ...pro];
  return dedupe([...preferred, primary]);
}
