import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getWorkspaceRoot } from './settings';
import { buildRipgrepShell, isWindows } from './platform';
import { writeWorkspaceFile } from './file-write';

const execAsync = promisify(exec);

const terminalBuffers = new Map<string, string>();

export function attachTerminalListener(): void {
  vscode.window.onDidStartTerminalShellExecution?.(() => {});
  vscode.window.terminals.forEach((t) => watchTerminal(t));
  vscode.window.onDidOpenTerminal((t) => watchTerminal(t));
}

function watchTerminal(terminal: vscode.Terminal): void {
  const name = terminal.name;
  if (!terminalBuffers.has(name)) terminalBuffers.set(name, '');
}

export function getTerminalOutput(): string {
  const parts: string[] = [];
  for (const [name, buf] of terminalBuffers) {
    parts.push(`### Terminal: ${name}\n${buf.slice(-8000)}`);
  }
  return parts.join('\n\n') || '(no terminal output captured)';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createIdeBridge(): Record<string, (...args: any[]) => Promise<unknown>> {
  const ws = () => getWorkspaceRoot();

  return {
    readFile: async (filePath: string, offset?: number, limit?: number) => {
      const abs = path.isAbsolute(filePath) ? filePath : path.join(ws(), filePath);
      if (!fs.existsSync(abs)) {
        return `Error: File not found: ${filePath}`;
      }
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
        const lines = doc.getText().split('\n');
        const start = (offset ?? 1) - 1;
        const end = limit ? start + limit : lines.length;
        return lines.slice(start, end).map((l, i) => `${start + i + 1}|${l}`).join('\n');
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
    writeFile: async (filePath: string, content: string) => {
      await writeWorkspaceFile(filePath, content);
    },
    searchReplace: async (filePath: string, oldStr: string, newStr: string, replaceAll?: boolean) => {
      const abs = path.isAbsolute(filePath) ? filePath : path.join(ws(), filePath);
      if (!fs.existsSync(abs)) return `Error: File not found: ${filePath}`;
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === abs && !d.isClosed
      );
      let content = openDoc ? openDoc.getText() : fs.readFileSync(abs, 'utf8');
      if (replaceAll) content = content.split(oldStr).join(newStr);
      else content = content.replace(oldStr, newStr);
      await writeWorkspaceFile(filePath, content);
      return content;
    },
    glob: async (pattern: string, cwd?: string) => {
      const base = cwd ? path.join(ws(), cwd) : ws();
      const uris = await vscode.workspace.findFiles(
        pattern.startsWith('**') ? pattern : `**/${pattern}`,
        '**/node_modules/**',
        200
      );
      return uris.map((u) => path.relative(base, u.fsPath));
    },
    grep: async (pattern: string, searchPath?: string) => {
      try {
        const target = searchPath ? path.join(ws(), searchPath) : ws();
        const execOpts = isWindows()
          ? { shell: process.env.COMSPEC ?? 'cmd.exe', maxBuffer: 512_000 }
          : { maxBuffer: 512_000 };
        const { stdout } = await execAsync(buildRipgrepShell(pattern, target), execOpts);
        return stdout?.trim() || '(no matches)';
      } catch {
        return '(grep failed — install ripgrep: https://github.com/BurntSushi/ripgrep/releases)';
      }
    },
    listDir: async (dirPath: string) => {
      const abs = path.isAbsolute(dirPath) ? dirPath : path.join(ws(), dirPath || '.');
      if (!fs.existsSync(abs)) return `Error: Directory not found: ${dirPath || '.'}`;
      return fs.readdirSync(abs, { withFileTypes: true })
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join('\n');
    },
    runTerminal: async (command: string, cwd?: string, blockUntilMs?: number) => {
      const { isAutoApproveTerminal, isYoloMode } = await import('./settings');
      const autoApprove = isYoloMode() || isAutoApproveTerminal();
      if (!autoApprove) {
        const ok = await vscode.window.showWarningMessage(
          `Run terminal command?\n${command}`,
          { modal: true },
          'Approve',
          'Reject'
        );
        if (ok !== 'Approve') return 'Rejected by user';
      }
      const term = vscode.window.createTerminal({ cwd: cwd ? path.join(ws(), cwd) : ws() });
      term.show();
      term.sendText(command);
      await new Promise((r) => setTimeout(r, blockUntilMs ?? 3000));
      return `Command sent to terminal: ${command}`;
    },
    readLints: async (paths?: string[]) => {
      const diags = vscode.languages.getDiagnostics();
      const lines: string[] = [];
      for (const [uri, items] of diags) {
        if (paths?.length && !paths.some((p) => uri.fsPath.includes(p))) continue;
        for (const d of items) {
          lines.push(`${path.relative(ws(), uri.fsPath)}:${d.range.start.line + 1} ${d.severity} ${d.message}`);
        }
      }
      return lines.join('\n') || '(no diagnostics)';
    },
    getOpenEditors: async () => {
      return vscode.window.visibleTextEditors
        .map((e) => path.relative(ws(), e.document.uri.fsPath))
        .join('\n');
    },
    getSelection: async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed?.selection) return '';
      return ed.document.getText(ed.selection);
    },
    getTerminalBuffer: async () => getTerminalOutput(),
    getGitContext: async () => {
      try {
        const { stdout: status } = await execAsync('git status -sb', { cwd: ws() });
        const { stdout: diff } = await execAsync('git diff --stat HEAD 2>/dev/null | head -80', { cwd: ws() });
        const { stdout: log } = await execAsync('git log -5 --oneline 2>/dev/null', { cwd: ws() });
        return `## status\n${status}\n## diff\n${diff}\n## log\n${log}`;
      } catch {
        return '(not a git repo)';
      }
    },
  };
}
