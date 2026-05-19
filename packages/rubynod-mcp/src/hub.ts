import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpConfig, McpServerConfig } from './config.js';
import { loadMcpConfig } from './config.js';

export interface McpToolDescriptor {
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export class McpHub {
  private clients = new Map<string, Client>();
  private toolIndex = new Map<string, McpToolDescriptor>();

  async connectAll(workspaceRoot?: string): Promise<void> {
    const config = loadMcpConfig(workspaceRoot);
    for (const [name, srv] of Object.entries(config.mcpServers)) {
      if (srv.disabled) continue;
      try {
        await this.connectServer(name, srv);
      } catch (err) {
        console.error(`[mcp] Failed to connect ${name}:`, err);
      }
    }
  }

  private async connectServer(name: string, config: McpServerConfig): Promise<void> {
    if (!config.command) return;

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...process.env, ...config.env } as Record<string, string>,
    });

    const client = new Client({ name: 'rubynod', version: '0.1.0' }, { capabilities: {} });
    await client.connect(transport);
    this.clients.set(name, client);

    const tools = await client.listTools();
    for (const tool of tools.tools) {
      const qualified = `mcp_${name}_${tool.name}`.replace(/[^a-zA-Z0-9_]/g, '_');
      this.toolIndex.set(qualified, {
        serverName: name,
        name: tool.name,
        description: tool.description,
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
      });
    }
  }

  listTools(): McpToolDescriptor[] {
    return [...this.toolIndex.values()];
  }

  getOpenAiTools(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return [...this.toolIndex.entries()].map(([qualified, t]) => ({
      type: 'function' as const,
      function: {
        name: qualified,
        description: t.description ?? `MCP tool ${t.serverName}/${t.name}`,
        parameters: t.inputSchema,
      },
    }));
  }

  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<string> {
    const desc = this.toolIndex.get(qualifiedName);
    if (!desc) throw new Error(`Unknown MCP tool: ${qualifiedName}`);
    const client = this.clients.get(desc.serverName);
    if (!client) throw new Error(`MCP server not connected: ${desc.serverName}`);

    const result = await client.callTool({ name: desc.name, arguments: args });
    const texts = (result.content as Array<{ type: string; text?: string }>)
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    return texts || JSON.stringify(result);
  }

  async shutdown(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
    this.toolIndex.clear();
  }
}

export { loadMcpConfig };
