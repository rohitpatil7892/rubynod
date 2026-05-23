import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getServiceUrl, getWorkspaceRoot } from './settings';

export type ConfigScope = 'project' | 'global';

export interface RuleListItem {
  id: string;
  title: string;
  path: string;
  scope: ConfigScope;
  preview: string;
}

export interface SkillListItem {
  id: string;
  name: string;
  description: string;
  path: string;
  scope: ConfigScope;
}

export interface McpServerListItem {
  id: string;
  name: string;
  scope: ConfigScope;
  configPath: string;
  command?: string;
  args?: string[];
  url?: string;
  disabled: boolean;
}

function readPreview(filePath: string, max = 120): string {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^---[\s\S]*?---\n/, '');
    return raw.replace(/\s+/g, ' ').trim().slice(0, max);
  } catch {
    return '';
  }
}

function parseSkillMeta(raw: string): { name: string; description: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { name: 'skill', description: '' };
  const front = match[1]!;
  const name = front.match(/name:\s*(.+)/)?.[1]?.trim() ?? 'skill';
  const description =
    front.match(/description:\s*>?-?\s*([\s\S]*?)(?:\n[a-z]|$)/i)?.[1]?.trim().replace(/\s+/g, ' ') ?? '';
  return { name, description };
}

export function listRules(workspaceRoot: string): RuleListItem[] {
  const items: RuleListItem[] = [];
  const addFile = (filePath: string, scope: ConfigScope, title?: string) => {
    if (!fs.existsSync(filePath)) return;
    const base = path.basename(filePath);
    items.push({
      id: filePath,
      title: title ?? base,
      path: filePath,
      scope,
      preview: readPreview(filePath),
    });
  };

  const addDir = (dir: string, scope: ConfigScope) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isFile() && /\.(md|mdc)$/i.test(ent.name)) {
        addFile(path.join(dir, ent.name), scope);
      }
    }
  };

  addDir(path.join(os.homedir(), '.rubynod', 'rules'), 'global');
  addFile(path.join(os.homedir(), '.rubynod', 'rules.md'), 'global', 'rules.md (global)');
  addDir(path.join(workspaceRoot, '.rubynod', 'rules'), 'project');
  addDir(path.join(workspaceRoot, '.cursor', 'rules'), 'project');
  addFile(path.join(workspaceRoot, 'AGENTS.md'), 'project', 'AGENTS.md');
  addFile(path.join(workspaceRoot, '.cursor', 'AGENTS.md'), 'project', '.cursor/AGENTS.md');

  const seen = new Set<string>();
  return items.filter((i) => {
    if (seen.has(i.path)) return false;
    seen.add(i.path);
    return true;
  });
}

export function listSkills(workspaceRoot: string): SkillListItem[] {
  const items: SkillListItem[] = [];
  const dirs: Array<{ dir: string; scope: ConfigScope }> = [
    { dir: path.join(workspaceRoot, '.rubynod', 'skills'), scope: 'project' },
    { dir: path.join(workspaceRoot, '.cursor', 'skills-cursor'), scope: 'project' },
    { dir: path.join(os.homedir(), '.rubynod', 'skills'), scope: 'global' },
  ];

  for (const { dir, scope } of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const skillPath = path.join(dir, ent.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      const raw = fs.readFileSync(skillPath, 'utf8');
      const meta = parseSkillMeta(raw);
      items.push({
        id: skillPath,
        name: meta.name || ent.name,
        description: meta.description,
        path: skillPath,
        scope,
      });
    }
  }

  const seen = new Set<string>();
  return items.filter((i) => {
    if (seen.has(i.name)) return false;
    seen.add(i.name);
    return true;
  });
}

export function listMcpServers(workspaceRoot: string): McpServerListItem[] {
  const paths: Array<{ path: string; scope: ConfigScope }> = [
    { path: path.join(os.homedir(), '.rubynod', 'mcp.json'), scope: 'global' },
    { path: path.join(workspaceRoot, '.rubynod', 'mcp.json'), scope: 'project' },
    { path: path.join(workspaceRoot, 'rubynod.mcp.json'), scope: 'project' },
    { path: path.join(workspaceRoot, '.cursor', 'mcp.json'), scope: 'project' },
  ];

  const items: McpServerListItem[] = [];
  for (const { path: configPath, scope } of paths) {
    if (!fs.existsSync(configPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        mcpServers?: Record<
          string,
          { command?: string; args?: string[]; url?: string; disabled?: boolean }
        >;
      };
      for (const [name, srv] of Object.entries(raw.mcpServers ?? {})) {
        items.push({
          id: `${configPath}::${name}`,
          name,
          scope,
          configPath,
          command: srv.command,
          args: srv.args,
          url: srv.url,
          disabled: !!srv.disabled,
        });
      }
    } catch {
      // skip invalid json
    }
  }
  return items;
}

export async function fetchIndexStatus(): Promise<{
  ready: boolean;
  indexing: boolean;
  stats?: {
    chunkCount: number;
    fileCount: number;
    symbolCount: number;
    lastIndexedAt: string | null;
    indexing: boolean;
    filesDiscovered?: number;
    filesSkippedLarge?: number;
  };
  embeddingProvider?: string;
  embeddingModel?: string;
  needsEmbeddingRebuild?: boolean;
} | null> {
  try {
    const res = await fetch(
      `${getServiceUrl()}/index/status?workspaceRoot=${encodeURIComponent(getWorkspaceRoot())}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    return (await res.json()) as Awaited<ReturnType<typeof fetchIndexStatus>>;
  } catch {
    return null;
  }
}

export function setMcpServerDisabled(
  configPath: string,
  serverName: string,
  disabled: boolean
): void {
  if (!fs.existsSync(configPath)) return;
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
    mcpServers?: Record<string, { disabled?: boolean }>;
  };
  if (!raw.mcpServers?.[serverName]) return;
  raw.mcpServers[serverName]!.disabled = disabled;
  fs.writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
}

export function ensureRuleFile(workspaceRoot: string, scope: ConfigScope, fileName: string): string {
  const dir =
    scope === 'global'
      ? path.join(os.homedir(), '.rubynod', 'rules')
      : path.join(workspaceRoot, '.rubynod', 'rules');
  fs.mkdirSync(dir, { recursive: true });
  const safe = fileName.replace(/[^\w.-]/g, '-').replace(/\.md$/i, '') + '.md';
  const filePath = path.join(dir, safe);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      `# ${safe.replace(/\.md$/i, '')}\n\n- Add agent instructions here.\n`,
      'utf8'
    );
  }
  return filePath;
}

export function ensureSkillDir(workspaceRoot: string, scope: ConfigScope, skillName: string): string {
  const base =
    scope === 'global'
      ? path.join(os.homedir(), '.rubynod', 'skills')
      : path.join(workspaceRoot, '.rubynod', 'skills');
  const safe = skillName.replace(/[^\w.-]/g, '-').toLowerCase() || 'my-skill';
  const dir = path.join(base, safe);
  fs.mkdirSync(dir, { recursive: true });
  const skillPath = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    fs.writeFileSync(
      skillPath,
      `---
name: ${safe}
description: When the agent should use this skill
---

# ${safe}

Add step-by-step instructions for the agent.
`,
      'utf8'
    );
  }
  return skillPath;
}

export function deleteConfigFile(filePath: string): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
