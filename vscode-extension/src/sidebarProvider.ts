import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { NineRouterClient, ChatMessage, ToolCallData } from './routerClient';
import { AgentEngine, AgentMode, FileEditAction, FileReplaceAction, GrepAction, FindFilesAction, ReadFileAction, CommandAction, ImageAction } from './agentEngine';
import { AgentTools } from './agentTools';
import { SessionManager, sanitizeMessagesForHistory } from './sessionManager';
import { getToolDefinitionsForMode } from './toolSchemas';
import { ProjectSettings, PermissionMode } from './projectSettings';

export class SendaGoSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sendago.sidebarView';
  private _view?: vscode.WebviewView;
  private _history: ChatMessage[] = [];
  private _currentMode: AgentMode = 'claude-code';
  private _abortController: AbortController | null = null;
  private _autoExecute: boolean = true;
  private _maxAutonomousSteps: number = 50;
  private _untrustedNoticeShown: boolean = false;
  private _projectPolicyNoticeShown: boolean = false;
  private _sessionId: string = SessionManager.generateId();

  /** Map requestId -> { resolve } untuk async in-chat confirmation */
  private _pendingConfirms = new Map<string, (confirmed: boolean) => void>();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _client: NineRouterClient
  ) {
    const config = vscode.workspace.getConfiguration('sendago');
    this._autoExecute = config.get<boolean>('autoExecute', true);
    this._maxAutonomousSteps = config.get<number>('maxAutonomousSteps', 50);
    this.resetHistory();
  }

  private resetHistory() {
    this._history = [
      { role: 'system', content: AgentEngine.getSystemPrompt(this._currentMode) }
    ];
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Initial Health Check
    this.refreshStatus();

    // Pantau perubahan file aktif di VS Code untuk context pill otomatis
    vscode.window.onDidChangeActiveTextEditor(() => {
      this.sendActiveContext();
    });

    // Handle messages from Webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'prompt':
          await this.handleUserPrompt(data.text, data.pool, data.mode, data.attachments);
          break;

        case 'runSlashCommand':
          await this.handleSlashCommand(data.command);
          break;

        case 'searchMentionFiles': {
          const files = await AgentTools.listFilesForMention(data.query);
          this._view?.webview.postMessage({ type: 'mentionFilesResult', files, query: data.query });
          break;
        }

        case 'attachFileByPath': {
          if (data.filePath) {
            try {
              const content = await AgentTools.readFileContent(data.filePath);
              this._view?.webview.postMessage({
                type: 'attachmentAdded',
                file: {
                  name: path.basename(data.filePath),
                  path: data.filePath,
                  content: content.slice(0, 20000)
                }
              });
            } catch (err: any) {
              vscode.window.showErrorMessage(`Gagal melampirkan file: ${err.message}`);
            }
          }
          break;
        }

        case 'listSessions': {
          const sessions = SessionManager.list();
          this._view?.webview.postMessage({
            type: 'sessionsList',
            sessions,
            currentSessionId: this._sessionId
          });
          break;
        }

        case 'loadSession': {
          if (data.sessionId) {
            const session = SessionManager.load(data.sessionId);
            if (session) {
              this._sessionId = session.id;
              // Sanitasi dulu (buang tool result/directive internal + tool_calls yatim) —
              // sesi lama yang sempat kesimpan sebelum fix ini masih bisa berisi noise
              // tersebut, jadi tidak cukup andalkan SessionManager.save() yang baru.
              const cleanMessages = sanitizeMessagesForHistory(session.messages);
              this._history = [
                { role: 'system', content: AgentEngine.getSystemPrompt(this._currentMode) },
                ...cleanMessages
              ];
              this._view?.webview.postMessage({
                type: 'sessionLoaded',
                session: { ...session, messages: cleanMessages }
              });
            }
          }
          break;
        }

        case 'newSession': {
          this.saveCurrentSession();
          this._sessionId = SessionManager.generateId();
          this.resetHistory();
          this._view?.webview.postMessage({ type: 'newSessionReady', sessionId: this._sessionId });
          break;
        }

        case 'deleteSession': {
          if (data.sessionId) {
            SessionManager.delete(data.sessionId);
            if (data.sessionId === this._sessionId) {
              this._sessionId = SessionManager.generateId();
              this.resetHistory();
              this._view?.webview.postMessage({ type: 'newSessionReady', sessionId: this._sessionId });
            }
            const updatedSessions = SessionManager.list();
            this._view?.webview.postMessage({
              type: 'sessionsList',
              sessions: updatedSessions,
              currentSessionId: this._sessionId
            });
          }
          break;
        }

        case 'pickAttachment':
          await this.handlePickAttachment();
          break;

        case 'setMode':
          this._currentMode = data.mode || 'claude-code';
          this.resetHistory();
          break;

        case 'toggleAutoExecute':
          this._autoExecute = !!data.enabled;
          await vscode.workspace.getConfiguration('sendago').update('autoExecute', this._autoExecute, vscode.ConfigurationTarget.Global);
          break;

        case 'clear':
          this.resetHistory();
          this._sessionId = SessionManager.generateId();
          break;

        case 'setPool':
          await vscode.workspace.getConfiguration('sendago').update('modelPool', data.pool, vscode.ConfigurationTarget.Global);
          break;

        case 'applyEdit':
          if (this.blockIfPlanOnly(data.requestId, 'editAppliedResult')) break;
          await this.handleApplyEdit(data.filePath, data.content, data.requestId);
          break;

        case 'applyAllEdits':
          if (this.blockIfPlanOnly(data.requestId, 'allEditsAppliedResult')) break;
          await this.handleApplyAllEdits(data.edits, data.requestId);
          break;

        case 'applyReplace': {
          if (this.blockIfPlanOnly(data.requestId, 'replaceAppliedResult')) break;
          const repRes = await AgentTools.applySurgicalReplace(data.filePath, data.searchContent, data.replaceContent);
          this._view?.webview.postMessage({
            type: 'replaceAppliedResult',
            requestId: data.requestId,
            success: repRes.success,
            line: repRes.line,
            error: repRes.error
          });
          break;
        }

        case 'viewDiff':
          await AgentTools.showDiffPreview(data.filePath, data.content);
          break;

        case 'runCommand':
          await this.handleRunCommand(data.command, data.requestId);
          break;

        case 'generateImage':
          await this.handleGenerateImage(data.filePath, data.prompt, data.width, data.height, data.requestId);
          break;

        case 'insertCode':
          this.insertCodeAtCursor(data.code);
          break;

        case 'stopAutonomousLoop':
        case 'stopGeneration':
          this._abortController?.abort();
          break;

        case 'setupApiKey':
          await this.promptForApiKey();
          break;

        // Jawaban konfirmasi in-chat dari webview (Confirm / Skip)
        case 'confirmResponse':
          const resolver = this._pendingConfirms.get(data.requestId);
          if (resolver) {
            this._pendingConfirms.delete(data.requestId);
            resolver(!!data.confirmed);
          }
          break;
      }
    });
  }

  /**
   * Alur onboarding API Key: diminta lewat input box VS Code (bukan hanya lewat
   * Settings UI) supaya user baru langsung tau harus ngapain saat status "Offline".
   */
  public async promptForApiKey() {
    const key = await vscode.window.showInputBox({
      title: 'SendaGo AI — Masukkan API Key',
      prompt: 'Ambil API Key dari Dashboard 9Router (menu API Keys), lalu tempel di sini.',
      placeHolder: 'sk-...',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value && value.trim().length > 0) ? null : 'API Key tidak boleh kosong'
    });

    if (key) {
      await this._client.setApiKey(key.trim());
      vscode.window.showInformationMessage('✅ SendaGo API Key tersimpan dengan aman (Secret Storage).');
      await this.refreshStatus();
    }
  }

  public async refreshStatus() {
    if (!this._view) return;
    const health = await this._client.checkHealth();
    const folders = AgentTools.getWorkspaceFolders();
    const workspaceName = folders.length > 1 
      ? `${folders.map(f => f.name).join(', ')}`
      : folders[0]?.name || 'No Workspace';

    const git = await AgentTools.getGitContext();
    const lsp = AgentTools.getLSPDiagnostics();
    const sendagoMd = await AgentTools.readSendaGoMd();
    const activeEditor = vscode.window.activeTextEditor;
    const activeFile = activeEditor ? {
      name: path.basename(activeEditor.document.fileName),
      lines: activeEditor.document.lineCount,
      path: activeEditor.document.fileName
    } : null;

    this._view.webview.postMessage({
      type: 'status',
      ok: health.ok,
      latencyMs: health.latencyMs,
      projectName: workspaceName,
      error: health.error,
      gitBranch: git?.branch || '',
      gitStatus: git?.status || '',
      totalErrors: lsp.totalErrors,
      totalWarnings: lsp.totalWarnings,
      hasSendaGoMd: !!sendagoMd,
      activeFile,
      currentSessionId: this._sessionId
    });
    this._view.webview.postMessage({
      type: 'setPoolValue',
      pool: this._client.modelPool
    });

    this._view.webview.postMessage({
      type: 'setAutoExecuteValue',
      enabled: this._autoExecute
    });

    const projectPermissionMode = ProjectSettings.getPermissionMode();
    this._view.webview.postMessage({
      type: 'setPermissionMode',
      mode: projectPermissionMode ?? (this._autoExecute ? 'auto' : 'ask'),
      projectEnforced: !!projectPermissionMode
    });
  }

  private sendActiveContext() {
    if (!this._view) return;
    const activeEditor = vscode.window.activeTextEditor;
    const activeFile = activeEditor ? {
      name: path.basename(activeEditor.document.fileName),
      lines: activeEditor.document.lineCount,
      path: activeEditor.document.fileName
    } : null;
    const lsp = AgentTools.getLSPDiagnostics();
    this._view.webview.postMessage({
      type: 'activeContextUpdated',
      activeFile,
      totalErrors: lsp.totalErrors,
      totalWarnings: lsp.totalWarnings
    });
  }

  private saveCurrentSession() {
    if (this._history.length > 1) {
      SessionManager.save(this._sessionId, this._history);
    }
  }

  /**
   * Menampilkan kartu konfirmasi inline di dalam CHAT (bukan popup VS Code).
   * Return true jika user klik Konfirmasi, false jika Skip atau timeout 60 detik.
   */
  private async confirmDangerousCommand(
    command: string,
    reason: 'dangerous' | 'unrecognized' | 'untrusted-workspace' = 'dangerous'
  ): Promise<boolean> {
    if (!this._view) return false;
    const requestId = `confirm_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise<boolean>((resolve) => {
      this._pendingConfirms.set(requestId, resolve);

      // Kirim kartu konfirmasi ke webview — muncul di dalam chat
      this._view!.webview.postMessage({
        type: 'dangerousCommandConfirm',
        requestId,
        command,
        reason
      });

      // Timeout 60 detik — jika tidak ada respons, otomatis skip
      setTimeout(() => {
        if (this._pendingConfirms.has(requestId)) {
          this._pendingConfirms.delete(requestId);
          resolve(false);
        }
      }, 60000);
    });
  }

  /**
   * Gerbang tunggal untuk SEMUA eksekusi perintah terminal (baik dari autonomous loop
   * maupun tombol "Run" manual). Perintah hanya boleh jalan tanpa konfirmasi jika:
   * (1) workspace sudah Trusted, DAN (2) perintah cocok allowlist aman, DAN
   * (3) perintah tidak cocok blocklist berbahaya. Selain itu, selalu minta
   * konfirmasi eksplisit di chat sebelum eksekusi.
   */
  private async gateCommandExecution(command: string): Promise<boolean> {
    // Kebijakan proyek (.sendago/settings.json) — dua lapis di atas allow/deny bawaan:
    // 1. `deny` SELALU diblokir, bahkan tanpa opsi konfirmasi manual (beda dari "dangerous"
    //    yang masih bisa di-approve user). Ini setara PreToolUse hook `deny` di Claude Code.
    if (ProjectSettings.getDenyPatterns().some(re => re.test(command))) {
      this._view?.webview.postMessage({
        type: 'assistantMessage',
        text: `🚫 **Diblokir oleh Kebijakan Proyek** (.sendago/settings.json \`deny\`): \`${command}\``
      });
      return false;
    }
    // 2. Plan-Only Mode: tidak ada eksekusi command sama sekali, termasuk klik manual.
    if (this.isPlanOnlyMode()) {
      this._view?.webview.postMessage({
        type: 'assistantMessage',
        text: `🔒 **Plan-Only Mode aktif** — eksekusi perintah dinonaktifkan oleh kebijakan proyek: \`${command}\``
      });
      return false;
    }

    const trusted = AgentTools.isWorkspaceTrusted();
    if (!trusted) {
      return this.confirmDangerousCommand(command, 'untrusted-workspace');
    }
    if (AgentTools.isDangerousCommand(command)) {
      return this.confirmDangerousCommand(command, 'dangerous');
    }
    const projectAllowed = ProjectSettings.getAllowPatterns().some(re => re.test(command));
    if (!projectAllowed && !AgentTools.isSafeAutoCommand(command)) {
      return this.confirmDangerousCommand(command, 'unrecognized');
    }
    return true;
  }

  private isPlanOnlyMode(): boolean {
    return ProjectSettings.getPermissionMode() === 'plan-only';
  }

  /**
   * Dipanggil di SETIAP message handler yang menulis/mengubah workspace (apply edit/replace),
   * bukan cuma di dalam autonomous loop — supaya Plan-Only Mode benar-benar tegak lurus
   * (server-side enforced) walau ada yang mengirim postMessage `applyEdit` dkk secara
   * langsung dari webview, bukan cuma menyembunyikan tombolnya di UI.
   * Return true kalau diblokir (caller harus `break`/berhenti).
   */
  private blockIfPlanOnly(requestId: string | undefined, resultType: string): boolean {
    if (!this.isPlanOnlyMode()) return false;
    vscode.window.showWarningMessage('SendaGo: Plan-Only Mode aktif — perubahan file dinonaktifkan oleh kebijakan proyek (.sendago/settings.json).');
    if (this._view && requestId) {
      this._view.webview.postMessage({ type: resultType, requestId, success: false, error: 'Diblokir oleh Plan-Only Mode.' });
    }
    return true;
  }

  /**
   * Kontrak native tool-calling (OpenAI-compatible) mewajibkan SETIAP tool_call yang
   * dideklarasikan assistant mendapat tepat satu pesan `role: 'tool'` balasan sebelum
   * turn berikutnya — kalau tidak, request selanjutnya ke provider akan ditolak (400).
   * Dipanggil di semua titik keluar loop (done/manual-review/selesai eksekusi) supaya
   * history tetap valid untuk dikirim lagi.
   */
  private pushNativeToolResults(rawToolCalls: ToolCallData[], resultById: Map<string, string>, fallback: string) {
    for (const tc of rawToolCalls) {
      const content = resultById.get(tc.id) ?? fallback;
      this._history.push({ role: 'tool', tool_call_id: tc.id, content: content.slice(0, 6000) });
    }
  }

  /**
   * Coba `streamChat` ke tiap kandidat di `modelChain` berurutan mulai dari
   * `chainState.index` — kalau satu kandidat gagal (network/timeout/HTTP error, BUKAN
   * user klik Stop), otomatis lanjut ke kandidat berikutnya. `chainState.index` diupdate
   * ke kandidat yang BERHASIL, supaya iterasi loop otonom SELANJUTNYA langsung mulai dari
   * situ lagi (tidak perlu coba ulang model yang sudah terbukti mati tiap giliran).
   *
   * Ini yang menggantikan perilaku lama "cuma kirim satu model ID tetap" — sekarang
   * benar-benar mencoba model lain yang aktif di gateway kalau kandidat pertama bermasalah.
   */
  private async streamChatWithFallback(
    modelChain: string[],
    chainState: { index: number },
    onChunk: (text: string) => void,
    controller: AbortController,
    tools?: import('./toolSchemas').ToolDefinition[]
  ): Promise<{ text: string; toolCalls: ToolCallData[] }> {
    const startIndex = chainState.index;
    let lastErr: unknown = null;

    for (let i = startIndex; i < modelChain.length; i++) {
      const attemptModel = modelChain[i];
      let attemptedAnyChunk = false;

      try {
        const result = await this._client.streamChat(
          this._history,
          attemptModel,
          (chunk) => {
            attemptedAnyChunk = true;
            onChunk(chunk);
          },
          controller.signal,
          tools
        );
        chainState.index = i;
        if (i > startIndex) {
          this._view?.webview.postMessage({
            type: 'assistantMessage',
            text: `⚠️ **Model \`${modelChain[startIndex]}\` tidak merespons** — otomatis beralih ke \`${attemptModel}\`.`
          });
        }
        return result;
      } catch (err: any) {
        if (err?.name === 'AbortError') throw err; // User klik Stop — jangan di-fallback, propagate langsung.
        lastErr = err;
        if (attemptedAnyChunk) {
          // Sebagian teks sempat ter-stream dari model yang gagal ini sebelum putus di
          // tengah jalan — bersihkan bubble di client supaya tidak tercampur dengan teks
          // dari model berikutnya yang akan dicoba.
          this._view?.webview.postMessage({ type: 'resetCurrentBubble' });
        }
        // Lanjut ke kandidat berikutnya di chain.
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('Semua model dalam fallback chain gagal merespons.');
  }

  /**
   * Ubah satu respons model jadi daftar aksi — native tool_calls diprioritaskan, kalau
   * kosong jatuh ke regex-parsing tag teks <sendago_*> (jalur fallback untuk provider yang
   * tidak mendukung function-calling).
   */
  private parseActionsFromResponse(rawToolCalls: ToolCallData[], fullResponse: string) {
    return rawToolCalls.length > 0
      ? AgentEngine.buildActionsFromToolCalls(rawToolCalls)
      : {
          edits: AgentEngine.parseFileEdits(fullResponse),
          replaces: AgentEngine.parseFileReplaces(fullResponse),
          greps: AgentEngine.parseGrepActions(fullResponse),
          finds: AgentEngine.parseFindFilesActions(fullResponse),
          commands: AgentEngine.parseTerminalCommands(fullResponse),
          reads: AgentEngine.parseReadFileActions(fullResponse),
          done: AgentEngine.parseTaskDone(fullResponse),
          images: AgentEngine.parseImageActions(fullResponse),
          planSteps: AgentEngine.parsePlanSteps(fullResponse)
        };
  }

  /** True kalau langkah ini mengubah/mengeksekusi sesuatu — bukan sekadar membaca. */
  private hasWriteOrExecAction(parsed: {
    edits: FileEditAction[];
    replaces: FileReplaceAction[];
    commands: CommandAction[];
    images: ImageAction[];
  }): boolean {
    return parsed.edits.length > 0
      || parsed.replaces.length > 0
      || parsed.commands.length > 0
      || parsed.images.length > 0;
  }

  /** True kalau langkah ini menghasilkan aksi apa pun — termasuk sekadar membaca. */
  private hasAnyAction(parsed: {
    edits: FileEditAction[];
    replaces: FileReplaceAction[];
    commands: CommandAction[];
    images: ImageAction[];
    greps: GrepAction[];
    finds: FindFilesAction[];
    reads: ReadFileAction[];
    done: unknown;
  }): boolean {
    return this.hasWriteOrExecAction(parsed)
      || parsed.greps.length > 0
      || parsed.finds.length > 0
      || parsed.reads.length > 0
      || !!parsed.done;
  }

  /**
   * Fingerprint dari SEMUA aksi yang diminta model pada satu turn — dipakai untuk
   * mendeteksi stagnasi (model mengulang tool call PERSIS SAMA berkali-kali tanpa
   * progres nyata, mis. grep/find dengan query yang identik). Ini pengganti "hitung
   * step" sebagai sinyal berhenti utama: task kompleks yang genuinely butuh banyak
   * langkah BERBEDA tidak akan pernah kena ini, karena signature-nya selalu berubah.
   */
  private computeActionSignature(
    replaces: FileReplaceAction[],
    edits: FileEditAction[],
    greps: GrepAction[],
    finds: FindFilesAction[],
    reads: ReadFileAction[],
    commands: CommandAction[],
    images: ImageAction[]
  ): string {
    const parts: string[] = [];
    greps.forEach(g => parts.push(`grep:${g.query}:${g.include || ''}:${g.path || ''}`));
    finds.forEach(f => parts.push(`find:${f.pattern}`));
    reads.forEach(r => parts.push(`read:${r.filePath}:${r.startLine ?? ''}:${r.endLine ?? ''}`));
    commands.forEach(c => parts.push(`cmd:${c.command}`));
    replaces.forEach(r => parts.push(`replace:${r.filePath}:${r.searchContent.slice(0, 60)}`));
    edits.forEach(e => parts.push(`edit:${e.filePath}:${e.newContent.length}`));
    images.forEach(i => parts.push(`image:${i.filePath}`));
    return parts.sort().join('|');
  }

  /**
   * Giliran terakhir TANPA tool — dipanggil begitu loop berhenti karena stagnasi atau
   * mentok safety-net, supaya user SELALU dapat kesimpulan bahasa natural dari AI
   * (apa yang sudah dikerjakan/ditemukan, dan langkah lanjutan kalau ada), bukan cuma
   * kotak peringatan mentah. `reason` disisipkan ke directive supaya modelnya paham
   * KENAPA harus berhenti sekarang dan bisa menjelaskannya ke user kalau relevan.
   */
  private async runFinalSummaryTurn(
    modelChain: string[],
    chainState: { index: number },
    controller: AbortController,
    reason: string
  ): Promise<void> {
    this._history.push({
      role: 'user',
      content: `[Directive: Stop calling any tools now. ${reason} In natural Indonesian, summarize clearly what has been accomplished/found so far, your conclusion, and any remaining next steps the user should take. Respond with plain text only — no tool calls, no <sendago_*> tags.]`,
      internal: true
    });

    this._view?.webview.postMessage({ type: 'startFinalSummary' });

    let summaryText = '';
    try {
      // Sengaja TIDAK kirim `tools` — memaksa provider membalas teks biasa. Tetap lewat
      // streamChatWithFallback supaya giliran ringkasan ini juga tangguh kalau kandidat
      // model yang lagi aktif ternyata drop di momen akhir ini.
      const result = await this.streamChatWithFallback(
        modelChain,
        chainState,
        (chunk) => {
          this._view?.webview.postMessage({ type: 'chunk', text: chunk });
        },
        controller
      );
      summaryText = result.text;
    } catch {
      // Kalau giliran ringkasan ini sendiri gagal (termasuk seluruh fallback chain habis),
      // jangan biarkan seluruh turn crash — fallback teks di bawah tetap memastikan user
      // tidak melihat layar kosong.
    }

    if (!summaryText.trim()) {
      summaryText = 'Proses otonom dihentikan karena tidak ada progres baru yang terdeteksi setelah beberapa langkah. Silakan lanjutkan dengan instruksi yang lebih spesifik jika masih ada pekerjaan yang perlu diselesaikan.';
      this._view?.webview.postMessage({ type: 'chunk', text: summaryText });
    }

    this._history.push({ role: 'assistant', content: summaryText });
  }

  /**
   * Pangkas log eksekusi tool lama agar context window tetap hemat dan responsif (Auto-Compaction)
   */
  private compactHistoryIfLarge(): void {
    if (this._history.length <= 6) return;

    // Hitung total karakter konten riwayat
    const totalChars = this._history.reduce((acc, m) => acc + (m.content?.length || 0), 0);
    if (totalChars < 25000) return;

    // Pertahankan: index 0 (system prompt), index 1 (prompt asli user), dan 3 pesan terakhir
    const keepLastCount = 3;
    const startIndex = 2;
    const endIndex = this._history.length - keepLastCount;

    for (let i = startIndex; i < endIndex; i++) {
      const msg = this._history[i];
      if (msg.role === 'user' && typeof msg.content === 'string') {
        // Ringkas output terminal lama yang berhasil
        if (msg.content.includes('[Observed Command Output]')) {
          msg.content = msg.content.replace(
            /\[Observed Command Output\]\s*\$ ([^\n]+)\s*Status: Success[^\n]*\nOutput:\s*```[\s\S]*?```/g,
            '[Past Command: "$1" completed successfully]'
          );
        }
        // Pangkas pembacaan file lama yang sudah berlalu
        if (msg.content.includes('[File Content:')) {
          msg.content = msg.content.replace(
            /\[File Content: ([^\]]+)\]\s*```[\s\S]*?```/g,
            '[File "$1" was previously inspected]'
          );
        }
        // Pangkas hasil pencarian grep lama
        if (msg.content.includes('[Workspace Grep Search')) {
          msg.content = msg.content.replace(
            /\[Workspace Grep Search for "[^"]+" \(\d+ matches\)\]:[\s\S]*?(?=\n\[|$)/g,
            '[Prior Grep search completed]'
          );
        }
      }
    }
  }

  public async handleUserPrompt(
    promptText: string,
    pool?: string,
    mode?: AgentMode,
    attachments?: { name: string; path: string; content: string }[]
  ) {
    if (!this._view) return;

    if (promptText.startsWith('/')) {
      await this.handleSlashCommand(promptText);
      return;
    }

    if (mode) {
      this._currentMode = mode;
    }

    // Ambil Konteks Lengkap Projek
    const projectContext = await AgentTools.getFullProjectContext(promptText);

    // Gabungkan file lampiran (attachment) jika ada
    if (projectContext && attachments && attachments.length > 0) {
      if (!projectContext.attachedFiles) {
        projectContext.attachedFiles = [];
      }
      for (const att of attachments) {
        projectContext.attachedFiles.push({
          path: att.name,
          content: att.content
        });
      }
    }

    // Update dynamic system prompt dengan konteks projek & attachment
    const systemPrompt = AgentEngine.getSystemPrompt(this._currentMode, projectContext);
    this._history[0] = { role: 'system', content: systemPrompt };

    this._history.push({ role: 'user', content: promptText });

    const isClaudeCode = this._currentMode === 'claude-code' || this._currentMode === 'agent';
    // Fallback nyata + rotasi model: `chain` untuk langkah berat (tulis kode/jalankan
    // perintah), `lightChain` untuk langkah ringan (mencerna hasil pencarian, menyusun
    // kesimpulan). Keduanya punya state index sendiri supaya kalau satu kandidat mati,
    // yang diingat cuma untuk jenis langkah yang bersangkutan.
    const modelPlan = await this._client.resolveModelPlanForPool(pool);
    const modelChain = modelPlan.chain;
    const modelChainState = { index: 0 };
    const lightChainState = { index: 0 };
    // Langkah pertama selalu pakai model utama: di sinilah task dipahami & rencana disusun.
    let nextStepIsLight = false;
    let lightModelNoticeShown = false;
    let consecutiveLightSteps = 0;
    const MAX_CONSECUTIVE_LIGHT_STEPS = 2;
    let lightOverreachCount = 0;
    let lightRotationDisabled = false;
    const MAX_LIGHT_OVERREACH = 2;

    // Permission mode: .sendago/settings.json milik REPO (bisa di-commit, berlaku untuk
    // semua kontributor) menang atas setting personal `sendago.autoExecute` di VS Code —
    // sama seperti .claude/settings.json yang dibaca bareng-bareng oleh CLI & IDE extension
    // di Claude Code asli. Kalau project tidak menentukan apa-apa, fallback ke setting lama.
    const projectPermissionMode = ProjectSettings.getPermissionMode();
    const effectivePermissionMode: PermissionMode = projectPermissionMode ?? (this._autoExecute ? 'auto' : 'ask');

    // Di workspace yang belum "Trusted", jangan pernah auto-apply file write/replace
    // meski permission mode "auto" — perlakukan seperti mode Ask sampai user secara
    // eksplisit mempercayai workspace ini (mencegah prompt-injection dari konten repo
    // asing langsung menulis/menjalankan sesuatu di mesin user).
    const workspaceTrusted = AgentTools.isWorkspaceTrusted();
    const autoExecuteAllowed = effectivePermissionMode === 'auto' && workspaceTrusted;
    if (effectivePermissionMode === 'auto' && !workspaceTrusted && !this._untrustedNoticeShown) {
      this._untrustedNoticeShown = true;
      this._view.webview.postMessage({
        type: 'assistantMessage',
        text: '🔒 **Workspace belum dipercaya (Restricted Mode).** Eksekusi otomatis dinonaktifkan sementara — setiap perintah/edit file akan meminta konfirmasi Anda di chat sampai workspace ini di-trust lewat VS Code.'
      });
    }
    if (projectPermissionMode && projectPermissionMode !== (this._autoExecute ? 'auto' : 'ask') && !this._projectPolicyNoticeShown) {
      this._projectPolicyNoticeShown = true;
      this._view.webview.postMessage({
        type: 'assistantMessage',
        text: `🔒 **Kebijakan Proyek Aktif (.sendago/settings.json):** permission mode dipaksa ke \`${projectPermissionMode}\`, menimpa setting personal Anda untuk workspace ini.`
      });
    }

    const controller = new AbortController();
    this._abortController = controller;

    let currentStep = 0;
    // `maxSteps` sekarang murni safety-net terakhir (default besar), BUKAN target harian —
    // mekanisme berhenti yang sebenarnya adalah task_done ATAU deteksi stagnasi di bawah,
    // supaya task yang genuinely kompleks & butuh banyak langkah nyata tidak dipotong paksa.
    const maxSteps = this._maxAutonomousSteps;
    let lastActionSignature: string | null = null;
    let repeatStreak = 0;

    try {
      while (currentStep < maxSteps) {
        currentStep++;
        let fullResponse = '';

        // Otomatis pangkas log eksekusi lama yang membengkak agar token tetap efisien
        this.compactHistoryIfLarge();

        this._view?.webview.postMessage({
          type: 'loopStep',
          step: currentStep,
          maxSteps,
          isLoop: isClaudeCode && currentStep > 1
        });

        // Hybrid tool-calling: kirim skema `tools` — provider yang mendukung native
        // function-calling akan balas lewat toolCalls terstruktur; provider yang tidak
        // mendukungnya akan mengabaikan field ini dan tetap balas teks tag <sendago_*>
        // (jalur fallback parseFileEdits/dst di bawah tetap berjalan seperti sebelumnya).
        // streamChatWithFallback mencoba chain berurutan kalau kandidat pertama gagal
        // (lihat method-nya) — fullResponse diambil dari return value (bukan diakumulasi
        // manual di sini) supaya tidak tercampur dengan chunk dari attempt yang gagal.
        // Rotasi model: langkah yang cuma perlu mencerna hasil pencarian dipindah ke
        // lightChain (model termurah), langkah berat tetap di model utama pool.
        // `lightRotationDisabled`: kalau model ringan berkali-kali mengambil keputusan yang
        // harus diulang model utama, rotasinya justru merugikan (satu langkah jadi dua
        // panggilan). Setelah beberapa kali, hentikan rotasi untuk sisa giliran ini.
        const useLightModel = nextStepIsLight
          && !lightRotationDisabled
          && modelPlan.lightChain.length > 0;

        if (useLightModel && !lightModelNoticeShown) {
          lightModelNoticeShown = true;
          this._view?.webview.postMessage({
            type: 'assistantMessage',
            text: `💡 **Hemat token:** langkah eksplorasi memakai model ringan \`${modelPlan.lightChain[lightChainState.index]}\` — model utama disimpan untuk menulis/memperbaiki kode.`
          });
        }

        // PENTING: model ringan tetap diberi tool LENGKAP. Versi sebelumnya hanya memberi
        // tool baca dengan maksud "mustahil dia menulis kode" — tapi efeknya justru fatal:
        // model yang memakai native tool-calling hanya bisa bertindak lewat tool yang
        // tersedia, jadi begitu giliran jatuh ke model ringan, dia tidak punya cara untuk
        // menyatakan "sekarang saatnya menulis" dan hanya bisa membaca terus. Agent jadi
        // nyangkut di eksplorasi dan kodenya tidak pernah dieksekusi. Kualitas kode tetap
        // dijaga oleh pengaman di bawah, bukan dengan mencabut tool-nya.
        const runStepAttempt = (light: boolean) => this.streamChatWithFallback(
          light ? modelPlan.lightChain : modelChain,
          light ? lightChainState : modelChainState,
          (chunk) => {
            this._view?.webview.postMessage({ type: 'chunk', text: chunk });
          },
          controller,
          getToolDefinitionsForMode(this._currentMode)
        );

        let attempt = await runStepAttempt(useLightModel);
        let parsed = this.parseActionsFromResponse(attempt.toolCalls, attempt.text);

        // PENGAMAN ANTI-TURUN-KUALITAS: model ringan hanya boleh mengerjakan langkah
        // eksplorasi. Tiga keputusan berikut dikembalikan ke model utama:
        //  1. Menulis/menjalankan sesuatu — kualitas kode tidak boleh turun.
        //  2. Menyatakan SELURUH task selesai (task_done). Ini penyebab bug yang dilaporkan:
        //     model murah gampang merasa "sudah beres" setelah sekali membaca hasil grep,
        //     dan karena task_done langsung menghentikan loop + menampilkan kesimpulan,
        //     pekerjaan berhenti di tengah jalan padahal belum selesai.
        //  3. Tidak menghasilkan aksi apa pun (cuma teks) — kalau dibiarkan, loop berhenti
        //     karena tidak ada yang dieksekusi, jadi giliran ini pun harus diulang.
        const lightAttemptOverreached = useLightModel && (
          this.hasWriteOrExecAction(parsed) || !!parsed.done || !this.hasAnyAction(parsed)
        );

        if (lightAttemptOverreached) {
          lightOverreachCount++;
          if (lightOverreachCount >= MAX_LIGHT_OVERREACH) lightRotationDisabled = true;

          this._view?.webview.postMessage({ type: 'resetCurrentBubble' });
          this._view?.webview.postMessage({
            type: 'assistantMessage',
            text: '↩️ Langkah ini butuh keputusan model utama — dikembalikan agar kualitas & kelengkapan pekerjaan tetap terjaga.'
          });
          attempt = await runStepAttempt(false);
          parsed = this.parseActionsFromResponse(attempt.toolCalls, attempt.text);
        }

        fullResponse = attempt.text;
        const rawToolCalls = attempt.toolCalls;
        const isNativeToolCall = rawToolCalls.length > 0;

        if (isNativeToolCall) {
          this._history.push({
            role: 'assistant',
            content: fullResponse || null,
            tool_calls: rawToolCalls
          });
        } else {
          this._history.push({ role: 'assistant', content: fullResponse });
        }

        const { edits, replaces, greps, finds, commands, reads, done, images, planSteps } = parsed;

        // Hasil eksekusi per tool_call (jalur native) — dipakai pushNativeToolResults di
        // setiap titik keluar loop. Jalur legacy tetap pakai feedbackContent seperti semula.
        const toolResultById = new Map<string, string>();

        if (replaces.length > 0) {
          this._view.webview.postMessage({ type: 'fileReplacesDetected', replaces, autoApplied: isClaudeCode && autoExecuteAllowed });
        }
        if (edits.length > 0) {
          this._view.webview.postMessage({ type: 'fileEditsDetected', edits, autoApplied: isClaudeCode && autoExecuteAllowed });
        }
        if (greps.length > 0) {
          this._view.webview.postMessage({ type: 'grepsDetected', greps });
        }
        if (finds.length > 0) {
          this._view.webview.postMessage({ type: 'findsDetected', finds });
        }
        if (images.length > 0) {
          this._view.webview.postMessage({ type: 'imagesDetected', images });
        }
        if (planSteps.length > 0) {
          this._view.webview.postMessage({ type: 'planStepsDetected', steps: planSteps });
        }
        if (commands.length > 0) {
          // autoApplied: true berarti loop di bawah akan mengeksekusi command ini sendiri
          // (via gateCommandExecution) — beri tahu client agar TIDAK memicu eksekusi kedua.
          this._view.webview.postMessage({ type: 'commandsDetected', commands, autoApplied: isClaudeCode && autoExecuteAllowed });
        }

        // Jika model mengindikasikan task selesai
        if (done) {
          this._view.webview.postMessage({ type: 'taskCompleted', summary: done.summary });
          if (isNativeToolCall) {
            if (done.toolCallId) toolResultById.set(done.toolCallId, 'Task marked done and acknowledged.');
            this.pushNativeToolResults(rawToolCalls, toolResultById, 'Not executed — task was already marked done in this turn.');
          }
          break;
        }

        // Aksi tulis/eksekusi (replace, edit, command) HANYA auto-jalan di mode
        // Claude Code/Agent dengan autoExecute diizinkan — selain itu cukup tampil
        // sebagai kartu "Ask" di UI (sudah dikirim lewat postMessage di atas).
        // Aksi BACA (grep/find/read) di bawah SELALU jalan di semua mode — read-only,
        // tanpa efek samping — supaya Chat mode juga bisa "cari dulu baru jawab"
        // alih-alih diam-diam mengabaikan permintaan grep/read model.
        const writeExecAllowed = isClaudeCode && autoExecuteAllowed;

        let executedAny = false;
        let feedbackContent = '';
        // Dipakai untuk memutuskan jenis model giliran berikutnya: begitu ada yang gagal
        // (replace tidak ketemu, command exit != 0, file tidak terbaca), giliran berikutnya
        // butuh penalaran serius untuk memperbaikinya — jangan dialihkan ke model ringan.
        let stepHadFailure = false;

        // 1. Terapkan Surgical Search-and-Replace (Prioritas Utama untuk File Eksis)
        if (writeExecAllowed && replaces.length > 0) {
          const appliedReplaces: { file: string; line?: number }[] = [];
          const failedReplaces: { file: string; error?: string }[] = [];
          for (const rep of replaces) {
            try {
              const res = await AgentTools.applySurgicalReplace(rep.filePath, rep.searchContent, rep.replaceContent);
              if (res.success) {
                appliedReplaces.push({ file: rep.filePath, line: res.line });
                if (rep.toolCallId) toolResultById.set(rep.toolCallId, `Replace applied successfully to ${rep.filePath} at line ${res.line}.`);
              } else {
                stepHadFailure = true;
                failedReplaces.push({ file: rep.filePath, error: res.error });
                if (rep.toolCallId) toolResultById.set(rep.toolCallId, `Replace FAILED on ${rep.filePath}: ${res.error}`);
              }
            } catch (err: any) {
              stepHadFailure = true;
              failedReplaces.push({ file: rep.filePath, error: err.message });
              if (rep.toolCallId) toolResultById.set(rep.toolCallId, `Replace FAILED on ${rep.filePath}: ${err.message}`);
            }
          }
          if (appliedReplaces.length > 0) {
            executedAny = true;
            this._view?.webview.postMessage({ type: 'filesAutoReplaced', replaces: appliedReplaces });
            feedbackContent += `[Surgical Replace Applied to Workspace:\n${appliedReplaces.map(r => `  - ${r.file} (Modified at line ${r.line})`).join('\n')}]\n`;
          }
          if (failedReplaces.length > 0) {
            executedAny = true;
            feedbackContent += `[Surgical Replace Notice:\n${failedReplaces.map(f => `  - ${f.file}: ${f.error}`).join('\n')}]\n`;
          }
        }

        // 2. Terapkan pembuatan file baru / penulisan ulang lengkap
        if (writeExecAllowed && edits.length > 0) {
          const appliedFiles: string[] = [];
          for (const edit of edits) {
            try {
              const ok = await AgentTools.applyWorkspaceEdit(edit.filePath, edit.newContent);
              if (ok) {
                appliedFiles.push(edit.filePath);
              } else {
                stepHadFailure = true;
              }
              if (edit.toolCallId) {
                toolResultById.set(edit.toolCallId, ok ? `File written successfully: ${edit.filePath}` : `File write rejected (empty content guard): ${edit.filePath}`);
              }
            } catch (err: any) {
              stepHadFailure = true;
              if (edit.toolCallId) toolResultById.set(edit.toolCallId, `File write FAILED: ${edit.filePath}: ${err.message}`);
            }
          }
          if (appliedFiles.length > 0) {
            executedAny = true;
            this._view?.webview.postMessage({ type: 'filesAutoApplied', files: appliedFiles });
            feedbackContent += `[Files Automatically Written to Workspace:\n${appliedFiles.map(f => `  - ${f}`).join('\n')}]\n`;
          }
        }

        // 3. Pencarian Grep di Workspace
        if (greps.length > 0) {
          for (const g of greps) {
            executedAny = true;
            const matches = await AgentTools.grepWorkspace(g.query, {
              isRegex: g.isRegex,
              include: g.include,
              path: g.path
            });
            this._view?.webview.postMessage({
              type: 'grepResult',
              query: g.query,
              count: matches.length
            });
            const grepBody = matches.length === 0
              ? 'No occurrences found in workspace.'
              : `${matches.slice(0, 35).map(m => `${m.file}:${m.line}: ${m.text}`).join('\n')}${matches.length > 35 ? `\n... (${matches.length - 35} other occurrences omitted)` : ''}`;
            feedbackContent += `\n[Workspace Grep Search for "${g.query}" (${matches.length} matches)]:\n${grepBody}\n`;
            if (g.toolCallId) toolResultById.set(g.toolCallId, `${matches.length} matches for "${g.query}":\n${grepBody}`);
          }
        }

        // 4. Pencarian Berkas (Glob) di Workspace
        if (finds.length > 0) {
          for (const f of finds) {
            executedAny = true;
            const filesFound = await AgentTools.findWorkspaceFiles(f.pattern, f.maxResults || 40);
            this._view?.webview.postMessage({
              type: 'findResult',
              pattern: f.pattern,
              count: filesFound.length
            });
            const findBody = filesFound.length === 0
              ? 'No matching files found.'
              : `${filesFound.slice(0, 40).map(fp => `  - ${fp}`).join('\n')}${filesFound.length > 40 ? `\n  ... (${filesFound.length - 40} other files omitted)` : ''}`;
            feedbackContent += `\n[Workspace Files Matching "${f.pattern}" (${filesFound.length} files)]:\n${findBody}\n`;
            if (f.toolCallId) toolResultById.set(f.toolCallId, `${filesFound.length} files matching "${f.pattern}":\n${findBody}`);
          }
        }

        // 5. Baca file yang diminta model (dengan dukungan startLine & endLine)
        if (reads.length > 0) {
          for (const readAction of reads) {
            executedAny = true;
            try {
              const content = await AgentTools.readFileContent(readAction.filePath, readAction.startLine, readAction.endLine);
              feedbackContent += `\n[File Content: ${readAction.filePath}]\n\`\`\`\n${content.slice(0, 15000)}\n\`\`\`\n`;
              if (readAction.toolCallId) toolResultById.set(readAction.toolCallId, `File: ${readAction.filePath}\n${content.slice(0, 15000)}`);
            } catch (err: any) {
              stepHadFailure = true;
              feedbackContent += `\n[File Not Found or Unreadable: ${readAction.filePath}: ${err.message}]\n`;
              if (readAction.toolCallId) toolResultById.set(readAction.toolCallId, `File not found or unreadable: ${readAction.filePath}: ${err.message}`);
            }
          }
        }

        // 6. Eksekusi perintah terminal dengan live output stream
        if (writeExecAllowed && commands.length > 0) {
          for (const cmd of commands) {
            // Gerbang tunggal: workspace trust -> blocklist berbahaya -> allowlist aman.
            // Command yang tidak trusted/tidak dikenal/berbahaya SELALU minta konfirmasi,
            // tidak lagi auto-run hanya karena "tidak match blocklist".
            const allowed = await this.gateCommandExecution(cmd.command);
            if (!allowed) {
              feedbackContent += `\n[Command Skipped by User]: ${cmd.command}\n`;
              if (cmd.toolCallId) toolResultById.set(cmd.toolCallId, 'Command skipped by user (not executed).');
              continue;
            }

            executedAny = true;
            const termId = `term_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            this._view?.webview.postMessage({
              type: 'terminalStart',
              termId,
              command: cmd.command,
              desc: cmd.description
            });

            const res = await AgentTools.executeCommandWithOutput(cmd.command, {
              onStdout: (chunk) => {
                this._view?.webview.postMessage({ type: 'terminalChunk', termId, text: chunk, isStderr: false });
              },
              onStderr: (chunk) => {
                this._view?.webview.postMessage({ type: 'terminalChunk', termId, text: chunk, isStderr: true });
              },
              abortSignal: controller.signal
            });

            this._view?.webview.postMessage({
              type: 'terminalEnd',
              termId,
              exitCode: res.exitCode,
              durationMs: res.durationMs,
              timedOut: res.timedOut
            });

            if (res.isBackground) {
              this._view?.webview.postMessage({ type: 'serverStartedToast', command: cmd.command });
            }

            if (res.exitCode !== 0 || res.timedOut) stepHadFailure = true;
            const cleanStdout = (res.stdout || '').trim().slice(0, 5000);
            const cleanStderr = (res.stderr || '').trim().slice(0, 3000);
            feedbackContent += `\n[Observed Command Output]\n$ ${cmd.command}\nStatus: ${res.exitCode === 0 ? 'Success (Exit 0)' : `Failed (Exit ${res.exitCode})`} (${res.durationMs}ms)\n`;
            if (cleanStdout) {
              feedbackContent += `Output:\n\`\`\`\n${cleanStdout}\n\`\`\`\n`;
            }
            if (cleanStderr) {
              feedbackContent += `Errors / Stderr:\n\`\`\`\n${cleanStderr}\n\`\`\`\n`;
            }
            if (cmd.toolCallId) {
              toolResultById.set(cmd.toolCallId, `Exit ${res.exitCode}${res.timedOut ? ' (timed out)' : ''}.\nStdout: ${cleanStdout || '(empty)'}\nStderr: ${cleanStderr || '(empty)'}`);
            }
          }
        }

        // Generate gambar TIDAK di-auto-run di sini (selalu lewat kartu konfirmasi UI /
        // client autoMode trigger — lihat imagesDetected) — cukup siapkan tool-result
        // placeholder-nya supaya kontrak native tool-calling tetap valid.
        for (const img of images) {
          if (img.toolCallId && !toolResultById.has(img.toolCallId)) {
            toolResultById.set(img.toolCallId, 'Ditampilkan ke UI untuk konfirmasi user (klik Generate untuk membuat gambar) — belum otomatis dibuat.');
          }
        }

        // Kalau tulis/eksekusi tidak diizinkan auto-run (mis. Chat mode yang melanjutkan
        // loop karena grep/read berhasil), tool_call replace/edit/command TIDAK dieksekusi
        // sama sekali di atas — pastikan tool-result-nya tidak ikut ke-cap "OK" oleh fallback
        // generik di bawah, karena itu akan menyesatkan model (dikira sudah berhasil jalan).
        if (!writeExecAllowed) {
          const skippedNote = 'Ditampilkan ke UI untuk konfirmasi manual — belum dieksekusi otomatis di mode/setting saat ini.';
          for (const rep of replaces) {
            if (rep.toolCallId && !toolResultById.has(rep.toolCallId)) toolResultById.set(rep.toolCallId, skippedNote);
          }
          for (const edit of edits) {
            if (edit.toolCallId && !toolResultById.has(edit.toolCallId)) toolResultById.set(edit.toolCallId, skippedNote);
          }
          for (const cmd of commands) {
            if (cmd.toolCallId && !toolResultById.has(cmd.toolCallId)) toolResultById.set(cmd.toolCallId, skippedNote);
          }
        }

        // Jika tidak ada tool yang perlu dieksekusi, loop selesai
        if (!executedAny) {
          if (isNativeToolCall) {
            // Tetap perlu tool-result untuk tool_call yang gagal di-parse/tidak dieksekusi
            // (mis. generate_image — tidak auto-run, selalu lewat kartu konfirmasi UI).
            this.pushNativeToolResults(
              rawToolCalls,
              toolResultById,
              'Ditampilkan ke UI untuk konfirmasi user (belum dieksekusi otomatis).'
            );
          }
          break;
        }

        // Deteksi stagnasi LEBIH DULU (sebelum menyusun nudge/directive) — kalau aksi yang
        // diminta model turn ini PERSIS SAMA dengan turn sebelumnya (mis. grep/find query
        // identik berkali-kali tanpa progres), itu tanda model terjebak "memeriksa lagi"
        // bukan mengerjakan sesuatu yang baru. Ini pengganti "hitung step" sebagai sinyal
        // berhenti utama — task kompleks yang tiap langkahnya genuinely berbeda TIDAK akan
        // pernah kena ini, berapa pun banyaknya langkah.
        // Rotasi model untuk giliran BERIKUTNYA: kalau giliran ini murni eksplorasi
        // read-only (grep/find/read) dan semuanya mulus, giliran berikutnya cuma perlu
        // mencerna hasil pencarian — cukup pakai model ringan. Begitu ada tulis/eksekusi
        // atau ada yang gagal, balik lagi ke model utama karena butuh penalaran serius.
        const didWriteOrExecute = replaces.length > 0 || edits.length > 0 || commands.length > 0 || images.length > 0;
        const didReadOnlyOnly = (greps.length > 0 || finds.length > 0 || reads.length > 0) && !didWriteOrExecute;

        // Batasi berapa giliran beruntun yang boleh dipegang model ringan. Tanpa ini, task
        // yang eksplorasinya panjang bisa berlarut-larut di model murah dan terasa lambat
        // "mulai mengerjakan"; setelah batas ini, kembalikan kemudi ke model utama.
        consecutiveLightSteps = useLightModel ? consecutiveLightSteps + 1 : 0;
        const lightBudgetLeft = consecutiveLightSteps < MAX_CONSECUTIVE_LIGHT_STEPS;
        nextStepIsLight = didReadOnlyOnly && !stepHadFailure && lightBudgetLeft;

        const actionSignature = this.computeActionSignature(replaces, edits, greps, finds, reads, commands, images);
        if (actionSignature && actionSignature === lastActionSignature) {
          repeatStreak++;
        } else {
          repeatStreak = 0;
        }
        lastActionSignature = actionSignature;

        const isStagnant = repeatStreak >= 2;
        // Safety-net terakhir kalau benar-benar tidak ada tanda stagnasi TAPI jatah step
        // (default besar, bisa dinaikkan lagi di Settings untuk task yang sangat kompleks)
        // sudah habis.
        const stepLimitHit = currentStep >= maxSteps;
        const shouldStopNow = isStagnant || stepLimitHit;

        // Masukkan output eksekusi ke history untuk giliran berikutnya. Kalau kita akan
        // berhenti sekarang, JANGAN sisipkan nudge "lanjutkan/panggil tool lagi" — itu
        // kontradiktif dengan directive "berhenti & rangkum" yang dikirim runFinalSummaryTurn
        // sesudahnya, dan bisa membingungkan model yang kurang agentic.
        if (isNativeToolCall) {
          this.pushNativeToolResults(rawToolCalls, toolResultById, 'OK — tidak ada output.');
          if (!shouldStopNow) {
            // BUG FIX: tidak seperti jalur legacy (tag teks) yang selalu menyertakan directive
            // eksplisit "lanjutkan/jawab sekarang", protokol native tool-calling murni tidak
            // punya nudge apa pun — sepenuhnya bergantung pada kecenderungan agentic model.
            // Untuk model yang kurang agentic (umum di pool free/hybrid), ini membuat model
            // terus memanggil tool baca berulang tanpa pernah menjawab/memanggil task_done.
            const nativeNudge = writeExecAllowed
              ? `[Directive: Tool results above are ready. Do NOT repeat or echo them verbatim. In natural Indonesian, tell the user what was observed, then continue now — call the next tool if more work remains, or call task_done once everything is verified complete. Do not stay silent.]`
              : `[Directive: The tool result above is now available. Do NOT repeat or echo it verbatim. Answer the user's question in natural Indonesian using this information now — only call another tool if genuinely still needed.]`;
            this._history.push({ role: 'user', content: nativeNudge, internal: true });
          }
        } else {
          // Directive khusus mode non-autonomous (Chat/Plan, atau Agent tanpa autoExecute):
          // hasil di atas kemungkinan besar hanya dari grep/find/read (read-only), jadi model
          // diarahkan untuk LANGSUNG menjawab pakai info tsb — bukan didorong terus memanggil
          // tool tulis/eksekusi seolah sedang di autonomous loop.
          const directive = shouldStopNow
            ? ''
            : writeExecAllowed
              ? `[Directive: The tool executions finished. Do NOT repeat, quote, or echo the command output or logs above. In natural Indonesian, tell the user what was observed and immediately emit the next <sendago_replace>, <sendago_cmd>, <sendago_edit>, or <sendago_done>.]`
              : `[Directive: The read-only result above (grep/find/read) is now available. Do NOT repeat or echo it verbatim. Answer the user's question in natural Indonesian using this information now — only request another tool if genuinely still needed.]`;
          this._history.push({
            role: 'user',
            content: `${feedbackContent}\n${directive}`,
            internal: true
          });
        }

        if (isStagnant) {
          // Giliran ringkasan = murni merangkum apa yang sudah terjadi, tidak menulis kode
          // dan tidak memanggil tool — cukup pakai lightChain supaya tidak boros token.
          await this.runFinalSummaryTurn(
            modelPlan.lightChain,
            lightChainState,
            controller,
            'You have repeated the exact same tool call multiple times in a row without making new progress.'
          );
          break;
        }

        if (stepLimitHit) {
          // Giliran ringkasan = murni merangkum apa yang sudah terjadi, tidak menulis kode
          // dan tidak memanggil tool — cukup pakai lightChain supaya tidak boros token.
          await this.runFinalSummaryTurn(
            modelPlan.lightChain,
            lightChainState,
            controller,
            `You have used all ${maxSteps} available autonomous steps for this task.`
          );
          break;
        }

        // Catatan: tidak ada lagi postMessage progress generik di sini (dulu 'observingOutput')
        // — itu duplikat dengan badge "Step N/M" yang juga sudah dihapus dari sisi client.
        // Bubble baru di step berikutnya sudah punya shimmer loader sendiri sebagai indikator
        // "masih bekerja", jadi tidak perlu indikator terpisah yang berulang & terasa kaku.
        await new Promise(r => setTimeout(r, 400));
      }

      this._view?.webview.postMessage({ type: 'done' });
      this.saveCurrentSession();
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        this._view?.webview.postMessage({ type: 'stopped' });
      } else {
        this._view?.webview.postMessage({ type: 'error', error: err.message });
      }
    } finally {
      this._abortController = null;
      this.repairDanglingToolCalls();
      this.saveCurrentSession();
    }
  }

  /**
   * Safety net: kalau turn berakhir (error/abort) tepat setelah assistant message
   * dengan `tool_calls` di-push tapi SEBELUM tool-result-nya sempat di-push (mis. user
   * klik Stop atau ada exception tak terduga di tengah eksekusi), history akan invalid
   * untuk provider native tool-calling di request berikutnya. Tambal dengan tool-result
   * placeholder supaya kontrak tetap valid dan sesi tetap bisa dilanjutkan/disimpan.
   */
  private repairDanglingToolCalls(): void {
    const last = this._history[this._history.length - 1];
    if (last && last.role === 'assistant' && last.tool_calls && last.tool_calls.length > 0) {
      for (const tc of last.tool_calls) {
        this._history.push({ role: 'tool', tool_call_id: tc.id, content: 'Execution interrupted before result was recorded.' });
      }
    }
  }

  public async handleSlashCommand(cmd: string) {
    if (!this._view) return;
    const parts = cmd.trim().split(/\s+/);
    const command = parts[0].toLowerCase();

    switch (command) {
      case '/help':
        this._view.webview.postMessage({
          type: 'assistantMessage',
          text: `### 🤖 SendaGo AI (Claude Code & Antigravity Edition) — Commands Guide

| Perintah | Fungsi |
|---|---|
| **/fix-errors** | Scan semua error TypeScript/LSP di workspace & jalankan perbaikan otonom |
| **/git-diff** | Periksa perubahan git yang belum di-commit dan lakukan review kode |
| **/commit** | Buat pesan conventional commit otomatis berdasarkan git status & diff |
| **/compact** | Ringkas riwayat percakapan untuk menghemat context window |
| **/init** | Buat file panduan \`SENDAGO.md\` untuk projek ini |
| **/permissions** | Buka/buat kebijakan permission proyek \`.sendago/settings.json\` (auto/ask/plan-only, allow/deny) |
| **/model** \`[nama]\` | Ganti model AI aktif (atau buka selector model) |
| **/clear** | Bersihkan chat & mulai percakapan baru |
| **@filename** | Ketik \`@\` untuk melampirkan file workspace sebagai konteks |

**Tips Pintar:**
- Tekan **Tab** atau klik pada menu popup saat mengetik \`/\` atau \`@\`
- Mode **⚡ Auto**: Eksekusi perintah aman & perbaikan file langsung tanpa klik Run
- Mode **🛡️ Ask**: Tampilkan kartu konfirmasi interaktif di dalam chat sebelum eksekusi`
        });
        break;

      case '/fix-errors': {
        const lsp = AgentTools.getLSPDiagnostics();
        if (lsp.totalErrors === 0 && lsp.totalWarnings === 0) {
          this._view.webview.postMessage({
            type: 'assistantMessage',
            text: '✅ **Workspace Bersih!** Tidak ada error atau warning yang dilaporkan oleh Language Server.'
          });
          return;
        }
        const prompt = `Periksa dan perbaiki ${lsp.totalErrors} error dan ${lsp.totalWarnings} warning berikut di workspace:\n\n${lsp.summaryText}\n\nAnalisis akar penyebabnya dan gunakan <sendago_edit> untuk memperbaiki setiap file yang error.`;
        await this.handleUserPrompt(prompt, undefined, 'claude-code');
        break;
      }

      case '/git-diff': {
        const git = await AgentTools.getGitContext();
        if (!git || !git.diffSummary) {
          this._view.webview.postMessage({
            type: 'assistantMessage',
            text: `🌿 **Git Working Tree Bersih**: Tidak ada perubahan yang belum di-commit pada branch \`${git?.branch || 'unknown'}\`.`
          });
          return;
        }
        const folders = AgentTools.getWorkspaceFolders();
        const root = folders[0]?.uri.fsPath;
        const diffRes = await AgentTools.executeCommandWithOutput('git diff', { cwd: root, timeoutMs: 10000 });
        const prompt = `Tinjau git diff berikut pada branch "${git.branch}":\n\n\`\`\`diff\n${diffRes.stdout.slice(0, 10000)}\n\`\`\`\n\nBerikan review ringkas: apa yang berubah, potensi bug, dan saran perbaikan jika ada.`;
        await this.handleUserPrompt(prompt, undefined, 'claude-code');
        break;
      }

      case '/commit': {
        const git = await AgentTools.getGitContext();
        const folders = AgentTools.getWorkspaceFolders();
        const root = folders[0]?.uri.fsPath;
        const diffRes = await AgentTools.executeCommandWithOutput('git diff HEAD', { cwd: root, timeoutMs: 10000 });
        const diffText = diffRes.stdout || git?.status || '';
        if (!diffText.trim()) {
          this._view.webview.postMessage({
            type: 'assistantMessage',
            text: 'ℹ️ Tidak ada perubahan git untuk dibuatkan commit message.'
          });
          return;
        }
        const prompt = `Berdasarkan perubahan git berikut:\n\`\`\`diff\n${diffText.slice(0, 8000)}\n\`\`\`\n\nBuat 3 opsi Conventional Commit message yang jelas dan deskriptif (format: type(scope): description), sertakan penjelasan singkat. Tampilkan blok kode shell \`git commit -m "..."\` yang siap di-run.`;
        await this.handleUserPrompt(prompt, undefined, 'claude-code');
        break;
      }

      case '/compact': {
        if (this._history.length <= 3) {
          this._view.webview.postMessage({
            type: 'assistantMessage',
            text: 'ℹ️ Riwayat chat masih pendek, belum perlu diringkas.'
          });
          return;
        }
        const systemMsg = this._history[0];
        const lastUser = this._history.filter(m => m.role === 'user').pop();
        let lastAssistant = this._history.filter(m => m.role === 'assistant').pop();
        if (lastAssistant && lastAssistant.tool_calls && lastAssistant.tool_calls.length > 0) {
          // Tool-result pasangannya (role: 'tool') ikut terbuang saat compact — buang juga
          // referensi tool_calls yatim ini, kalau tidak request berikutnya ke provider
          // native tool-calling akan invalid (assistant tool_calls tanpa tool result).
          lastAssistant = { role: 'assistant', content: lastAssistant.content || '[Ringkasan aksi sebelumnya telah dipadatkan]' };
        }
        const summaryText = `[Session Context Compacted: Diskusi sebelumnya mencakup analisis kode, eksekusi terminal, dan file yang dimodifikasi. Percakapan dilanjutkan dari konteks terbaru.]`;
        this._history = [
          systemMsg,
          { role: 'system', content: summaryText }
        ];
        if (lastUser) this._history.push(lastUser);
        if (lastAssistant) this._history.push(lastAssistant);
        this.saveCurrentSession();
        this._view.webview.postMessage({
          type: 'assistantMessage',
          text: '📦 **Percakapan Diringkas!** Riwayat chat sebelumnya telah dipadatkan untuk menghemat context window.'
        });
        break;
      }

      case '/init': {
        const folders = AgentTools.getWorkspaceFolders();
        if (folders.length === 0) return;
        const sendagoPath = path.join(folders[0].uri.fsPath, 'SENDAGO.md');
        if (fs.existsSync(sendagoPath)) {
          vscode.commands.executeCommand('vscode.open', vscode.Uri.file(sendagoPath));
          this._view.webview.postMessage({
            type: 'assistantMessage',
            text: `📄 File **SENDAGO.md** sudah ada di root project dan telah dibuka di editor.`
          });
          return;
        }
        const template = `# SENDAGO.md — Project Instructions & Guidelines

## 🌟 Overview
- **Project Name**: ${folders[0].name}
- **Stack**: ${folders[0].name} Web / Fullstack Application

## 🛠️ Development Conventions
- Gunakan TypeScript untuk semua kode baru.
- Ikuti arsitektur modular & clean architecture.
- Jangan hardcode API keys atau credentials.
- Selalu jalankan \`npm test\` atau linter sebelum commit.

## 🚀 Autonomous AI Directives
- **Safe Commands**: Jalankan test, linter, build secara otomatis.
- **File Writes**: Selalu periksa dependency sebelum menambahkan import baru.
`;
        fs.writeFileSync(sendagoPath, template, 'utf-8');
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(sendagoPath));
        this._view.webview.postMessage({
          type: 'assistantMessage',
          text: `🎉 File **SENDAGO.md** berhasil dibuat di root workspace! AI SendaGo akan otomatis membaca instruksi ini pada setiap percakapan.`
        });
        await this.refreshStatus();
        break;
      }

      case '/permissions': {
        const filePath = ProjectSettings.ensureTemplate();
        if (!filePath) {
          this._view.webview.postMessage({
            type: 'assistantMessage',
            text: '⚠️ Buka sebuah folder workspace terlebih dahulu untuk membuat kebijakan permission proyek.'
          });
          return;
        }
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
        const currentMode = ProjectSettings.getPermissionMode() || 'ask';
        this._view.webview.postMessage({
          type: 'assistantMessage',
          text: `🔒 **.sendago/settings.json** dibuka di editor. Permission mode proyek saat ini: \`${currentMode}\`.\n\n` +
            `- \`"permissionMode": "auto"\` — izinkan auto-execute (tetap tunduk Workspace Trust).\n` +
            `- \`"permissionMode": "ask"\` — selalu minta konfirmasi manual.\n` +
            `- \`"permissionMode": "plan-only"\` — read-only total, tombol Apply/Run dinonaktifkan.\n` +
            `- \`"allow"\` / \`"deny"\`: array pola regex tambahan untuk perintah terminal. File ini boleh di-commit ke repo agar berlaku untuk semua kontributor.`
        });
        await this.refreshStatus();
        break;
      }

      case '/clear':
        this.resetHistory();
        this._sessionId = SessionManager.generateId();
        this._view.webview.postMessage({ type: 'sessionCleared' });
        break;

      default:
        this._view.webview.postMessage({
          type: 'assistantMessage',
          text: `❓ Perintah \`${command}\` tidak dikenal. Ketik **/help** untuk melihat daftar perintah yang tersedia.`
        });
        break;
    }
  }

  /**
   * Beralih mode agent secara terprogram (dipicu dari Command Palette),
   * sekaligus sinkronkan tab UI di webview & reset history percakapan.
   */
  public switchMode(mode: AgentMode) {
    this._currentMode = mode;
    this.resetHistory();
    this._view?.show?.(true);
    this._view?.webview.postMessage({ type: 'switchMode', mode });
  }

  /**
   * Jalankan auto-edit pada SELURUH isi file aktif di editor (bukan hanya seleksi),
   * sesuai janji command "SendaGo: Auto-Edit Active File".
   */
  public async autoEditActiveFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Buka file yang ingin diedit terlebih dahulu.');
      return;
    }

    this.switchMode('agent');

    const doc = editor.document;
    const fileName = path.basename(doc.fileName);
    const prompt = `Tinjau seluruh isi file "${fileName}" berikut secara menyeluruh, perbaiki bug dan tingkatkan kualitas kodenya, lalu terapkan hasilnya sebagai auto-edit lengkap untuk file ini:\n\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\``;
    await this.handleUserPrompt(prompt, undefined, 'agent');
  }

  /**
   * Menjalankan perintah yang dipicu dari tombol "Run" di webview (code block,
   * plan step, atau auto-mode client-side), melalui gerbang keamanan yang sama
   * dengan autonomous loop (lihat gateCommandExecution).
   */
  private async handleRunCommand(command: string, requestId?: string) {
    if (!command || !command.trim()) return;

    const ran = await this.gateCommandExecution(command);

    if (ran) {
      AgentTools.executeTerminalCommand(command);
    }

    if (this._view && requestId) {
      this._view.webview.postMessage({ type: 'commandResult', requestId, ran });
    }
  }

  private async handleGenerateImage(filePath: string, prompt: string, width?: number, height?: number, requestId?: string) {
    if (this.isPlanOnlyMode()) {
      if (this._view && requestId) {
        this._view.webview.postMessage({ type: 'imageGenerationResult', requestId, success: false, filePath, error: 'Diblokir oleh Plan-Only Mode.' });
      }
      return;
    }
    const res = await AgentTools.generateAndSaveImage(filePath, prompt, width, height);
    if (this._view && requestId) {
      this._view.webview.postMessage({
        type: 'imageGenerationResult',
        requestId,
        success: res.success,
        filePath: res.filePath,
        error: res.error
      });
    }
  }

  private async handleApplyEdit(filePath: string, content: string, requestId?: string) {
    let success = false;
    try {
      success = await AgentTools.applyWorkspaceEdit(filePath, content);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Gagal membuat/mengedit file: ${err.message}`);
    }
    if (this._view && requestId) {
      this._view.webview.postMessage({
        type: 'editAppliedResult',
        requestId,
        success,
        filePath
      });
    }
  }

  private async handleApplyAllEdits(edits: { filePath: string; content: string }[], requestId?: string) {
    if (!edits || edits.length === 0) return;

    let createdCount = 0;
    const results: { filePath: string; success: boolean }[] = [];
    for (const edit of edits) {
      try {
        const ok = await AgentTools.applyWorkspaceEdit(edit.filePath, edit.content);
        if (ok) createdCount++;
        results.push({ filePath: edit.filePath, success: ok });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Gagal membuat file ${edit.filePath}: ${err.message}`);
        results.push({ filePath: edit.filePath, success: false });
      }
    }

    vscode.window.setStatusBarMessage(`$(check) SendaGo: Sukses membuat & mengupdate ${createdCount} file`, 3000);
    if (this._view && requestId) {
      this._view.webview.postMessage({
        type: 'allEditsAppliedResult',
        requestId,
        count: createdCount,
        results
      });
    }
  }

  public async handleQuickAction(action: string) {
    const editor = vscode.window.activeTextEditor;
    const selection = editor ? editor.document.getText(editor.selection) : '';

    if (!selection) {
      vscode.window.showWarningMessage('Silakan blok/pilih baris kode di editor terlebih dahulu.');
      return;
    }

    let prompt = '';
    let mode: AgentMode = 'chat';

    switch (action) {
      case 'explain':
        prompt = `Tolong jelaskan potongan kode berikut secara ringkas:\n\`\`\`\n${selection}\n\`\`\``;
        mode = 'chat';
        break;
      case 'fix':
        prompt = `Perbaiki bug atau error pada kode berikut:\n\`\`\`\n${selection}\n\`\`\``;
        mode = 'agent';
        break;
      case 'test':
        prompt = `Buatkan unit test lengkap untuk kode berikut:\n\`\`\`\n${selection}\n\`\`\``;
        mode = 'agent';
        break;
      case 'refactor':
        prompt = `Refactor kode berikut agar lebih bersih, efisien, dan maintainable:\n\`\`\`\n${selection}\n\`\`\``;
        mode = 'agent';
        break;
    }

    if (prompt) {
      this._view?.show?.(true);
      this._view?.webview.postMessage({ type: 'switchMode', mode });
      await this.handleUserPrompt(prompt, undefined, mode);
    }
  }

  private async handlePickAttachment() {
    try {
      const files = await AgentTools.listWorkspaceFiles(250);
      const items: vscode.QuickPickItem[] = [];

      // 1. Tambahkan shortcut file aktif di editor jika ada
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        const doc = activeEditor.document;
        const root = AgentTools.getWorkspaceRoot();
        const rel = root ? path.relative(root, doc.fileName) : path.basename(doc.fileName);
        items.push({
          label: `$(star) File Aktif: ${path.basename(doc.fileName)}`,
          description: rel,
          detail: doc.fileName
        });
      }

      // 2. Tambahkan opsi browse disk
      items.push({
        label: `$(folder) Browse from Computer...`,
        description: 'Pilih file apapun dari disk'
      });

      // 3. Tambahkan semua file workspace
      files.forEach(f => {
        items.push({
          label: `$(file-code) ${f}`,
          description: 'Workspace File'
        });
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Pilih file yang ingin dilampirkan ke SendaGo AI...'
      });

      if (!selected) return;

      if (selected.detail) {
        // File aktif di editor
        const content = activeEditor ? activeEditor.document.getText() : await AgentTools.readFileContent(selected.detail);
        this._view?.webview.postMessage({
          type: 'attachmentAdded',
          file: {
            name: path.basename(selected.detail),
            path: selected.description || selected.detail,
            content: content.slice(0, 20000)
          }
        });
        vscode.window.setStatusBarMessage(`$(check) SendaGo: File ${path.basename(selected.detail)} dilampirkan`, 2500);
      } else if (selected.label.includes('Browse from Computer...')) {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: true,
          openLabel: 'Lampirkan File'
        });
        if (uris) {
          for (const u of uris) {
            try {
              const content = await AgentTools.readFileContent(u.fsPath);
              this._view?.webview.postMessage({
                type: 'attachmentAdded',
                file: {
                  name: path.basename(u.fsPath),
                  path: u.fsPath,
                  content: content.slice(0, 20000)
                }
              });
              vscode.window.setStatusBarMessage(`$(check) SendaGo: File ${path.basename(u.fsPath)} dilampirkan`, 2500);
            } catch (err: any) {
              vscode.window.showErrorMessage(`Gagal membaca file: ${err.message}`);
            }
          }
        }
      } else {
        const rawPath = selected.label.replace('$(file-code) ', '').trim();
        try {
          const content = await AgentTools.readFileContent(rawPath);
          this._view?.webview.postMessage({
            type: 'attachmentAdded',
            file: {
              name: path.basename(rawPath),
              path: rawPath,
              content: content.slice(0, 20000)
            }
          });
          vscode.window.setStatusBarMessage(`$(check) SendaGo: File ${path.basename(rawPath)} dilampirkan`, 2500);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Gagal membaca file ${rawPath}: ${err.message}`);
        }
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Gagal membuka file picker: ${err.message}`);
    }
  }

  private insertCodeAtCursor(code: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Tidak ada file editor yang sedang aktif.');
      return;
    }

    editor.edit(editBuilder => {
      editBuilder.insert(editor.selection.active, code);
    });
  }

  /** Nonce acak per-render — dipakai CSP untuk hanya mengizinkan script kita sendiri jalan. */
  private _getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
      text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'sendagoai.png'));
    const mascotDirUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'mascot'));
    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>SendaGo AI</title>
