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

    const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'workspace';
    const meta: Session = {
      id,
      title: title || this.generateTitle(messages),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: messages.filter(m => m.role !== 'system').length,
      workspaceName,
      messages: messages.filter(m => m.role !== 'system') // Jangan simpan system prompt (bisa rebuild)
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
