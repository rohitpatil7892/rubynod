import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import { CodebaseIndexer } from '@rubynod/index';
import { McpHub } from '@rubynod/mcp';
import {
  runAgent,
  cancelThread,
  getThread,
  inlineEdit,
  tabComplete,
  saveCheckpoint,
  getCheckpoints,
} from './agent.js';
import { setIdeBridge, getIdeBridge } from './bridge-store.js';
import { setBridgeUrl, createHttpIdeBridge } from './bridge-http.js';
import type { AgentRequest, IdeBridge } from './types.js';
import { createCloudJob, getCloudJob, listCloudJobs, runCloudJob } from './cloud.js';
import { buildSystemPrompt, getSkillBody } from './rules.js';
import { queueIndexBuild } from './index-queue.js';
import { getCachedContextPack, setCachedContextPack } from './context-cache.js';
import { appendMemory, loadMemories } from './memories.js';
import { checkOllamaHealth, listOllamaModels, pickDefaultOllamaModel } from './ollama.js';

const PORT = Number(process.env.RUBYNOD_AI_PORT ?? 3847);
const HOST = process.env.RUBYNOD_AI_HOST ?? '127.0.0.1';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const indexers = new Map<string, CodebaseIndexer>();

function getIndexer(workspaceRoot: string): CodebaseIndexer {
  let idx = indexers.get(workspaceRoot);
  if (!idx) {
    idx = new CodebaseIndexer(workspaceRoot);
    const concurrency = Number(process.env.RUBYNOD_INDEX_CONCURRENCY ?? 8);
    const candidates = Number(process.env.RUBYNOD_SEARCH_CANDIDATES ?? 400);
    idx.setPerformanceOpts({ buildConcurrency: concurrency, searchCandidateLimit: candidates });
    indexers.set(workspaceRoot, idx);
    if (process.env.RUBYNOD_INDEX_ON_START === '1') {
      queueIndexBuild(workspaceRoot, idx).catch(console.error);
    }
  }
  return idx;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'rubynod-ai', version: '0.1.0' });
});

app.get('/ollama/health', async (req, res) => {
  const host = (req.query.host as string) || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const ok = await checkOllamaHealth(host);
  res.json({ ok, host });
});

app.get('/ollama/models', async (req, res) => {
  const host = (req.query.host as string) || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  try {
    const models = await listOllamaModels(host);
    const suggested = pickDefaultOllamaModel(models);
    res.json({ ok: true, host, models, suggested });
  } catch (e) {
    res.status(503).json({
      ok: false,
      host,
      error: e instanceof Error ? e.message : String(e),
      models: [],
    });
  }
});

app.post('/bridge/register', (req, res) => {
  const body = req.body as IdeBridge | { bridgeUrl?: string };
  if (body && typeof body === 'object' && 'bridgeUrl' in body && body.bridgeUrl) {
    setBridgeUrl(body.bridgeUrl);
    setIdeBridge(createHttpIdeBridge());
  } else {
    setIdeBridge(body as IdeBridge);
  }
  res.json({ ok: true });
});

