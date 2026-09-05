import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';

export interface CommandExecutionResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  error?: string;
  isBackground?: boolean;
}

export interface WorkspaceFolderInfo {
  name: string;
  rootPath: string;
  projectType: string;
  manifestInfo?: string;
  files: string[];
}

export interface ProjectContext {
  workspaceName: string;
  folders: WorkspaceFolderInfo[];
  activeFolder?: string;
  openTabs: string[];
  activeFile?: {
    path: string;
    content: string;
    languageId: string;
    folderName: string;
  };
  attachedFiles?: {
    path: string;
    content: string;
  }[];
  sendagoInstructions?: string | null;
  gitContext?: {
    branch: string;
    status: string;
    diffSummary: string;
  } | null;
  lspDiagnostics?: {
    totalErrors: number;
    totalWarnings: number;
    summaryText: string;
  };
}

export class AgentTools {
  private static terminal: vscode.Terminal | null = null;
  private static activeSessionCwd: string | null = null;
  private static readonly EXCLUDE_PATTERN = '**/{node_modules,vendor,.git,storage,dist,build,.next,backups,data,coverage,.turbo,.cache,public/vendor,public/build,logs,.idea,.vscode}/**';

  public static getActiveSessionCwd(): string | null {
    return this.activeSessionCwd;
  }

  public static setActiveSessionCwd(cwd: string | null): void {
    this.activeSessionCwd = cwd;
  }

  /**
   * Pola perintah yang berpotensi merusak sistem / kehilangan data.
   * Dipakai sebagai lapisan peringatan tambahan sebelum eksekusi, bukan blokir mutlak —
   * AI bisa saja menyarankan perintah ini dari konteks yang di-prompt-inject.
   */
  private static readonly DANGEROUS_PATTERNS: RegExp[] = [
    // —— File & Folder Deletion (HARUS konfirmasi, TIDAK BOLEH auto-run) ——
    /\brm\b/i,                                                // rm apapun
    /\brmdir\b/i,                                             // rmdir
    /\bdel\b/i,                                               // Windows del
    /\brd\s+\/s\b/i,                                          // Windows rd /s
    /\btrash\b/i,                                             // trash-cli
    /\bshred\b/i,                                             // shred
    /\bfind\b[^\n]*-delete/i,                                 // find -delete
    /\bfind\b[^\n]*-exec\s+rm/i,                              // find -exec rm
    /\bxargs\b[^\n]*\brm\b/i,                                 // xargs rm
    /\bunlink\b/i,                                            // unlink
    /\bgit\s+clean\s+-[a-z]*f/i,                              // git clean -f
    // —— Data Loss / System Damage ——
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    />\s*\/dev\/(sd|nvme|disk)/i,
    /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/,
    /\bsudo\s+rm\b/i,
    /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
    /\bchmod\s+-R\s+777\s+\//i,
    /\b(shutdown|reboot)\b/i,
    /\bgit\s+push\b[^\n]*--force/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bdocker\s+system\s+prune\s+-a/i,
    />\s*~\/\.(ssh|aws)\b/i,
    // —— Scripted deletion via interpreter one-liners (bypasses the shell-command patterns above) ——
    /\b(shutil\.rmtree|os\.remove|os\.unlink)\s*\(/i,
    /\bfs\.(unlink|rm|rmdir)(Sync)?\s*\(/i,
  ];

  /**
   * Pola perintah yang secara umum aman untuk dijalankan TANPA konfirmasi manual
   * dalam mode auto-execute: instalasi dependency, test/build/lint, dev server,
   * git read-only/non-destruktif, docker non-destruktif, dan inspeksi filesystem.
   * Dipakai sebagai ALLOWLIST — apa pun di luar daftar ini butuh persetujuan
   * eksplisit user, bukan cuma dicek terhadap blocklist DANGEROUS_PATTERNS.
   */
  private static readonly SAFE_AUTO_PATTERNS: RegExp[] = [
    /^(npm|yarn|pnpm|bun)\s+(install|ci|run\s+[\w:.-]+|test|build|lint|dev|start)\b/i,
    /^(npx|pnpm\s+dlx|yarn\s+dlx)\s+/i,
    /^composer\s+(install|require|update|dump-autoload|test)\b/i,
    /^php\s+artisan\s+(serve|migrate(:\w+)?|route:list|make:[\w-]+|test|tinker)\b/i,
    /^git\s+(status|diff|log|branch|fetch|pull|add|commit|show|stash(\s+(list|pop|save))?)\b/i,
    /^docker\s+(ps|images|logs|compose\s+(up|down|ps|logs|build))\b/i,
    /^open\s+-a\s+Docker\b/i,
    /^(ls|pwd|cat|echo|which|whoami|tsc\s+--noEmit)\b/i,
    /^(node|python3?)\s+(-v|--version)\b/i,
    /^mkdir(\s+-p)?\s+[\w./-]+$/i,
    /^cd\s+/i,
  ];

  public static isDangerousCommand(command: string): boolean {
    return this.DANGEROUS_PATTERNS.some(re => re.test(command));
  }

  /**
   * True jika perintah cocok pola allowlist yang dianggap aman untuk auto-run.
   * Perintah yang TIDAK cocok (meski tidak "dangerous") tetap butuh konfirmasi user —
   * ini membalik model lama yang auto-run semua kecuali yang match blocklist.
   */
  public static isSafeAutoCommand(command: string): boolean {
    const trimmed = command.trim();
    return this.SAFE_AUTO_PATTERNS.some(re => re.test(trimmed));
  }

  /**
   * True jika workspace saat ini sudah "Trusted" oleh user (VS Code Workspace Trust).
   * Di workspace yang belum dipercaya, eksekusi otonom (command/file write) tidak
   * boleh berjalan tanpa konfirmasi eksplisit — mencegah prompt-injection dari
   * konten repo asing langsung mengeksekusi aksi di mesin user.
   */
  public static isWorkspaceTrusted(): boolean {
    return vscode.workspace.isTrusted;
  }

  /**
   * Mendapatkan semua root workspace folders
   */
  public static getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
    return vscode.workspace.workspaceFolders || [];
  }

  /**
   * Mendapatkan path root workspace aktif utama.
   * SELALU prioritaskan folder dari active editor atau session CWD aktif.
   */
  public static getWorkspaceRoot(): string | null {
    // Prioritas 0: Active Session CWD jika valid
    if (this.activeSessionCwd && fs.existsSync(this.activeSessionCwd)) {
      return this.activeSessionCwd;
    }

    const folders = this.getWorkspaceFolders();
    if (folders.length === 0) return null;

    // Prioritas 1: folder dari active editor
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (folder) return folder.uri.fsPath;
    }

    // Prioritas 2: folder pertama
    return folders[0].uri.fsPath;
  }

