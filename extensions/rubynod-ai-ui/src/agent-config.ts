import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getWorkspaceRoot } from './settings';

const HOME_RUBYNOD = path.join(os.homedir(), '.rubynod');

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

async function openFile(absPath: string, defaultContent: string, label: string): Promise<void> {
  ensureDir(path.dirname(absPath));
  if (!fs.existsSync(absPath)) {
    fs.writeFileSync(absPath, defaultContent, 'utf8');
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.showInformationMessage(`Opened ${label}: ${absPath}`);
}

async function openFolderInExplorer(absPath: string, seedFile?: { name: string; content: string }): Promise<void> {
  ensureDir(absPath);
  if (seedFile) {
    const seedPath = path.join(absPath, seedFile.name);
    if (!fs.existsSync(seedPath)) {
      fs.writeFileSync(seedPath, seedFile.content, 'utf8');
    }
  }
  await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(absPath));
  if (seedFile) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(absPath, seedFile.name)));
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}

type ConfigPick = vscode.QuickPickItem & { targetPath: string; targetKind: 'folder' | 'file' };

export async function openRulesConfig(): Promise<void> {
  const ws = getWorkspaceRoot();
  const projectRules = path.join(ws, '.rubynod', 'rules');
  const projectAgents = path.join(ws, 'AGENTS.md');
  const globalRules = path.join(HOME_RUBYNOD, 'rules');
  const globalRulesMd = path.join(HOME_RUBYNOD, 'rules.md');

  ensureDir(projectRules);
  ensureDir(globalRules);

  const pick = await vscode.window.showQuickPick<ConfigPick>(
    [
      { label: 'Project rules folder', description: '.rubynod/rules/', targetPath: projectRules, targetKind: 'folder' },
      { label: 'Project AGENTS.md', description: 'Root agent instructions', targetPath: projectAgents, targetKind: 'file' },
      { label: 'Global rules folder', description: '~/.rubynod/rules/', targetPath: globalRules, targetKind: 'folder' },
      { label: 'Global rules.md', description: '~/.rubynod/rules.md', targetPath: globalRulesMd, targetKind: 'file' },
    ],
    { placeHolder: 'Open rules for Rubynod agent' }
  );
  if (!pick) return;

  if (pick.targetKind === 'folder') {
    await openFolderInExplorer(pick.targetPath, {
      name: 'project.md',
      content: '# Project agent rules\n\n- Add instructions for the Rubynod agent in this folder (*.md).\n',
    });
    return;
  }

  await openFile(
    pick.targetPath,
    pick.targetPath.endsWith('AGENTS.md')
      ? '# Agent instructions\n\nDescribe how the agent should work in this repository.\n'
      : '# Global Rubynod rules\n\nApplied to every workspace.\n',
    pick.label
  );
}

export async function openSkillsConfig(): Promise<void> {
  const ws = getWorkspaceRoot();
  const projectSkills = path.join(ws, '.rubynod', 'skills');
  const globalSkills = path.join(HOME_RUBYNOD, 'skills');

  const pick = await vscode.window.showQuickPick<vscode.QuickPickItem & { targetPath: string }>(
    [
      { label: 'Project skills', description: '.rubynod/skills/<name>/SKILL.md', targetPath: projectSkills },
      { label: 'Global skills', description: '~/.rubynod/skills/<name>/SKILL.md', targetPath: globalSkills },
    ],
    { placeHolder: 'Open agent skills' }
  );
  if (!pick) return;

  const exampleDir = path.join(pick.targetPath, 'my-skill');
  ensureDir(exampleDir);
  const skillPath = path.join(exampleDir, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    fs.writeFileSync(
      skillPath,
      `---
name: my-skill
description: Short description so the agent knows when to use this skill
---

# My skill

Add step-by-step instructions for the agent here.
`,
      'utf8'
    );
  }
  await openFolderInExplorer(exampleDir);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(skillPath));
  await vscode.window.showTextDocument(doc, { preview: false });
}

export async function openMcpConfig(): Promise<void> {
  const ws = getWorkspaceRoot();
  const paths = [
    { label: 'Global MCP config', path: path.join(HOME_RUBYNOD, 'mcp.json') },
    { label: 'Project MCP config', path: path.join(ws, '.rubynod', 'mcp.json') },
  ];

  const pick = await vscode.window.showQuickPick<vscode.QuickPickItem & { targetPath: string }>(
    paths.map((p) => ({ label: p.label, description: p.path, targetPath: p.path })),
    { placeHolder: 'Edit MCP servers for the agent' }
  );
  if (!pick) return;

  const example = `{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://USER:PASS@localhost/DB"]
    }
  }
}
`;

  await openFile(pick.targetPath, example, 'MCP config');
  vscode.window.showInformationMessage(
    'MCP: set rubynod.mcp.enabled = true, reload chat, then ask the agent to use MCP tools. See Output → Rubynod for connection errors.'
  );
}

export function openIndexingSettings(_extensionId: string): void {
  void vscode.commands.executeCommand('workbench.action.openSettings', 'rubynod.index');
}

export function openAllRubynodSettings(extensionId: string): void {
  void vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${extensionId}`);
}
