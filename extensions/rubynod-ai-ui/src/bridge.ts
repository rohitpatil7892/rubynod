import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getWorkspaceRoot, requiresFileApproval, getTerminalAllowlist } from './settings';
import { buildRipgrepShell, isWindows } from './platform';
import { writeWorkspaceFile } from './file-write';
import { prepareJsonWrite } from './json-write';

/** Commands matching these patterns are blocked in safe mode. */
const BLOCKED_TERMINAL_PATTERNS = [
  /rm\s+(-[rRf]+\s+){0,3}(\/|~|\.\.\/|"\/|'\/)/, // rm -rf /
  /:\s*\(\s*\)\s*\{[^}]*:\s*\|[^}]*\}/, // fork bomb
  /curl\s+[^|]*\|\s*(?:bash|sh|zsh)/, // curl | sh
  /wget\s+[^|]*\|\s*(?:bash|sh|zsh)/, // wget | sh
  />\s*(\/etc\/passwd|\/etc\/shadow|~\/\.(?:bash|zsh|fish)(?:rc|_profile))/, // overwrite system files
  /mkfs|fdisk|dd\s+if=/, // disk operations
  /shutdown|reboot|halt\b/,
  /chmod\s+[0-7]{3,4}\s+\/(?:etc|bin|usr|boot)/, // chmod system dirs
];

function isBlockedTerminalCommand(command: string): string | null {
  for (const re of BLOCKED_TERMINAL_PATTERNS) {
    if (re.test(command)) {
      return `Command blocked by Rubynod terminal safe mode: matches dangerous pattern (${re.source.slice(0, 50)}…). Disable safe mode in settings if you intend this.`;
    }
  }
  return null;
}

