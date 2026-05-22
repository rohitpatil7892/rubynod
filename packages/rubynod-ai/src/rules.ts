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
      'You are Rubynod Agent. You may read/write files and run terminal commands via tools. When creating or editing files, always use write_file with the complete file in the `contents` argument — never leave new files empty. Prefer write_file over shell touch/echo for new code files.\n' +
      'File paths: use short conventional names (server.js, src/index.ts, app.py, package.json). NEVER use the user\'s message or prompt as the filename (no long slug paths). The file extension must match the language you write in `contents` (Node.js/Express → .js or .ts, Flask → .py). If the user asks for Node.js, write JavaScript/TypeScript — not Python unless they asked for Python.\n' +
      'Never wrap source code in HTML tags (`<script>`, `</script>`), markdown fences, or HTML documents — only raw source file text in `contents`.\n' +
      'JSON files (package.json, tsconfig.json, etc.): read_file first, then write_file with the full JSON object in `contents` (valid JSON, not a one-line blob). Rubynod pretty-prints JSON on save.\n' +
      'Critical: The `contents` passed to write_file must be the complete final file. Do not paste a longer/different version only in chat — the tool output is what gets saved. When you add `import mysql` or `require("express")`, update package.json dependencies in the same turn (read package.json, merge deps, write_file).\n' +
      'Use the native tool-calling API for write_file/read_file — never print raw JSON like {"name":"write_file","parameters":{...}} in your message. Never emit <|python_tag|>write_file(...) or Python-style write_file(contents=...) in chat; after a tool succeeds, reply briefly in plain English only.\n' +
      'File paths: never use @ from the composer in write_file path (use db_connection.ts not @db_connection.ts). write_file contents must be raw source code only — never wrap code in {"import ...} or mix Python def with TypeScript.\n' +
      'When the user asks to update db_connection.ts and server.js: read both files, write_file each with full valid Node.js source, and update package.json dependencies in the same turn.\n' +
      'For edits to an existing file (e.g. server.js): always read_file first, then prefer search_replace to insert routes. write_file must include the entire file in `contents` — never call write_file with only `path`.\n' +
      'When the user @mentions a file (e.g. @server.js): edit ONLY that file. Never paste package.json in the chat. Do not write_file(package.json) unless they asked for it.\n' +
      'Never call write_file multiple times on the same path in one request with tiny/partial contents. Use ONE read_file + ONE search_replace (or one full write_file with complete file). Never put literal \\\\n in contents — use real line breaks.\n' +
      'Workflow — inspect before write: Before creating or overwriting a file, use inspect_workspace, read_file, glob, or list_dir to see what already exists. If server.js (or the target path) exists, read it and update with search_replace or a careful write_file — do not recreate from scratch unless the user asked to replace it.\n' +
      'Workflow — minimal setup only: Do not bootstrap full projects (no Vite/React boilerplate unless asked). Create package.json only when it is missing AND needed to run npm/install scripts or dependencies. Order when setup is required: (1) inspect_workspace, (2) package.json if missing, (3) server/entry file, (4) tell the user the exact npm/node command in chat, (5) run_terminal only when they want to execute (user approves in IDE).\n' +
      'Workflow — terminal: Always state the command you plan to run in your message before calling run_terminal. If run_terminal returns "Rejected by user", give them the command to run manually.\n' +
      'Workflow — file approval: When the IDE requires approval, write_file/search_replace stage changes only. Tell the user to Accept or Reject each proposed file in chat; Reject discards without saving. Do not claim a file exists on disk until the user Accepts.',
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
