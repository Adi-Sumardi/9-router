import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChatMessage } from './routerClient';

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  workspaceName: string;
}

export interface Session extends SessionMeta {
  messages: ChatMessage[];
}

/**
 * True hanya untuk pesan yang layak ditampilkan sebagai riwayat chat sungguhan ke user:
 * prompt asli user, dan jawaban asli assistant yang punya teks. Pesan `role: 'tool'`
 * (hasil eksekusi native tool-calling) dan pesan `role: 'user'` yang ditandai `internal`
 * (directive/nudge yang di-inject sistem ke model, mis. "lanjutkan/rangkum sekarang")
 * BUKAN percakapan sungguhan — kalau ikut disimpan/ditampilkan, riwayat chat akan penuh
 * teks directive mentah berulang-ulang alih-alih obrolan yang sebenarnya terjadi.
 */
export function isVisibleMessage(m: ChatMessage): boolean {
  if (m.internal) return false;
  if (m.role !== 'user' && m.role !== 'assistant') return false;
  return typeof m.content === 'string' && m.content.trim().length > 0;
}

/**
 * Filter ke pesan yang layak ditampilkan/disimpan, SEKALIGUS lepas field `tool_calls` dari
 * assistant message yang lolos filter. Perlu: kalau kita membuang pesan `role: 'tool'`
 * (hasil eksekusi native tool-calling) tapi tetap menyisakan `tool_calls` di assistant
 * message pasangannya, hasilnya jadi referensi tool_calls yatim — request berikutnya ke
 * provider native tool-calling akan invalid (400). Dipakai untuk riwayat yang ditampilkan
 * ke user MAUPUN untuk merekonstruksi `_history` saat sebuah sesi lama dibuka kembali.
 */
export function sanitizeMessagesForHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter(isVisibleMessage)
    .map(m => (m.role === 'assistant' && m.tool_calls ? { role: m.role, content: m.content } : m));
}

export class SessionManager {
  private static readonly SESSION_DIR = '.sendago/sessions';

  /**
   * Mendapatkan direktori sessions untuk workspace aktif
   */
  private static getSessionsDir(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;

    // Simpan di workspace pertama (root project)
    const root = folders[0].uri.fsPath;
    const dir = path.join(root, this.SESSION_DIR);

    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      return null;
    }
  }

  /**
   * Generate judul session dari prompt pertama user
   */
  static generateTitle(messages: ChatMessage[]): string {
    const firstUser = messages.find(m => m.role === 'user');
    if (!firstUser) return 'New Session';
    const text = typeof firstUser.content === 'string' ? firstUser.content : '';
    return text.slice(0, 60).trim() || 'New Session';
  }

  /**
   * Simpan session ke disk
   */
  static save(id: string, messages: ChatMessage[], title?: string): boolean {
    const dir = this.getSessionsDir();
    if (!dir) return false;

    // Simpan HANYA pesan yang layak ditampilkan sebagai riwayat chat (lihat isVisibleMessage)
    // — bukan cuma buang system prompt (bisa di-rebuild), tapi juga buang seluruh noise
    // orkestrasi internal (tool results, directive/nudge) supaya riwayat yang dibuka user
    // nanti benar-benar mencerminkan percakapan sungguhan, bukan detail implementasi.
    const visibleMessages = messages.filter(isVisibleMessage);
    const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'workspace';
    const meta: Session = {
      id,
      title: title || this.generateTitle(visibleMessages),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: visibleMessages.length,
      workspaceName,
      messages: visibleMessages
    };

    try {
      const file = path.join(dir, `${id}.json`);
      // Jika sudah ada, pertahankan createdAt
      if (fs.existsSync(file)) {
        const existing = JSON.parse(fs.readFileSync(file, 'utf-8')) as Session;
        meta.createdAt = existing.createdAt;
      }
      fs.writeFileSync(file, JSON.stringify(meta, null, 2), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load session dari disk
   */
  static load(id: string): Session | null {
    const dir = this.getSessionsDir();
    if (!dir) return null;

    try {
      const file = path.join(dir, `${id}.json`);
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as Session;
    } catch {
      return null;
    }
  }

  /**
   * List semua sessions yang tersimpan (sorted by updatedAt desc)
   */
  static list(): SessionMeta[] {
    const dir = this.getSessionsDir();
    if (!dir) return [];

    try {
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            const content = fs.readFileSync(path.join(dir, f), 'utf-8');
            const session = JSON.parse(content) as Session;
            return {
              id: session.id,
              title: session.title,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              messageCount: session.messageCount,
              workspaceName: session.workspaceName
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as SessionMeta[]
    } catch {
      return [];
    }
  }

  /**
   * Hapus session
   */
  static delete(id: string): boolean {
    const dir = this.getSessionsDir();
    if (!dir) return false;

    try {
      const file = path.join(dir, `${id}.json`);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Generate unique session ID
   */
  static generateId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