  /**
   * Resolve path target file dengan strategi cerdas:
   * 1. Absolute path → langsung dipakai
   * 2. Path dengan prefix folder name ("sekolah/app/...") → strip prefix, resolve ke folder itu
   * 3. File sudah exist di salah satu folder → gunakan yang exist
   * 4. File BARU → buat di active folder (bukan selalu folder[0]!)
   *
   * Strategy ini memastikan file baru dibuat di project yang sedang aktif di editor.
   */
  public static async resolveTargetPath(targetPathOrRel: string): Promise<string> {
    const folders = this.getWorkspaceFolders();

    // Absolute path → langsung
    if (path.isAbsolute(targetPathOrRel)) {
      return targetPathOrRel;
    }

    // Normalise: buang leading slash/dot-slash
    const relPath = targetPathOrRel.replace(/^\.?\//, '');

    // Cek apakah ada prefix folder name ("sekolah/app/Http/...") 
    for (const folder of folders) {
      if (relPath.startsWith(folder.name + '/') || relPath.startsWith(folder.name + '\\')) {
        const stripped = relPath.slice(folder.name.length + 1);
        return path.resolve(folder.uri.fsPath, stripped);
      }
    }

    // Cek apakah file sudah exist di salah satu folder (prioritaskan active)
    const activeRoot = this.getWorkspaceRoot();
    if (activeRoot) {
      const candidate = path.resolve(activeRoot, relPath);
      if (await this.pathExists(candidate)) {
        return candidate;
      }
    }
    // Cek di folder lain
    for (const folder of folders) {
      if (folder.uri.fsPath === activeRoot) continue;
      const candidate = path.resolve(folder.uri.fsPath, relPath);
      if (await this.pathExists(candidate)) {
        return candidate;
      }
    }

    // File BARU → gunakan active folder (bukan folders[0]!)
    const targetRoot = activeRoot || (folders[0]?.uri.fsPath ?? process.cwd());
    return path.resolve(targetRoot, relPath);
  }

  /**
   * Membaca isi file di dalam workspace (mendukung path relatif dan range baris startLine/endLine)
   */
  public static async readFileContent(targetPathOrRel: string, startLine?: number, endLine?: number): Promise<string> {
    const folders = this.getWorkspaceFolders();
    let fileUri: vscode.Uri | null = null;

    if (path.isAbsolute(targetPathOrRel)) {
      fileUri = vscode.Uri.file(targetPathOrRel);
    } else {
      // Cari di setiap workspace folder
      for (const folder of folders) {
        // Coba jika prefix sudah menyertakan folder name (e.g. "sekolah/app/...")
        if (targetPathOrRel.startsWith(folder.name + '/') || targetPathOrRel.startsWith(folder.name + '\\')) {
          const stripped = targetPathOrRel.slice(folder.name.length + 1);
          const candidate = path.resolve(folder.uri.fsPath, stripped);
          if (await this.pathExists(candidate)) {
            fileUri = vscode.Uri.file(candidate);
            break;
          }
        }
        
        // Coba langsung relative terhadap folder
        const candidate = path.resolve(folder.uri.fsPath, targetPathOrRel);
        if (await this.pathExists(candidate)) {
          fileUri = vscode.Uri.file(candidate);
          break;
        }
      }

      // Fallback ke folder pertama
      if (!fileUri && folders.length > 0) {
        fileUri = vscode.Uri.file(path.resolve(folders[0].uri.fsPath, targetPathOrRel));
      }
    }

    if (!fileUri) {
      throw new Error(`File tidak ditemukan: ${targetPathOrRel}`);
    }

    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const raw = new TextDecoder('utf-8').decode(bytes);

      // Jika startLine atau endLine ditentukan, kembalikan potongan baris dengan penomoran
      if (startLine !== undefined || endLine !== undefined) {
        const lines = raw.split(/\r?\n/);
        const s = Math.max(1, startLine || 1);
        const e = Math.min(lines.length, endLine || lines.length);
        const sliced = lines.slice(s - 1, e).map((line, idx) => `${s + idx}: ${line}`).join('\n');
        return `[Lines ${s}-${e} of ${path.basename(fileUri.fsPath)} (${lines.length} total lines)]\n${sliced}`;
      }

      return raw;
    } catch (err: any) {
      throw new Error(`Gagal membaca file ${targetPathOrRel}: ${err.message}`);
    }
  }

