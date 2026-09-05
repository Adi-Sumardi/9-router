import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Kebijakan governance per-project, mirip konsep `.claude/settings.json` di Claude Code
 * asli: file ini milik REPO (bisa di-commit & dishare ke tim), bukan preferensi personal
 * di VS Code settings. Prioritas lebih tinggi daripada setting global `sendago.autoExecute`
 * — supaya pemilik repo bisa memaksa mode aman untuk semua kontributor, terlepas dari
 * setting masing-masing orang.
 */
export type PermissionMode = 'auto' | 'ask' | 'plan-only';

export interface SendaGoProjectSettings {
  /** 'auto' = izinkan auto-execute (masih tunduk workspace trust & allow/deny list di bawah).
   *  'ask'  = selalu minta konfirmasi manual sebelum eksekusi apa pun.
   *  'plan-only' = read-only total: tombol Apply/Run dimatikan, hanya boleh menganalisis & mengusulkan. */
  permissionMode?: PermissionMode;
  /** Pola regex tambahan yang dianggap aman untuk auto-run (di atas allowlist bawaan). */
  allow?: string[];
  /** Pola regex yang SELALU diblokir — bahkan tidak muncul opsi konfirmasi manual. */
  deny?: string[];
}

const SETTINGS_REL_PATH = path.join('.sendago', 'settings.json');

export class ProjectSettings {
  private static cache: { path: string; mtimeMs: number; data: SendaGoProjectSettings } | null = null;

  private static getSettingsPath(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    return path.join(folders[0].uri.fsPath, SETTINGS_REL_PATH);
  }

  /** Baca .sendago/settings.json dari root workspace, di-cache berdasarkan mtime file. */
  public static load(): SendaGoProjectSettings {
    const settingsPath = this.getSettingsPath();
    if (!settingsPath) return {};

    try {
      const stat = fs.statSync(settingsPath);
      if (this.cache && this.cache.path === settingsPath && this.cache.mtimeMs === stat.mtimeMs) {
        return this.cache.data;
      }
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const data = JSON.parse(raw) as SendaGoProjectSettings;
      this.cache = { path: settingsPath, mtimeMs: stat.mtimeMs, data };
      return data;
    } catch {
      // File tidak ada / tidak valid JSON — perlakukan sebagai "tidak ada kebijakan khusus".
      return {};
    }
  }

  public static getPermissionMode(): PermissionMode | null {
    const mode = this.load().permissionMode;
    return mode === 'auto' || mode === 'ask' || mode === 'plan-only' ? mode : null;
  }

  public static getAllowPatterns(): RegExp[] {
    return this.compilePatterns(this.load().allow);
  }

  public static getDenyPatterns(): RegExp[] {
    return this.compilePatterns(this.load().deny);
  }

  private static compilePatterns(patterns?: string[]): RegExp[] {
    if (!patterns || !Array.isArray(patterns)) return [];
    const out: RegExp[] = [];
    for (const p of patterns) {
      if (typeof p !== 'string' || !p.trim()) continue;
      try {
        out.push(new RegExp(p, 'i'));
      } catch {
        // Pola regex tidak valid di settings.json user — lewati saja, jangan sampai
        // kesalahan ketik project owner bikin seluruh ekstensi crash.
      }
    }
    return out;
  }

  /** Buat template default `.sendago/settings.json` kalau belum ada. Return path file (baru/lama). */
  public static ensureTemplate(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;

    const dir = path.join(folders[0].uri.fsPath, '.sendago');
    const filePath = path.join(dir, 'settings.json');
    if (fs.existsSync(filePath)) return filePath;

    const template: SendaGoProjectSettings = {
      permissionMode: 'ask',
      allow: [],
      deny: []
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(template, null, 2) + '\n', 'utf-8');
    return filePath;
  }
}
