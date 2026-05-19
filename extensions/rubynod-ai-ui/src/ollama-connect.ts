import * as vscode from 'vscode';
import { getServiceUrl, getProvider, getModel, getBaseUrl } from './settings';

export class OllamaConnect implements vscode.Disposable {
  private statusItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 85);
    this.statusItem.command = 'rubynod.selectOllamaModel';
    this.statusItem.tooltip = 'Rubynod — Ollama model (click to change)';
  }

  start(context: vscode.ExtensionContext): void {
    void this.connect(context);

    this.disposables.push(
      vscode.commands.registerCommand('rubynod.selectOllamaModel', () => this.pickModel(context)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('rubynod.models') || e.affectsConfiguration('rubynod.ollama')) {
          void this.refreshStatus();
        }
      })
    );
    context.subscriptions.push(this);
  }

  private ollamaHost(): string {
    const cfg = vscode.workspace.getConfiguration('rubynod');
    const host = cfg.get<string>('ollama.host', 'http://127.0.0.1:11434');
    const baseUrl = getBaseUrl() || cfg.get<string>('models.baseUrl', '');
    if (baseUrl) return baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    return host.replace(/\/$/, '');
  }

  private isAutoConnect(): boolean {
    return vscode.workspace.getConfiguration('rubynod').get<boolean>('ollama.autoConnect', true);
  }

  async connect(context: vscode.ExtensionContext): Promise<void> {
    if (getProvider() !== 'ollama') {
      this.statusItem.hide();
      return;
    }

    const host = this.ollamaHost();
    try {
      const res = await fetch(
        `${getServiceUrl()}/ollama/models?host=${encodeURIComponent(host)}`
      );
      const json = (await res.json()) as {
        ok?: boolean;
        models?: Array<{ name: string }>;
        suggested?: string;
        error?: string;
      };

      if (!json.ok || !json.models?.length) {
        this.statusItem.text = '$(error) Ollama offline';
        this.statusItem.show();
        if (this.isAutoConnect()) {
          vscode.window.showWarningMessage(
            `Rubynod: Ollama not running at ${host}. Start with: ollama serve`,
            'Open Ollama docs'
          ).then((c) => {
            if (c) vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
          });
        }
        return;
      }

      const cfg = vscode.workspace.getConfiguration('rubynod');
      const current = getModel();
      const names = json.models.map((m) => m.name);
      const hasCurrent = names.some((n) => n === current || n.startsWith(`${current}:`));

      if (this.isAutoConnect() && (!hasCurrent || current === 'llama3.2')) {
        const pick = json.suggested ?? names[0];
        if (pick && pick !== current) {
          await cfg.update('models.chatModel', pick, vscode.ConfigurationTarget.Global);
        }
      }

      const model = cfg.get<string>('models.chatModel', current);
      this.statusItem.text = `$(hubot) Ollama: ${model}`;
      this.statusItem.show();

      if (this.isAutoConnect() && !context.globalState.get('rubynod.ollama.connectedOnce')) {
        context.globalState.update('rubynod.ollama.connectedOnce', true);
        vscode.window.showInformationMessage(`Rubynod connected to Ollama (${model})`);
      }
    } catch {
      this.statusItem.text = '$(error) Rubynod AI offline';
      this.statusItem.command = 'rubynod.startAiService';
      this.statusItem.tooltip = 'Click to start Rubynod AI service (port 3847)';
      this.statusItem.show();
    }
  }

  private async pickModel(context: vscode.ExtensionContext): Promise<void> {
    const host = this.ollamaHost();
    const res = await fetch(`${getServiceUrl()}/ollama/models?host=${encodeURIComponent(host)}`);
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    const models = json.models ?? [];
    if (!models.length) {
      vscode.window.showErrorMessage(`No Ollama models at ${host}. Run: ollama pull llama3.2`);
      return;
    }

    const pick = await vscode.window.showQuickPick(
      models.map((m) => ({ label: m.name, description: host })),
      { placeHolder: 'Select Ollama model for Rubynod' }
    );
    if (!pick) return;

    const cfg = vscode.workspace.getConfiguration('rubynod');
    await cfg.update('models.provider', 'ollama', vscode.ConfigurationTarget.Global);
    await cfg.update('models.chatModel', pick.label, vscode.ConfigurationTarget.Global);
    await cfg.update('models.baseUrl', `${host}/v1`, vscode.ConfigurationTarget.Global);
    this.statusItem.text = `$(hubot) Ollama: ${pick.label}`;
    vscode.window.showInformationMessage(`Rubynod using Ollama model: ${pick.label}`);
    void this.connect(context);
  }

  private async refreshStatus(): Promise<void> {
    if (getProvider() === 'ollama') {
      this.statusItem.text = `$(hubot) Ollama: ${getModel()}`;
      this.statusItem.show();
    } else {
      this.statusItem.hide();
    }
  }

  dispose(): void {
    this.statusItem.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