/** Resolve and jail a path inside the workspace root; return null if outside. */
function resolveInWorkspace(filePath: string, workspaceRoot: string): string | null {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
  const resolved = path.resolve(abs);
  const wsResolved = path.resolve(workspaceRoot);
  if (!resolved.startsWith(wsResolved + path.sep) && resolved !== wsResolved) {
    return null;
  }
  return resolved;
}

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
      if (typeof filePath !== 'string' || !filePath.trim()) {
        return 'Error: read_file path is required (model sent null or empty path)';
      }
      const jailed = resolveInWorkspace(filePath, ws());
      if (!jailed) {
        return `Error: Path "${filePath}" is outside the workspace root — access denied.`;
      }
      if (!fs.existsSync(jailed)) {
        return `Error: File not found: ${filePath}`;
      }
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(jailed));
        const lines = doc.getText().split('\n');
        const start = (offset ?? 1) - 1;
        const end = limit ? start + limit : lines.length;
        return lines.slice(start, end).map((l, i) => `${start + i + 1}|${l}`).join('\n');
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
    writeFile: async (filePath: string, content: string) => {
      if (typeof filePath !== 'string' || !filePath.trim()) {
        return 'Error: write_file path is required (model sent null or empty path)';
      }
      const jailed = resolveInWorkspace(filePath, ws());
      if (!jailed) {
        return `Error: Path "${filePath}" is outside the workspace root — write denied.`;
      }
      if (requiresFileApproval()) {
        return (
          `Proposed write to ${filePath} (${content.length} chars). ` +
          `Approve or Reject in the Rubynod chat — the file is not saved until you Accept.`
        );
      }
      await writeWorkspaceFile(filePath, content);
      return `Wrote ${filePath} (${content.length} chars)`;
    },
    searchReplace: async (filePath: string, oldStr: string, newStr: string, replaceAll?: boolean) => {
      const jailCheck = resolveInWorkspace(filePath, ws());
      if (!jailCheck) return `Error: Path "${filePath}" is outside the workspace root — write denied.`;
      const abs = path.isAbsolute(filePath) ? filePath : path.join(ws(), filePath);
      if (!fs.existsSync(abs)) return `Error: File not found: ${filePath}`;
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === abs && !d.isClosed
      );
      const original = openDoc ? openDoc.getText() : fs.readFileSync(abs, 'utf8');
      let content = original;
      if (replaceAll) content = content.split(oldStr).join(newStr);
      else content = content.replace(oldStr, newStr);
      content = prepareJsonWrite(filePath, content, original);
      if (requiresFileApproval()) {
        return (
          `Proposed patch for ${filePath}. ` +
          `Approve or Reject in the Rubynod chat — not saved until you Accept.`
        );
      }
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
      const blocked = isBlockedTerminalCommand(command);
      if (blocked) {
        return `Rejected: ${blocked}`;
      }
      const { isAutoApproveTerminal, isYoloMode } = await import('./settings');
      const allowlist = getTerminalAllowlist();
      const firstToken = command.trimStart().split(/\s+/)[0] ?? '';
      const isAllowlisted = allowlist.some((a) => firstToken === a || firstToken.endsWith('/' + a));
      const autoApprove = isYoloMode() || isAutoApproveTerminal() || isAllowlisted;
      if (!autoApprove) {
        const ok = await vscode.window.showWarningMessage(
          `Rubynod wants to run this command:\n\n${command}\n\nApprove to run in the integrated terminal.`,
          { modal: true },
          'Approve',
          'Reject'
        );
        if (ok !== 'Approve') {
          return `Rejected by user. Tell them they can run manually: ${command}`;
        }
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
        const { stdout: stat } = await execAsync('git diff --stat HEAD 2>/dev/null', { cwd: ws() }).catch(() => ({ stdout: '' }));
        const { stdout: log } = await execAsync('git log -5 --oneline 2>/dev/null', { cwd: ws() }).catch(() => ({ stdout: '' }));
        const { stdout: rawDiff } = await execAsync('git diff HEAD -- . 2>/dev/null', { cwd: ws() }).catch(() => ({ stdout: '' }));
        const diffCapped = rawDiff.split('\n').slice(0, 120).join('\n');
        return `## status\n${status.trim()}\n## diff --stat\n${stat.trim()}\n## log\n${log.trim()}${diffCapped ? `\n## diff (capped 120 lines)\n${diffCapped}` : ''}`;
      } catch {
        return '(not a git repo)';
      }
    },
    findDefinition: async (fileUri: string, line: number, character: number) => {
      try {
        const uri = vscode.Uri.file(path.isAbsolute(fileUri) ? fileUri : path.join(ws(), fileUri));
        const pos = new vscode.Position(line, character);
        const locs = await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeDefinitionProvider', uri, pos
        );
        if (!locs?.length) return '[]';
        return JSON.stringify(locs.map((l) => ({
          path: path.relative(ws(), l.uri.fsPath),
          line: l.range.start.line + 1,
        })));
      } catch {
        return '[]';
      }
    },
    findReferences: async (fileUri: string, line: number, character: number) => {
      try {
        const uri = vscode.Uri.file(path.isAbsolute(fileUri) ? fileUri : path.join(ws(), fileUri));
        const pos = new vscode.Position(line, character);
        const locs = await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeReferenceProvider', uri, pos
        );
        if (!locs?.length) return '[]';
        // Dedupe by file
        const seen = new Set<string>();
        const refs: { path: string; line: number }[] = [];
        for (const l of locs) {
          const rel = path.relative(ws(), l.uri.fsPath);
          if (!seen.has(rel)) {
            seen.add(rel);
            refs.push({ path: rel, line: l.range.start.line + 1 });
          }
        }
        return JSON.stringify(refs.slice(0, 40));
      } catch {
        return '[]';
      }
    },
    getDocumentSymbols: async (fileUri: string) => {
      try {
        const uri = vscode.Uri.file(path.isAbsolute(fileUri) ? fileUri : path.join(ws(), fileUri));
        const syms = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          'vscode.executeDocumentSymbolProvider', uri
        );
        if (!syms?.length) return '[]';
        const flat = syms.map((s) => ({ name: s.name, kind: vscode.SymbolKind[s.kind], line: s.range.start.line + 1 }));
        return JSON.stringify(flat);
      } catch {
        return '[]';
      }
    },
  };
}
