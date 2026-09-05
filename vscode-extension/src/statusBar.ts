import * as vscode from 'vscode';
import { NineRouterClient } from './routerClient';

export class SendaGoStatusBar {
  private _statusBarItem: vscode.StatusBarItem;

  constructor(private readonly _client: NineRouterClient) {
    this._statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this._statusBarItem.command = 'sendago.switchModelPool';
    this.update();
    this._statusBarItem.show();
  }

  public async update() {
    const pool = this._client.modelPool;
    const poolIcon = pool === 'free' ? '🟢 Free' : pool === 'pro' ? '🔵 Pro' : '🟡 Hybrid';

    this._statusBarItem.text = `$(sparkle) SendaGo: ${poolIcon}`;
    this._statusBarItem.tooltip = `SendaGo AI Gateway (${this._client.defaultModel})\nClick to switch routing pool`;
  }

  public dispose() {
    this._statusBarItem.dispose();
  }
}
