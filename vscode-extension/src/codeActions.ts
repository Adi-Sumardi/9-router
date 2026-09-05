import * as vscode from 'vscode';
import { NineRouterClient } from './routerClient';
import { SendaGoSidebarProvider } from './sidebarProvider';

export function registerCodeCommands(
  context: vscode.ExtensionContext,
  client: NineRouterClient,
  sidebar: SendaGoSidebarProvider
) {
  // 0. Open Chat / Plan Mode / Auto Edit / Claude Code Mode
  context.subscriptions.push(
    vscode.commands.registerCommand('sendago.openChat', async () => {
      await vscode.commands.executeCommand('sendago.sidebarView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sendago.claudeCodeMode', async () => {
      await vscode.commands.executeCommand('sendago.sidebarView.focus');
      sidebar.switchMode('claude-code');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sendago.planMode', async () => {
      await vscode.commands.executeCommand('sendago.sidebarView.focus');
      sidebar.switchMode('plan');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sendago.autoEditFile', async () => {
      await vscode.commands.executeCommand('sendago.sidebarView.focus');
      await sidebar.autoEditActiveFile();
    })
  );

  // 1. Explain Code
  context.subscriptions.push(
    vscode.commands.registerCommand('sendago.explainCode', async () => {
      await vscode.commands.executeCommand('sendago.sidebarView.focus');
      await sidebar.handleQuickAction('explain');
    })
  );

  // 2. Fix Bug
  context.subscriptions.push(
    vscode.commands.registerCommand('sendago.fixBug', async () => {
      await vscode.commands.executeCommand('sendago.sidebarView.focus');
      await sidebar.handleQuickAction('fix');
    })
  );

  // 3. Generate Unit Tests
  context.subscriptions.push(
    vscode.commands.registerCommand('sendago.generateTests', async () => {
      await vscode.commands.executeCommand('sendago.sidebarView.focus');
      await sidebar.handleQuickAction('test');
    })
  );

  // 4. Optimize & Refactor
  context.subscriptions.push(
    vscode.commands.registerCommand('sendago.optimizeCode', async () => {
      await vscode.commands.executeCommand('sendago.sidebarView.focus');
      await sidebar.handleQuickAction('refactor');
    })
  );

  // 5. Generate Documentation
  context.subscriptions.push(
    vscode.commands.registerCommand('sendago.generateDocs', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (!selection) {
        vscode.window.showWarningMessage('Silakan pilih kode untuk digenerate dokumentasinya.');
        return;
      }
      await vscode.commands.executeCommand('sendago.sidebarView.focus');
      await sidebar.handleUserPrompt(`Tuliskan dokumentasi / docstrings JSDoc / Python Docstring lengkap untuk kode berikut:\n\n\`\`\`\n${selection}\n\`\`\``);
    })
  );

  // 6. Switch Model Pool
  context.subscriptions.push(
    vscode.commands.registerCommand('sendago.switchModelPool', async () => {
      const selected = await vscode.window.showQuickPick([
        { label: '🔥 Claude Sonnet 5+ (Free Fusion Combo)', description: 'Gemini 3.7 High + Sonnet + Groq (100% Free Frontier Synergy)', value: 'claude-sonnet-5-fusion' },
        { label: '🟡 Hybrid (Auto-Fallback)', description: 'Prioritas Subscription -> Murah -> Free', value: 'hybrid' },
        { label: '🟢 Free Tier ($0 Cost)', description: 'Hanya menggunakan model gratisan (Groq/Gemini)', value: 'free' },
        { label: '🔵 Pro Pool (High Reasoning)', description: 'Menggunakan model penalaran tinggi (Claude Sonnet/R1)', value: 'pro' }
      ], {
        placeHolder: 'Pilih Model Routing Pool untuk SendaGo AI'
      });

      if (selected) {
        await vscode.workspace.getConfiguration('sendago').update('modelPool', selected.value, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`SendaGo Routing Pool diubah ke: ${selected.label}`);
        sidebar.refreshStatus();
      }
    })
  );

  // 7. Check Gateway Status
  context.subscriptions.push(
    vscode.commands.registerCommand('sendago.checkGatewayStatus', async () => {
      const health = await client.checkHealth();
      if (health.ok) {
        vscode.window.showInformationMessage(`✅ 9Router Gateway Terhubung! Latensi: ${health.latencyMs}ms (${health.modelCount} model tersedia)`);
      } else {
        vscode.window.showErrorMessage(`❌ 9Router Gateway Tidak Terhubung: ${health.error}. Pastikan docker/service 9router aktif di port 20128.`);
      }
      sidebar.refreshStatus();
    })
  );

  // 8. Set API Key
  context.subscriptions.push(
    vscode.commands.registerCommand('sendago.setupApiKey', async () => {
      await sidebar.promptForApiKey();
    })
  );
}
