import * as vscode from 'vscode';
import { NineRouterClient, API_KEY_SECRET } from './routerClient';
import { SendaGoSidebarProvider } from './sidebarProvider';
import { SendaGoStatusBar } from './statusBar';
import { registerCodeCommands } from './codeActions';

/**
 * Migrasi satu kali: API Key lama tersimpan plaintext di settings.json (`sendago.apiKey`).
 * Pindahkan ke Secret Storage (terenkripsi OS keychain) lalu hapus dari settings agar
 * tidak lagi bocor lewat Settings Sync / dotfiles backup.
 */
async function migrateLegacyApiKey(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('sendago');
  const legacyKey = config.get<string>('apiKey');
  if (!legacyKey || !legacyKey.trim()) return;

  const alreadyMigrated = await context.secrets.get(API_KEY_SECRET);
  if (!alreadyMigrated) {
    await context.secrets.store(API_KEY_SECRET, legacyKey.trim());
  }
  await config.update('apiKey', undefined, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage('SendaGo: API Key dipindahkan ke penyimpanan aman (Secret Storage).');
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('SendaGo AI Extension is now active!');

  await migrateLegacyApiKey(context);

  const client = new NineRouterClient(context);
  const statusBar = new SendaGoStatusBar(client);
  const sidebarProvider = new SendaGoSidebarProvider(context.extensionUri, client);

  // Register Webview View Provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SendaGoSidebarProvider.viewType,
      sidebarProvider
    )
  );

  // Register Status Bar
  context.subscriptions.push(statusBar);

  // Register Commands
  registerCodeCommands(context, client, sidebarProvider);

  // Listen to configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sendago')) {
        statusBar.update();
        sidebarProvider.refreshStatus();
      }
    })
  );

  // Background health poll every 30s
  const interval = setInterval(() => {
    statusBar.update();
    sidebarProvider.refreshStatus();
  }, 30000);

  context.subscriptions.push({
    dispose: () => clearInterval(interval)
  });
}

export function deactivate() {
  console.log('SendaGo AI Extension deactivated.');
}
