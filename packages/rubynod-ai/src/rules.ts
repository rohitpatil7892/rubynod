import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { formatMemoriesForPrompt } from './memories.js';

export interface LoadedRules {
  systemParts: string[];
  skills: Array<{ name: string; description: string; body: string }>;
}

function readIfExists(p: string): string | null {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  } catch {
    return null;
  }
}

function loadRulesDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const parts: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isFile() && (ent.name.endsWith('.md') || ent.name.endsWith('.mdc'))) {
      const content = readIfExists(path.join(dir, ent.name));
      if (content) parts.push(`### Rule: ${ent.name}\n${content}`);
    }
  }
  return parts;
}

function parseSkillFrontmatter(raw: string): { name: string; description: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { name: 'skill', description: '', body: raw };
  const front = match[1]!;
  const body = match[2]!;
  const name = front.match(/name:\s*(.+)/)?.[1]?.trim() ?? 'skill';
  const description = front.match(/description:\s*>?-?\s*([\s\S]*?)(?:\n[a-z]|$)/i)?.[1]?.trim() ?? '';
  return { name, description, body: body.trim() };
}

function loadSkills(workspaceRoot: string): LoadedRules['skills'] {
  const dirs = [
    path.join(os.homedir(), '.rubynod', 'skills'),
    path.join(workspaceRoot, '.rubynod', 'skills'),
    path.join(workspaceRoot, '.cursor', 'skills-cursor'),
  ];
  const skills: LoadedRules['skills'] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const skillPath = ent.isDirectory()
        ? path.join(dir, ent.name, 'SKILL.md')
        : ent.name === 'SKILL.md'
          ? path.join(dir, 'SKILL.md')
          : null;
      if (!skillPath || !fs.existsSync(skillPath)) continue;
      const raw = fs.readFileSync(skillPath, 'utf8');
      skills.push(parseSkillFrontmatter(raw));
    }
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        const skillPath = path.join(dir, ent.name, 'SKILL.md');
        if (fs.existsSync(skillPath)) {
          const raw = fs.readFileSync(skillPath, 'utf8');
          if (!skills.some((s) => s.name === ent.name)) {
            skills.push(parseSkillFrontmatter(raw));
          }
        }
      }
    }
  }
  return skills;
}

export function loadProjectRules(workspaceRoot: string): LoadedRules {
  const parts: string[] = [];

  const userRules = readIfExists(path.join(os.homedir(), '.rubynod', 'rules.md'));
  if (userRules) parts.push(`## User rules\n${userRules}`);

  parts.push(...loadRulesDir(path.join(os.homedir(), '.rubynod', 'rules')));
  parts.push(...loadRulesDir(path.join(workspaceRoot, '.rubynod', 'rules')));
  parts.push(...loadRulesDir(path.join(workspaceRoot, '.cursor', 'rules')));

  const agentsMd = readIfExists(path.join(workspaceRoot, 'AGENTS.md'));
  if (agentsMd) parts.push(`## AGENTS.md\n${agentsMd}`);

  const cursorAgents = readIfExists(path.join(workspaceRoot, '.cursor', 'AGENTS.md'));
  if (cursorAgents) parts.push(`## .cursor/AGENTS.md\n${cursorAgents}`);

  return { systemParts: parts, skills: loadSkills(workspaceRoot) };
}

export function buildSystemPrompt(workspaceRoot: string, mode: string): string {
  const { systemParts, skills } = loadProjectRules(workspaceRoot);
  const modeInstructions: Record<string, string> = {
    agent:
      'You are Rubynod Agent. Call tools to read/write files and run terminal commands — never explain steps instead of acting.\n' +
      'write_file: always pass the COMPLETE file in `contents`; use short paths (server.js, src/index.ts); never slugify the user message as a filename; never wrap code in HTML or markdown fences.\n' +
      'Edits: read_file first → prefer search_replace → one write_file with the full file if replacing. Never call write_file twice on the same path with partial content.\n' +
      'JSON files: read_file first, merge, write_file with valid JSON. Do not print raw {name:"write_file",...} JSON in chat — use native tool calls only.\n' +
      'Path from @mention: strip the @ prefix (use db_connection.ts not @db_connection.ts).\n' +
      'After writing a file: call read_lints on that path and fix any errors.\n' +
      'Approval: when the IDE requires approval, files are staged (not saved) until the user Accepts. Do not claim a file exists until Accepted.\n' +
      'Detailed workflow rules are in the loaded project rules (agent-workflow.md, npm-install.md, etc.).',
    plan: 'You are in PLAN mode. Explore read-only. Do NOT call write or terminal tools. Output a structured plan.',
    ask: 'You are in ASK mode. Answer questions only. Do NOT call write or terminal tools.',
    debug: 'You are in DEBUG mode. Focus on runtime evidence, logs, and reproduction steps.',
  };

  let prompt = `You are Rubynod AI, a coding assistant in the Rubynod editor.\n`;
  prompt += modeInstructions[mode] ?? modeInstructions.agent;
  prompt += `\nWorkspace: ${workspaceRoot}\n`;

  if (systemParts.length) {
    prompt += `\n# Project rules\n${systemParts.join('\n\n')}`;
  }

  if (skills.length) {
    prompt += `\n# Available skills\n`;
    for (const s of skills) {
      prompt += `- **${s.name}**: ${s.description}\n`;
    }
  }

  const memories = formatMemoriesForPrompt(workspaceRoot);
  if (memories) prompt += memories;

  return prompt;
}

export function getSkillBody(workspaceRoot: string, skillName: string): string | null {
  const { skills } = loadProjectRules(workspaceRoot);
  const skill = skills.find((s) => s.name.toLowerCase() === skillName.toLowerCase());
  return skill?.body ?? null;
}