  private static async pathExists(fsPath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Membaca seluruh konteks projek secara mendalam untuk Multi-Root Workspace (pmb, sekolah, dll)
   */
  public static async getFullProjectContext(userPrompt?: string): Promise<ProjectContext | null> {
    const wsFolders = this.getWorkspaceFolders();
    if (wsFolders.length === 0) return null;

    const foldersInfo: WorkspaceFolderInfo[] = [];

    // Deteksi folder mana yang aktif saat ini dari active editor
    const activeEditor = vscode.window.activeTextEditor;
    const activeWsFolder = activeEditor ? vscode.workspace.getWorkspaceFolder(activeEditor.document.uri) : null;
    const activeFolderName = activeWsFolder ? activeWsFolder.name : wsFolders[0].name;

    for (const folder of wsFolders) {
      const rootPath = folder.uri.fsPath;
      const folderName = folder.name;

      // 1. Deteksi Tipe Projek & Manifest
      let projectType = 'Generic';
      const manifestParts: string[] = [];

      // Check Laravel / PHP
      if (await this.pathExists(path.resolve(rootPath, 'artisan')) || await this.pathExists(path.resolve(rootPath, 'composer.json'))) {
        projectType = 'PHP / Laravel Backend';
        try {
          const compStr = await this.readFileContent(path.resolve(rootPath, 'composer.json'));
          const comp = JSON.parse(compStr);
          manifestParts.push(`Laravel App: ${comp.name || folderName} | Require: ${Object.keys(comp.require || {}).slice(0, 10).join(', ')}`);
        } catch {
          manifestParts.push('Laravel Project');
        }
      }

      // Check Node.js / Next.js / Frontend
      if (await this.pathExists(path.resolve(rootPath, 'package.json'))) {
        if (projectType === 'Generic') projectType = 'Node.js / Web';
        try {
          const pkgStr = await this.readFileContent(path.resolve(rootPath, 'package.json'));
          const pkg = JSON.parse(pkgStr);
          manifestParts.push(`Node/Frontend Dependencies: ${Object.keys(pkg.dependencies || {}).slice(0, 12).join(', ')}`);
        } catch {}
      }

      // Check subfolder frontend (e.g. sekolah/frontend/package.json)
      if (await this.pathExists(path.resolve(rootPath, 'frontend', 'package.json'))) {
        projectType += ' + Next.js Frontend';
        try {
          const pkgStr = await this.readFileContent(path.resolve(rootPath, 'frontend', 'package.json'));
          const pkg = JSON.parse(pkgStr);
          manifestParts.push(`Frontend (frontend/package.json): ${Object.keys(pkg.dependencies || {}).slice(0, 12).join(', ')}`);
        } catch {}
      }

      // 2. Scan file tree dalam folder ini (dengan filter ketat vendor/ & node_modules/)
      const pattern = new vscode.RelativePattern(folder, '**/*');
      const uris = await vscode.workspace.findFiles(pattern, this.EXCLUDE_PATTERN, 75);
      const files = uris.map(u => path.relative(rootPath, u.fsPath));

      foldersInfo.push({
        name: folderName,
        rootPath,
        projectType,
        manifestInfo: manifestParts.join('\n'),
        files
      });
    }

    // 3. Open Tabs
    const openTabs: string[] = [];
    vscode.window.tabGroups.all.forEach(group => {
      group.tabs.forEach(tab => {
        if (tab.label) openTabs.push(tab.label);
      });
    });

    // 4. Active File
    let activeFile: ProjectContext['activeFile'];
    if (activeEditor) {
      const doc = activeEditor.document;
      const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
      const folderName = folder ? folder.name : '';
      const relPath = folder ? path.relative(folder.uri.fsPath, doc.fileName) : doc.fileName;

      activeFile = {
        path: folderName ? `${folderName}/${relPath}` : relPath,
        content: doc.getText(),
        languageId: doc.languageId,
        folderName
      };
    }

    // 5. Attached files on demand dari prompt user
    const attachedFiles: ProjectContext['attachedFiles'] = [];
    if (userPrompt) {
      for (const fInfo of foldersInfo) {
        for (const f of fInfo.files) {
          const baseName = path.basename(f);
          const fullRel = `${fInfo.name}/${f}`;
          if (
            userPrompt.includes(fullRel) ||
            userPrompt.includes(f) ||
            (baseName.length > 5 && userPrompt.includes(baseName))
          ) {
            if (activeFile && (activeFile.path === fullRel || activeFile.path === f)) continue;
            try {
              const content = await this.readFileContent(path.resolve(fInfo.rootPath, f));
              attachedFiles.push({
                path: fullRel,
                content: content.slice(0, 4000)
              });
            } catch {}
          }
        }
      }
    }

    const workspaceNames = foldersInfo.map(f => f.name).join(', ');
    const workspaceName = foldersInfo.length > 1 ? `${workspaceNames} (Multi-root)` : foldersInfo[0]?.name || 'Workspace';

    // 6. Project instructions (SENDAGO.md / CLAUDE.md / AGENTS.md)
    const sendagoInstructions = await this.readSendaGoMd();

    // 7. Git Context
    const gitContext = await this.getGitContext();

    // 8. LSP Diagnostics
    const lsp = this.getLSPDiagnostics();
    const lspDiagnostics = (lsp.totalErrors > 0 || lsp.totalWarnings > 0)
      ? { totalErrors: lsp.totalErrors, totalWarnings: lsp.totalWarnings, summaryText: lsp.summaryText }
      : undefined;

    return {
      workspaceName,
      folders: foldersInfo,
      activeFolder: activeFolderName,
      openTabs,
      activeFile,
      attachedFiles,
      sendagoInstructions,
      gitContext,
      lspDiagnostics
    };
  }

  /**
   * Menerapkan perubahan isi file secara langsung ke workspace
   */
  public static async applyWorkspaceEdit(targetPathOrRel: string, newContent: string): Promise<boolean> {
    // Guard: tolak konten kosong — AI tidak boleh "wipe" file jadi kosong
    if (!newContent || newContent.trim().length === 0) {
      vscode.window.showWarningMessage(
        `SendaGo: Penulisan file "${path.basename(targetPathOrRel)}" ditolak karena konten kosong. Ini mencegah penghapusan isi file secara tidak sengaja.`
      );
      return false;
    }

    // Gunakan resolveTargetPath yang smart — prioritaskan active folder untuk file baru
    const resolvedPath = await this.resolveTargetPath(targetPathOrRel);
    const fileUri = vscode.Uri.file(resolvedPath);

    try {
      // Pastikan direktori induk sudah dibuat (rekursif)
      const parentDir = vscode.Uri.file(path.dirname(fileUri.fsPath));
      await vscode.workspace.fs.createDirectory(parentDir);

      // Tulis file langsung menggunakan Workspace FileSystem API
      const encoded = new TextEncoder().encode(newContent);
      await vscode.workspace.fs.writeFile(fileUri, encoded);

      // Buka dokumen di editor
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false });
      vscode.window.setStatusBarMessage(`$(check) SendaGo: File ${path.basename(fileUri.fsPath)} → ${path.relative(this.getWorkspaceRoot() || '', resolvedPath)}`, 4000);
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Gagal membuat file ${path.basename(fileUri.fsPath)}: ${err.message}`);
      return false;
    }
  }

  /**
   * Menerapkan perubahan surgical search-and-replace pada file (Claude Code / Cline style)
   */
  public static async applySurgicalReplace(
    targetPathOrRel: string,
    searchContent: string,
    replaceContent: string
  ): Promise<{ success: boolean; error?: string; line?: number; resolvedPath?: string }> {
    if (!searchContent) {
      return { success: false, error: 'Blok SEARCH tidak boleh kosong.' };
    }

    const resolvedPath = await this.resolveTargetPath(targetPathOrRel);
    const fileUri = vscode.Uri.file(resolvedPath);

    if (!(await this.pathExists(resolvedPath))) {
      return { success: false, error: `File target tidak ditemukan: ${targetPathOrRel}` };
    }

    try {
      const docBytes = await vscode.workspace.fs.readFile(fileUri);
      const originalText = new TextDecoder('utf-8').decode(docBytes);

      // 1. Coba exact match
      let matchIndex = originalText.indexOf(searchContent);
      let matchedSearch = searchContent;

      // 2. Normalisasi line endings jika tidak ketemu (\r\n vs \n)
      if (matchIndex === -1) {
        const normSearch = searchContent.replace(/\r\n/g, '\n');
        const normDoc = originalText.replace(/\r\n/g, '\n');
        const normIdx = normDoc.indexOf(normSearch);

        if (normIdx !== -1) {
          // Cari substring di originalText dengan menghitung baris
          const prefixLines = normDoc.slice(0, normIdx).split('\n');
          const origLines = originalText.split(/\r?\n/);
          const startLine = prefixLines.length - 1;
          const searchLineCount = normSearch.split('\n').length;
          const origMatchBlock = origLines.slice(startLine, startLine + searchLineCount).join(originalText.includes('\r\n') ? '\r\n' : '\n');
          matchIndex = originalText.indexOf(origMatchBlock);
          matchedSearch = origMatchBlock;
        }
      }

      // 3. Toleransi whitespace margin per baris jika masih tidak ketemu
      if (matchIndex === -1) {
        const searchLines = searchContent.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        if (searchLines.length > 0) {
          const docLines = originalText.split(/\r?\n/);
          for (let i = 0; i <= docLines.length - searchLines.length; i++) {
            let allMatch = true;
            for (let j = 0; j < searchLines.length; j++) {
              if (docLines[i + j].trim() !== searchLines[j]) {
                allMatch = false;
                break;
              }
            }
            if (allMatch) {
              const matchedBlock = docLines.slice(i, i + searchLines.length).join(originalText.includes('\r\n') ? '\r\n' : '\n');
              matchIndex = originalText.indexOf(matchedBlock);
              matchedSearch = matchedBlock;
              break;
            }
          }
        }
      }

      if (matchIndex === -1) {
        return {
          success: false,
          error: `Teks SEARCH tidak ditemukan di dalam "${path.basename(resolvedPath)}". Pastikan potongan kode persis sama dengan isi file.`
        };
      }

      // Uniqueness check: pastikan SEARCH tidak ambigu
      const secondMatchIndex = originalText.indexOf(matchedSearch, matchIndex + matchedSearch.length);
      if (secondMatchIndex !== -1) {
        return {
          success: false,
          error: `Teks SEARCH ditemukan lebih dari 1 kali di dalam "${path.basename(resolvedPath)}". Mohon sertakan beberapa baris kode di atas atau di bawahnya agar unik.`
        };
      }

      // Hitung posisi nomor baris (1-based)
      const lineNum = originalText.slice(0, matchIndex).split(/\r?\n/).length;

      // Susun teks baru
      const newText = originalText.slice(0, matchIndex) + replaceContent + originalText.slice(matchIndex + matchedSearch.length);

      // Simpan perubahan ke disk
      const encoded = new TextEncoder().encode(newText);
      await vscode.workspace.fs.writeFile(fileUri, encoded);

      // Buka dokumen dan scroll ke lokasi perubahan
      try {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const pos = new vscode.Position(lineNum - 1, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      } catch {}

      vscode.window.setStatusBarMessage(`$(check) SendaGo: Replaced baris ${lineNum} di ${path.basename(resolvedPath)}`, 4000);

      return {
        success: true,
        line: lineNum,
        resolvedPath
      };
    } catch (err: any) {
      return { success: false, error: `Gagal surgical replace: ${err.message}` };
    }
  }

  /**
   * Membuka tampilan Diff Editor berdampingan untuk preview sebelum disimpan
   */
  public static async showDiffPreview(targetPathOrRel: string, newContent: string): Promise<void> {
    const folders = this.getWorkspaceFolders();
    let originalUri: vscode.Uri | null = null;

    if (path.isAbsolute(targetPathOrRel)) {
      originalUri = vscode.Uri.file(targetPathOrRel);
    } else {
      for (const folder of folders) {
        if (targetPathOrRel.startsWith(folder.name + '/') || targetPathOrRel.startsWith(folder.name + '\\')) {
          const stripped = targetPathOrRel.slice(folder.name.length + 1);
          originalUri = vscode.Uri.file(path.resolve(folder.uri.fsPath, stripped));
          break;
        }
        const candidate = path.resolve(folder.uri.fsPath, targetPathOrRel);
        if (await this.pathExists(candidate)) {
          originalUri = vscode.Uri.file(candidate);
          break;
        }
      }
      if (!originalUri && folders.length > 0) {
        originalUri = vscode.Uri.file(path.resolve(folders[0].uri.fsPath, targetPathOrRel));
      }
    }

    if (!originalUri) return;

    const tempUri = originalUri.with({ scheme: 'untitled', path: originalUri.fsPath + '.sendago-new' });

    try {
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(tempUri, { overwrite: true });
      edit.insert(tempUri, new vscode.Position(0, 0), newContent);
      await vscode.workspace.applyEdit(edit);

      await vscode.commands.executeCommand(
        'vscode.diff',
        originalUri,
        tempUri,
        `Diff: ${path.basename(originalUri.fsPath)} (Original ↔ SendaGo AI)`
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Gagal membuka diff: ${err.message}`);
    }
  }

  /**
   * Menjalankan perintah di integrated terminal Mac pada folder workspace aktif
   */
  public static executeTerminalCommand(command: string, customCwd?: string): void {
    // SELALU pakai active folder sebagai CWD agar command dijalankan di project yang benar
    const root = customCwd || this.getWorkspaceRoot() || process.env.HOME;

    if (!this.terminal || this.terminal.exitStatus !== undefined) {
      this.terminal = vscode.window.createTerminal({
        name: 'SendaGo AI Agent',
        cwd: root
      });
    } else if (root) {
      // Pindah ke folder aktif jika terminal sudah ada
      this.terminal.sendText(`cd "${root}"`);
    }

    this.terminal.show(true);

    const cleanCommand = command.trim();
    if (cleanCommand) {
      this.terminal.sendText(cleanCommand);
      vscode.window.setStatusBarMessage(`$(terminal) SendaGo: $ ${cleanCommand.slice(0, 40)}...`, 3000);
    }
  }

  /**
   * Mendeteksi apakah suatu perintah adalah server dev yang berjalan terus menerus (long-running / daemon)
   */
  public static isLongRunningServer(command: string): boolean {
    const trimmed = command.trim();
    return /\b(npm\s+(run\s+)?(dev|start|watch)|yarn\s+(dev|start)|pnpm\s+(dev|start)|bun\s+(run\s+)?(dev|start)|vite|next\s+dev|nuxt\s+dev|php\s+artisan\s+serve|uvicorn|gunicorn|flask\s+run|fastapi\s+dev|docker\s+compose\s+up(?!\s+-d))\b/i.test(trimmed);
  }

  /**
   * Menjalankan perintah shell secara asynchronous dan mengalirkan output secara real-time (Claude Code style)
   */
  public static async executeCommandWithOutput(
    command: string,
    options?: {
      cwd?: string;
      onStdout?: (chunk: string) => void;
      onStderr?: (chunk: string) => void;
      abortSignal?: AbortSignal;
      timeoutMs?: number;
    }
  ): Promise<CommandExecutionResult> {
    // CWD selalu dari active folder atau persistent session CWD
    const root = options?.cwd || this.getActiveSessionCwd() || this.getWorkspaceRoot() || process.env.HOME || process.cwd();
    const cleanCmd = command.trim();

    // 1. Deteksi perubahan direktori (cd ...) untuk menjaga CWD persisten antar turn
    const cdMatch = /^\s*cd\s+["']?([^"';&\n]+)["']?/i.exec(cleanCmd);
    if (cdMatch) {
      const targetDir = cdMatch[1].trim();
      const resolved = path.isAbsolute(targetDir) ? targetDir : path.resolve(root, targetDir);
      if (fs.existsSync(resolved)) {
        this.activeSessionCwd = resolved;
      }
    }

    // 2. Deteksi server dev / daemon (npm run dev, php artisan serve, dll)
    // Jangan biarkan agent loop freeze / timeout 120s! Alihkan ke Integrated Terminal VS Code
    if (this.isLongRunningServer(cleanCmd)) {
      this.executeTerminalCommand(cleanCmd, root);
      return {
        command: cleanCmd,
        stdout: `[Background Dev Server Started in VS Code Integrated Terminal: "${cleanCmd}"]\nLive server is running in your VS Code terminal panel. You can view logs and open it in your browser.`,
        stderr: '',
        exitCode: 0,
        durationMs: 100,
        timedOut: false,
        isBackground: true
      };
    }

    const timeoutMs = options?.timeoutMs ?? 120000;
    const startTime = Date.now();

    return new Promise<CommandExecutionResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/zsh');
      const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];

      const child = cp.spawn(shell, shellArgs, {
        cwd: root,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          PAGER: 'cat',
          CI: 'true'
        }
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch {}
      }, timeoutMs);

      if (options?.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          try {
            child.kill('SIGKILL');
          } catch {}
        });
      }

      const MAX_STREAM_CHARS = 100000;

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        if (stdout.length < MAX_STREAM_CHARS) {
          stdout += text;
        }
        options?.onStdout?.(text);
      });

      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        if (stderr.length < MAX_STREAM_CHARS) {
          stderr += text;
        }
        options?.onStderr?.(text);
      });

      child.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          command,
          stdout,
          stderr: stderr ? `${stderr}\n${err.message}` : err.message,
          exitCode: 1,
          durationMs: Date.now() - startTime,
          timedOut,
          error: err.message
        });
      });

      child.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          command,
          stdout,
          stderr,
          exitCode: code,
          durationMs: Date.now() - startTime,
          timedOut
        });
      });
    });
  }

  /**
   * Menjelajahi struktur direktori di workspace
   */
  public static async readDirectoryTree(targetRelPath: string = ''): Promise<{ name: string; isDirectory: boolean; path: string }[]> {
    // Gunakan active folder agar listing direktori sesuai project yang aktif
    const root = this.getWorkspaceRoot();
    if (!root) return [];

    const fullPath = targetRelPath ? await this.resolveTargetPath(targetRelPath) : root;
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(fullPath));
      return entries.map(([name, type]) => ({
        name,
        isDirectory: type === vscode.FileType.Directory,
        path: targetRelPath ? `${targetRelPath}/${name}` : name
      }));
    } catch {
      return [];
    }
  }

  /**
   * Mengambil daftar file di semua workspace folders (dengan filter ketat node_modules/vendor)
   */
  public static async listWorkspaceFiles(maxFiles: number = 250): Promise<string[]> {
    const folders = this.getWorkspaceFolders();
    if (folders.length === 0) return [];

    const results: string[] = [];
    const limitPerFolder = Math.max(50, Math.ceil(maxFiles / folders.length));

    for (const folder of folders) {
      try {
        const pattern = new vscode.RelativePattern(folder, '**/*');
        const uris = await vscode.workspace.findFiles(pattern, this.EXCLUDE_PATTERN, limitPerFolder);
        const prefix = folders.length > 1 ? `${folder.name}/` : '';
        for (const u of uris) {
          results.push(`${prefix}${path.relative(folder.uri.fsPath, u.fsPath)}`);
        }
      } catch {
        // ignore
      }
    }

    return results;
  }

  /**
   * Mencari pola teks atau regex di seluruh berkas workspace (seperti ripgrep / GrepTool)
   */
  public static async grepWorkspace(
    query: string,
    options?: { isRegex?: boolean; include?: string; path?: string; maxResults?: number }
  ): Promise<{ file: string; line: number; text: string }[]> {
    const folders = this.getWorkspaceFolders();
    if (folders.length === 0 || !query) return [];

    const maxResults = options?.maxResults || 40;
    const results: { file: string; line: number; text: string }[] = [];

    let regex: RegExp;
    try {
      regex = options?.isRegex
        ? new RegExp(query, 'i')
        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch {
      regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    const globPattern = options?.include ? `**/${options.include}` : '**/*';

    for (const folder of folders) {
      if (results.length >= maxResults) break;
      if (options?.path && !folder.name.includes(options.path) && !folder.uri.fsPath.includes(options.path)) {
        continue;
      }

      const pattern = new vscode.RelativePattern(folder, globPattern);
      const uris = await vscode.workspace.findFiles(pattern, this.EXCLUDE_PATTERN, 150);

      for (const uri of uris) {
        if (results.length >= maxResults) break;

        const ext = path.extname(uri.fsPath).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz', '.lock', '.exe', '.bin', '.mp4', '.svg'].includes(ext)) {
          continue;
        }

        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (bytes.length > 1024 * 1024) continue; // Skip file > 1MB

          const content = new TextDecoder('utf-8').decode(bytes);
          const lines = content.split(/\r?\n/);
          const relPath = folders.length > 1
            ? `${folder.name}/${path.relative(folder.uri.fsPath, uri.fsPath)}`
            : path.relative(folder.uri.fsPath, uri.fsPath);

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push({
                file: relPath,
                line: i + 1,
                text: lines[i].trim().slice(0, 160)
              });
              if (results.length >= maxResults) break;
            }
          }
        } catch {
          // ignore unreadable files
        }
      }
    }

    return results;
  }

  /**
   * Mencari file di seluruh workspace menggunakan pola nama/glob tanpa limitasi 75 file statis (GlobTool)
   */
  public static async findWorkspaceFiles(pattern: string, maxResults: number = 50): Promise<string[]> {
    const folders = this.getWorkspaceFolders();
    if (folders.length === 0 || !pattern) return [];

    const cleanPattern = pattern.includes('/') || pattern.startsWith('*') ? pattern : `**/*${pattern}*`;
    const results: string[] = [];

    for (const folder of folders) {
      if (results.length >= maxResults) break;
      try {
        const relPattern = new vscode.RelativePattern(folder, cleanPattern);
        const uris = await vscode.workspace.findFiles(relPattern, this.EXCLUDE_PATTERN, maxResults - results.length);
        for (const u of uris) {
          const rel = folders.length > 1
            ? `${folder.name}/${path.relative(folder.uri.fsPath, u.fsPath)}`
            : path.relative(folder.uri.fsPath, u.fsPath);
          results.push(rel);
        }
      } catch {}
    }

    return results;
  }

  /**
   * Menghasilkan gambar / foto AI (PNG, JPG, WebP) dan menyimpannya langsung ke workspace
   */
  public static async generateAndSaveImage(
    targetPathOrRel: string,
    prompt: string,
    width: number = 1024,
    height: number = 1024
  ): Promise<{ success: boolean; filePath: string; error?: string }> {
    // Gunakan resolveTargetPath agar gambar dibuat di active folder
    const resolvedPath = await this.resolveTargetPath(targetPathOrRel);
    const fileUri = vscode.Uri.file(resolvedPath);

    if (!fileUri) return { success: false, filePath: targetPathOrRel, error: 'No workspace open' };

    try {
      const seed = Math.floor(Math.random() * 1000000);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&seed=${seed}&model=flux`;

      vscode.window.setStatusBarMessage(`$(sync~spin) SendaGo: Sedang men-generate gambar (${prompt.slice(0, 25)}...)...`, 10000);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);
      let response: Response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} dari Image Generator`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);

      // Pastikan direktori induk sudah dibuat
      const parentDir = vscode.Uri.file(path.dirname(fileUri.fsPath));
      await vscode.workspace.fs.createDirectory(parentDir);

      // Simpan file binary gambar
      await vscode.workspace.fs.writeFile(fileUri, buffer);

      // Buka gambar di editor
      await vscode.commands.executeCommand('vscode.open', fileUri);

      vscode.window.setStatusBarMessage(`$(check) SendaGo: Gambar ${path.basename(fileUri.fsPath)} berhasil dibuat!`, 3000);
      return { success: true, filePath: fileUri.fsPath };
    } catch (err: any) {
      const message = err?.name === 'AbortError'
        ? 'Timeout (45s) — Image Generator tidak merespons.'
        : err.message;
      vscode.window.showErrorMessage(`Gagal men-generate gambar: ${message}`);
      return { success: false, filePath: targetPathOrRel, error: message };
    }
  }

  /**
   * Mengumpulkan diagnostic dari LSP (Language Server Protocol) yang aktif
   */
  public static getLSPDiagnostics(): {
    totalErrors: number;
    totalWarnings: number;
    summaryText: string;
    items: { file: string; line: number; col: number; severity: string; message: string; source?: string }[];
  } {
    const all = vscode.languages.getDiagnostics();
    const items: { file: string; line: number; col: number; severity: string; message: string; source?: string }[] = [];
    let totalErrors = 0;
    let totalWarnings = 0;

    for (const [uri, diags] of all) {
      if (uri.scheme !== 'file') continue;
      const fsPath = uri.fsPath;
      if (fsPath.includes('node_modules') || fsPath.includes('vendor') || fsPath.includes('.git')) continue;

      const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
      const relPath = wsFolder ? path.relative(wsFolder.uri.fsPath, fsPath) : path.basename(fsPath);

      for (const d of diags) {
        if (d.severity === vscode.DiagnosticSeverity.Error) {
          totalErrors++;
          items.push({
            file: relPath,
            line: d.range.start.line + 1,
            col: d.range.start.character + 1,
            severity: 'error',
            message: d.message,
            source: d.source
          });
        } else if (d.severity === vscode.DiagnosticSeverity.Warning) {
          totalWarnings++;
          if (items.length < 50) {
            items.push({
              file: relPath,
              line: d.range.start.line + 1,
              col: d.range.start.character + 1,
              severity: 'warning',
              message: d.message,
              source: d.source
            });
          }
        }
      }
    }

    const topItems = items.slice(0, 30);
    const summaryText = topItems
      .map(i => `[${i.severity.toUpperCase()}] ${i.file}:${i.line}:${i.col} - ${i.message}`)
      .join('\n');

    return {
      totalErrors,
      totalWarnings,
      summaryText,
      items: topItems
    };
  }

  /**
   * Mengambil konteks Git aktif (branch, status, diff stat)
   */
  public static async getGitContext(): Promise<{
    branch: string;
    status: string;
    diffSummary: string;
  } | null> {
    const folders = this.getWorkspaceFolders();
    if (folders.length === 0) return null;
    const rootPath = folders[0].uri.fsPath;

    try {
      const branchRes = await this.executeCommandWithOutput('git rev-parse --abbrev-ref HEAD', { cwd: rootPath, timeoutMs: 3000 });
      const branch = branchRes.exitCode === 0 ? branchRes.stdout.trim() : 'unknown';

      const statusRes = await this.executeCommandWithOutput('git status --short', { cwd: rootPath, timeoutMs: 3000 });
      const status = statusRes.exitCode === 0 ? statusRes.stdout.trim() : '';

      const diffRes = await this.executeCommandWithOutput('git diff --stat', { cwd: rootPath, timeoutMs: 3000 });
      const diffSummary = diffRes.exitCode === 0 ? diffRes.stdout.trim() : '';

      return {
        branch,
        status,
        diffSummary
      };
    } catch {
      return null;
    }
  }

  /**
   * Membaca SENDAGO.md, CLAUDE.md, atau AGENTS.md dari root projek jika ada
   */
  public static async readSendaGoMd(): Promise<string | null> {
    const folders = this.getWorkspaceFolders();
    if (folders.length === 0) return null;

    for (const folder of folders) {
      const candidates = [
        path.join(folder.uri.fsPath, 'SENDAGO.md'),
        path.join(folder.uri.fsPath, '.sendago.md'),
        path.join(folder.uri.fsPath, 'CLAUDE.md'),
        path.join(folder.uri.fsPath, '.claude.md'),
        path.join(folder.uri.fsPath, 'AGENTS.md')
      ];

      for (const p of candidates) {
        if (await this.pathExists(p)) {
          try {
            const content = await this.readFileContent(p);
            if (content && content.trim()) {
              return `--- Instructions from ${path.basename(p)} ---\n${content.trim().slice(0, 8000)}`;
            }
          } catch {}
        }
      }
    }
    return null;
  }

  /**
   * Mendapatkan daftar file dalam workspace untuk fitur @mention di chat
   */
  public static async listFilesForMention(query?: string): Promise<{ name: string; relativePath: string; fullPath: string }[]> {
    const folders = this.getWorkspaceFolders();
    if (folders.length === 0) return [];

    const results: { name: string; relativePath: string; fullPath: string }[] = [];
    const q = (query || '').toLowerCase().trim();

    for (const folder of folders) {
      const pattern = new vscode.RelativePattern(folder, '**/*');
      const uris = await vscode.workspace.findFiles(pattern, this.EXCLUDE_PATTERN, 150);
      for (const u of uris) {
        const rel = path.relative(folder.uri.fsPath, u.fsPath);
        const name = path.basename(u.fsPath);
        if (!q || name.toLowerCase().includes(q) || rel.toLowerCase().includes(q)) {
          results.push({
            name,
            relativePath: folders.length > 1 ? `${folder.name}/${rel}` : rel,
            fullPath: u.fsPath
          });
        }
        if (results.length >= 40) break;
      }
      if (results.length >= 40) break;
    }
    return results;
  }
}
