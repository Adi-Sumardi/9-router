import type { ChatMessage } from './routerClient';

/**
 * Pemangkasan riwayat percakapan supaya context window tidak jebol di task panjang.
 * Dipisah sebagai fungsi murni agar bisa diuji: ada satu invariant yang kalau dilanggar
 * langsung merusak percakapan, yaitu setiap `tool_calls` pada pesan assistant WAJIB tetap
 * punya pesan `role: 'tool'` pasangannya. Karena itu fungsi ini hanya boleh MEMENDEKKAN
 * isi pesan, tidak pernah menghapus pesan.
 */

export const COMPACTION_MIN_TOTAL_CHARS = 25000;
export const COMPACTION_KEEP_LAST = 3;
/** Hasil tool yang lebih panjang dari ini dipangkas saat compaction berjalan. */
export const TOOL_RESULT_MAX_CHARS = 600;

export function compactHistory(history: ChatMessage[]): void {
  if (history.length <= 6) return;

  const totalChars = history.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  if (totalChars < COMPACTION_MIN_TOTAL_CHARS) return;

  // Pertahankan utuh: index 0 (system prompt), index 1 (prompt asli user), dan beberapa
  // pesan terakhir — konteks terbaru justru yang paling dibutuhkan model.
  const startIndex = 2;
  const endIndex = history.length - COMPACTION_KEEP_LAST;

  for (let i = startIndex; i < endIndex; i++) {
    const msg = history[i];

    // Jalur native tool-calling: seluruh isi besar (isi file, hasil grep, output perintah)
    // ada di pesan `role: 'tool'`, BUKAN di pesan user. Versi lama hanya menyentuh pesan
    // user berpola teks legacy, jadi di jalur native — yang sekarang jadi jalur utama —
    // compaction praktis tidak melakukan apa-apa.
    if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > TOOL_RESULT_MAX_CHARS) {
      msg.content = `${msg.content.slice(0, 300)}\n[... hasil tool lama dipangkas untuk menghemat context (${msg.content.length} karakter). Panggil ulang tool-nya kalau detail ini masih dibutuhkan.]`;
      continue;
    }

    // Jalur legacy (tag teks <sendago_*>): hasil eksekusi menumpang di pesan user.
    if (msg.role === 'user' && typeof msg.content === 'string') {
      if (msg.content.includes('[Observed Command Output]')) {
        msg.content = msg.content.replace(
          /\[Observed Command Output\]\s*\$ ([^\n]+)\s*Status: Success[^\n]*\nOutput:\s*```[\s\S]*?```/g,
          '[Past Command: "$1" completed successfully]'
        );
      }
      if (msg.content.includes('[File Content:')) {
        msg.content = msg.content.replace(
          /\[File Content: ([^\]]+)\]\s*```[\s\S]*?```/g,
          '[File "$1" was previously inspected]'
        );
      }
      if (msg.content.includes('[Workspace Grep Search')) {
        msg.content = msg.content.replace(
          /\[Workspace Grep Search for "[^"]+" \(\d+ matches\)\]:[\s\S]*?(?=\n\[|$)/g,
          '[Prior Grep search completed]'
        );
      }
    }
  }
}
