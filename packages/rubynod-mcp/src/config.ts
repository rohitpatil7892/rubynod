import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export function loadMcpConfig(workspaceRoot?: string): McpConfig {
  const paths = [
    path.join(os.homedir(), '.rubynod', 'mcp.json'),
    workspaceRoot ? path.join(workspaceRoot, '.rubynod', 'mcp.json') : null,
    workspaceRoot ? path.join(workspaceRoot, 'rubynod.mcp.json') : null,
    workspaceRoot ? path.join(workspaceRoot, '.cursor', 'mcp.json') : null,
  ].filter(Boolean) as string[];

  const merged: McpConfig = { mcpServers: {} };
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as McpConfig;
      Object.assign(merged.mcpServers, raw.mcpServers ?? {});
    } catch {
      // skip invalid
    }
  }
  return merged;
}