app.post('/bridge/call', async (req, res) => {
  const { method, args } = req.body as { method: keyof IdeBridge; args: unknown[] };
  const bridge = getIdeBridge();
  if (!bridge || typeof bridge[method] !== 'function') {
    res.status(503).json({ error: 'IDE bridge not connected' });
    return;
  }
  try {
    const fn = bridge[method] as (...a: unknown[]) => Promise<unknown>;
    const result = await fn(...(args as []));
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/index/build', async (req, res) => {
  const { workspaceRoot, concurrency, searchCandidateLimit } = req.body as {
    workspaceRoot: string;
    concurrency?: number;
    searchCandidateLimit?: number;
  };
  const idx = getIndexer(workspaceRoot);
  if (concurrency || searchCandidateLimit) {
    idx.setPerformanceOpts({
      buildConcurrency: concurrency,
      searchCandidateLimit: searchCandidateLimit,
    });
  }
  const stats = await queueIndexBuild(workspaceRoot, idx, (p) => {
    broadcastWs({ type: 'index_progress', data: p });
  });
  res.json({ ok: true, stats });
});

app.get('/index/status', (req, res) => {
  const workspaceRoot = (req.query.workspaceRoot as string) ?? process.cwd();
  const idx = getIndexer(workspaceRoot);
  res.json({ stats: idx.getStatus(), ready: idx.isReady() });
});

app.post('/index/search', (req, res) => {
  const { workspaceRoot, query, limit } = req.body as {
    workspaceRoot: string;
    query: string;
    limit?: number;
  };
  const idx = getIndexer(workspaceRoot);
  res.json({ results: idx.search(query, limit) });
});

app.post('/index/context', (req, res) => {
  const { workspaceRoot, query, limit, maxChars, cacheTtlSec } = req.body as {
    workspaceRoot: string;
    query: string;
    limit?: number;
    maxChars?: number;
    cacheTtlSec?: number;
  };
  const idx = getIndexer(workspaceRoot);
  const ttl = cacheTtlSec ?? Number(process.env.RUBYNOD_CONTEXT_CACHE_TTL ?? 45);
  const cached = getCachedContextPack(workspaceRoot, query, ttl);
  if (cached) {
    res.json(cached);
    return;
  }
  const pack = idx.getContextPack(query, { limit, maxChars });
  setCachedContextPack(workspaceRoot, query, pack, ttl);
  res.json(pack);
});

app.get('/memories', (req, res) => {
  const workspaceRoot = (req.query.workspaceRoot as string) ?? process.cwd();
  res.json({ memories: loadMemories(workspaceRoot) });
});

app.post('/memories', (req, res) => {
  const { workspaceRoot, text } = req.body as { workspaceRoot: string; text: string };
  const entry = appendMemory(workspaceRoot, text);
  res.json({ ok: true, entry });
});

app.post('/index/update-file', (req, res) => {
  const { workspaceRoot, path: filePath, symbols } = req.body as {
    workspaceRoot: string;
    path: string;
    symbols?: import('@rubynod/index').IndexSymbol[];
  };
  const idx = getIndexer(workspaceRoot);
  idx.updateFile(filePath, symbols);
  res.json({ ok: true, stats: idx.getStatus() });
});

app.post('/index/symbols', (req, res) => {
  const { workspaceRoot, symbols } = req.body as {
    workspaceRoot: string;
    symbols: import('@rubynod/index').IndexSymbol[];
  };
  const idx = getIndexer(workspaceRoot);
  idx.ingestSymbols(symbols);
  res.json({ ok: true, stats: idx.getStatus() });
});

app.get('/mcp/tools', async (req, res) => {
  const workspaceRoot = req.query.workspaceRoot as string | undefined;
  const hub = new McpHub();
  await hub.connectAll(workspaceRoot);
  res.json({ tools: hub.listTools() });
  await hub.shutdown();
});

app.get('/rules', (req, res) => {
  const workspaceRoot = (req.query.workspaceRoot as string) ?? process.cwd();
  res.json({ system: buildSystemPrompt(workspaceRoot, 'agent') });
});

app.get('/skills/:name', (req, res) => {
  const workspaceRoot = (req.query.workspaceRoot as string) ?? process.cwd();
  const body = getSkillBody(workspaceRoot, req.params.name!);
  if (!body) res.status(404).json({ error: 'Skill not found' });
  else res.json({ body });
});

app.post('/agent/run', async (req, res) => {
  const body = req.body as AgentRequest & { bridgeUrl?: string };
  if (body.bridgeUrl) {
    setBridgeUrl(body.bridgeUrl);
    setIdeBridge(createHttpIdeBridge());
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  for await (const event of runAgent(body, getIdeBridge())) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'done' || event.type === 'error') break;
  }
  res.end();
});

app.post('/agent/cancel', (req, res) => {
  const { threadId } = req.body as { threadId: string };
  cancelThread(threadId);
  res.json({ ok: true });
});

app.get('/agent/thread/:id', (req, res) => {
  const t = getThread(req.params.id!);
  if (!t) res.status(404).json({ error: 'Not found' });
  else res.json(t);
});

app.post('/inline-edit', async (req, res) => {
  const { workspaceRoot, filePath, selection, instruction, model, apiKey } = req.body as {
    workspaceRoot: string;
    filePath: string;
    selection: string;
    instruction: string;
    model?: string;
    apiKey?: string;
  };
  const result = await inlineEdit(workspaceRoot, filePath, selection, instruction, getIdeBridge(), {
    model,
    apiKey,
  });
  res.json(result);
});

app.post('/tab-complete', async (req, res) => {
  const { prefix, suffix, model, apiKey } = req.body as {
    prefix: string;
    suffix: string;
    model?: string;
    apiKey?: string;
  };
  const suggestion = await tabComplete(prefix, suffix, { model, apiKey });
  res.json({ suggestion });
});

app.post('/composer/checkpoint', (req, res) => {
  const { threadId, label, files } = req.body as {
    threadId: string;
    label: string;
    files: Record<string, string>;
  };
  saveCheckpoint(threadId, label, files);
  res.json({ ok: true });
});

app.get('/composer/checkpoints/:threadId', (req, res) => {
  res.json({ checkpoints: getCheckpoints(req.params.threadId!) });
});

app.post('/cloud/jobs', (req, res) => {
  const { prompt, workspaceRoot } = req.body as { prompt: string; workspaceRoot: string };
  const job = createCloudJob(prompt, workspaceRoot);
  res.json(job);
});

app.get('/cloud/jobs', (_req, res) => {
  res.json({ jobs: listCloudJobs() });
});

app.get('/cloud/jobs/:id', (req, res) => {
  const job = getCloudJob(req.params.id!);
  if (!job) res.status(404).json({ error: 'Not found' });
  else res.json(job);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const wsClients = new Set<import('ws').WebSocket>();

function broadcastWs(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type: string; payload: AgentRequest };
      if (msg.type === 'agent_run') {
        for await (const event of runAgent(msg.payload, getIdeBridge(), (e) => {
          ws.send(JSON.stringify(event));
        })) {
          ws.send(JSON.stringify(event));
        }
      }
      if (msg.type === 'cancel') {
        cancelThread((msg.payload as { threadId: string }).threadId);
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', data: { message: String(e) } }));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Rubynod AI service listening on http://${HOST}:${PORT}`);
});

export { app, server, PORT };