</head>
<!-- data-mascot-dir: URI folder pose maskot diteruskan ke main.js supaya indikator
     "sedang bekerja" bisa memakai maskot SendaGo (ganti pose sesuai tahapan), bukan titik
     abu-abu yang terlihat diam. Webview tidak bisa memuat file lokal langsung, jadi URI-nya
     harus lewat asWebviewUri() di sini. -->
<body data-mascot-dir="${mascotDirUri}">
  <!-- Clean SendaGo AI Header (Claude Minimalist Style) -->
  <header class="claude-header">
    <div class="hdr-action-left">
      <button id="btn-sessions" class="icon-subtle" title="Riwayat Percakapan (Chat History)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <span id="sessions-badge" class="badge-mini" style="display:none;">0</span>
      </button>
    </div>

    <div class="brand-center">
      <img src="${logoUri}" class="sendago-brand-logo" alt="SendaGo AI">
      <span class="sendago-brand-title">SendaGo AI</span>
    </div>

    <div class="hdr-action-right">
      <button id="btn-new-chat" class="icon-subtle" title="Percakapan Baru (New Chat)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    </div>
  </header>

  <!-- Hidden Compatibility Controls & State Sync -->
  <div class="state-sync-hidden" style="display:none !important;" aria-hidden="true">
    <div id="status-badge" class="status-pill offline"><span id="status-text">Checking...</span></div>
    <div id="project-badge"><span id="project-name">Connecting...</span></div>
    <div id="git-badge"><span id="git-branch">main</span></div>
    <div id="lsp-badge"><span id="lsp-count">0 errors</span></div>
    <div id="sendago-badge"><span class="ctx-text">SENDAGO.md</span></div>
    <button id="btn-mention-popup"></button>
    <div class="seg-controls">
      <button class="seg-btn active" data-mode="claude-code" id="tab-claude"></button>
      <button class="seg-btn" data-mode="agent" id="tab-ask"></button>
      <button class="seg-btn" data-mode="chat" id="tab-chat"></button>
      <button class="seg-btn" data-mode="plan" id="tab-plan"></button>
    </div>
    <select id="pool-select">
      <option value="pro">🔵 Claude Pro</option>
      <option value="claude-sonnet-5-fusion" selected>🔥 Sonnet 5 High</option>
      <option value="hybrid">🟡 Hybrid</option>
      <option value="free">🟢 Free Tier</option>
    </select>
    <div id="agent-loop-pill">
      <span id="agent-step-text">Step 1/8</span>
      <button id="btn-stop-loop">✕</button>
    </div>
  </div>

  <!-- Sessions Drawer / History Overlay -->
  <div id="sessions-drawer" class="sessions-drawer" style="display: none;">
    <div class="drawer-header">
      <div class="drawer-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <span>Riwayat Sesi</span>
      </div>
      <div class="drawer-header-actions">
        <button id="drawer-btn-new" class="btn-drawer-action">+ Sesi Baru</button>
        <button id="drawer-btn-close" class="btn-drawer-close">✕</button>
      </div>
    </div>
    <div id="sessions-list" class="sessions-list">
      <div class="sessions-empty">Belum ada riwayat sesi tersimpan.</div>
    </div>
  </div>

  <!-- Messages Scrollable Canvas -->
  <main id="messages" class="messages-container">
    <!-- SendaGo AI Minimalist Empty State -->
    <div id="claude-empty-state" class="claude-empty-state">
      <div class="empty-headline">
        Apa yang ingin Anda kerjakan terlebih dahulu? Tanyakan seputar codebase ini atau kita bisa langsung mulai menulis kode.
      </div>

      <!-- Auto mode information card -->
      <div id="auto-mode-card" class="auto-mode-card">
        <div class="am-header">
          <div class="am-title-row">
            <svg class="am-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            <span id="am-card-title">Mode Otomatis Aktif</span>
          </div>
          <button id="btn-close-am-card" class="am-close-btn" title="Tutup">✕</button>
        </div>
        <p id="am-card-desc" class="am-desc">
          Mode Auto memungkinkan SendaGo menangani izin aksi secara otomatis. SendaGo memeriksa setiap tool call untuk tindakan berisiko sebelum dieksekusi, menjalankan tugas aman secara mandiri, dan meminta persetujuan untuk tindakan berisiko tinggi.
        </p>
        <a id="am-learn-more" class="am-link" href="#">Pelajari selengkapnya</a>
      </div>
    </div>
  </main>

  <!-- Interactive Action Area (Diffs & Plans) -->
  <div id="actions-panel" class="actions-panel" style="display: none;"></div>

  <!-- Floating Autocomplete Menus -->
  <div id="slash-menu" class="autocomplete-popup" style="display: none;"></div>
  <div id="mention-menu" class="autocomplete-popup" style="display: none;"></div>

  <!-- Claude Code Minimalist Bottom Input Area -->
  <footer class="claude-footer">
    <!-- Active Context Floating Chips -->
    <div class="floating-context-bar">
      <div id="active-file-pill" class="active-file-chip" style="display: none;">
        <span class="chip-file-icon">📄</span>
        <span id="active-file-name" class="chip-file-label">file.ts</span>
        <button id="btn-add-active-file" class="btn-chip-add" title="Tambahkan ke prompt">+</button>
      </div>
      <div id="attachments-bar" class="attachments-row" style="display: none;"></div>
    </div>

    <!-- Terracotta-bordered Input Card -->
    <div class="claude-input-card">
      <div class="input-main-row">
        <textarea
          id="prompt-input"
          rows="1"
          placeholder="Tanyakan ke SendaGo untuk mengedit atau membuat kode..."
        ></textarea>
        <button id="btn-mic" class="input-mic-btn" title="Input Suara / Dikte">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0 6-0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        </button>
      </div>

      <!-- Inside Toolbar -->
      <div class="claude-card-toolbar">
        <div class="toolbar-left">
          <!-- Plus attachment button -->
          <button id="btn-attach" class="card-icon-btn" title="Lampirkan file atau konteks (+)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>

          <!-- Slash command button ⧄ -->
          <button id="btn-cmd-popup" class="card-icon-btn" title="Perintah slash (/)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="3" ry="3"></rect>
              <line x1="7" y1="17" x2="17" y2="7"></line>
            </svg>
          </button>

          <!-- Model Selector Pill Button -->
          <div class="model-pill-wrapper">
            <button id="btn-model-pill" class="model-pill" title="Pilih Model AI">
              <span id="model-pill-name">Sonnet 5 High</span>
            </button>

            <!-- Sleek Popover Menu -->
            <div id="model-popover" class="model-popover" style="display: none;">
              <div class="popover-item" data-value="pro">
                <div class="pi-title">🔵 Claude Pro</div>
                <div class="pi-desc">Akun Claude Pro resmi terhubung</div>
              </div>
              <div class="popover-item selected" data-value="claude-sonnet-5-fusion">
                <div class="pi-title">🔥 Sonnet 5 High</div>
                <div class="pi-desc">Fusion Free Combo (Smartest)</div>
              </div>
              <div class="popover-item" data-value="hybrid">
                <div class="pi-title">🟡 Hybrid</div>
                <div class="pi-desc">Auto-fallback Sonnet → Flash</div>
              </div>
              <div class="popover-item" data-value="free">
                <div class="pi-title">🟢 Free Tier</div>
                <div class="pi-desc">Groq / Gemini 3.7</div>
              </div>
            </div>
          </div>
        </div>

        <div class="toolbar-right">
          <!-- Auto mode toggle -->
          <button id="btn-mode-quick" class="auto-mode-toggle" title="Klik untuk beralih mode Auto / Ask">
            <svg class="bolt-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            <span id="mode-quick-text">Auto</span>
          </button>

          <!-- Send / Stop Button in terracotta squircle -->
          <button id="btn-send" class="claude-send-btn" title="Kirim instruksi (Enter)">
            <span class="send-arrow">↑</span>
          </button>
        </div>
      </div>
    </div>
  </footer>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
