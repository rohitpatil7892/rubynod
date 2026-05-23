import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CodebaseIndexer } from '@rubynod/index';
import { OllamaEmbeddingProvider, HashEmbeddingProvider } from '@rubynod/index';
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
import { saveWorkspaceSummary } from './workspace-summary.js';
import { appendMemory, loadMemories } from './memories.js';
import {
  checkOllamaHealth,
  listOllamaModelsWithCapabilities,
  pickDefaultOllamaModel,
} from './ollama.js';
import { initSqlEngine } from '@rubynod/index';
import { serverLog } from './logger.js';

const PORT = Number(process.env.RUBYNOD_AI_PORT ?? 3847);
const HOST = process.env.RUBYNOD_AI_HOST ?? '127.0.0.1';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const indexers = new Map<string, CodebaseIndexer>();

async function createEmbeddingProvider() {
  const provider = process.env.RUBYNOD_EMBEDDING_PROVIDER ?? 'ollama';
  const model = process.env.RUBYNOD_EMBEDDING_MODEL ?? 'nomic-embed-text';
  const host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
  if (provider === 'ollama') {
    const available = await OllamaEmbeddingProvider.isAvailable(model, host);
    if (available) {
      serverLog.info('Using Ollama embeddings', { model, host });
      return new OllamaEmbeddingProvider(model, host);
    }
    serverLog.warn('Ollama embed model not available; falling back to hash embeddings', { model, host });
  }
  return new HashEmbeddingProvider();
}

function getIndexer(workspaceRoot: string): CodebaseIndexer {
  let idx = indexers.get(workspaceRoot);
  if (!idx) {
    idx = new CodebaseIndexer(workspaceRoot);
    const concurrency = Number(process.env.RUBYNOD_INDEX_CONCURRENCY ?? 8);
    const candidates = Number(process.env.RUBYNOD_SEARCH_CANDIDATES ?? 400);
    idx.setPerformanceOpts({ buildConcurrency: concurrency, searchCandidateLimit: candidates });
    indexers.set(workspaceRoot, idx);
    // Wire embedding provider (async, best-effort)
    createEmbeddingProvider().then((ep) => idx!.setEmbeddingProvider(ep)).catch(() => {});
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
    const models = await listOllamaModelsWithCapabilities(host);
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
  const { workspaceRoot, concurrency, searchCandidateLimit, embeddingProvider, embeddingModel } = req.body as {
    workspaceRoot: string;
    concurrency?: number;
    searchCandidateLimit?: number;
    embeddingProvider?: 'ollama' | 'hash';
    embeddingModel?: string;
  };
  const idx = getIndexer(workspaceRoot);
  if (concurrency || searchCandidateLimit) {
    idx.setPerformanceOpts({
      buildConcurrency: concurrency,
      searchCandidateLimit: searchCandidateLimit,
    });
  }
  // Override embedding provider if specified per-build-request
  if (embeddingProvider) {
    const host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
    const model = embeddingModel ?? 'nomic-embed-text';
    if (embeddingProvider === 'ollama') {
      const available = await OllamaEmbeddingProvider.isAvailable(model, host);
      idx.setEmbeddingProvider(available ? new OllamaEmbeddingProvider(model, host) : new HashEmbeddingProvider());
    } else {
      idx.setEmbeddingProvider(new HashEmbeddingProvider());
    }
  }
  if (idx.needsEmbeddingRebuild()) {
    serverLog.info('Embedding provider changed — forcing full index rebuild', { workspaceRoot });
  }
  const stats = await queueIndexBuild(workspaceRoot, idx, (p) => {
    broadcastWs({ type: 'index_progress', data: p });
  });
  // Generate workspace summary after index build
  try { saveWorkspaceSummary(workspaceRoot); } catch { /* non-critical */ }
  res.json({ ok: true, stats });
});

app.get('/index/status', (req, res) => {
  const workspaceRoot = (req.query.workspaceRoot as string) ?? process.cwd();
  const idx = getIndexer(workspaceRoot);
  const embeddingProvider = process.env.RUBYNOD_EMBEDDING_PROVIDER ?? 'ollama';
  const embeddingModel = process.env.RUBYNOD_EMBEDDING_MODEL ?? 'nomic-embed-text';
  res.json({
    stats: idx.getStatus(),
    ready: idx.isReady(),
    embeddingProvider,
    embeddingModel,
    needsEmbeddingRebuild: idx.needsEmbeddingRebuild(),
  });
});

app.post('/index/search', async (req, res) => {
  const { workspaceRoot, query, limit } = req.body as {
    workspaceRoot: string;
    query: string;
    limit?: number;
  };
  const idx = getIndexer(workspaceRoot);
  const results = await idx.searchAsync(query, limit);
  res.json({ results });
});

/** Debug endpoint: test retrieval quality for a query and return top chunks. */
app.post('/index/test-retrieval', async (req, res) => {
  const { workspaceRoot, query } = req.body as { workspaceRoot: string; query: string };
  const idx = getIndexer(workspaceRoot);
  if (!idx.isReady()) {
    res.status(503).json({ error: 'Index not ready — build the index first.' });
    return;
  }
  const results = await idx.searchAsync(query, 5);
  res.json({
    query,
    count: results.length,
    results: results.map((r) => ({
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      score: r.score,
      matchType: r.matchType,
      preview: r.content.slice(0, 300),
    })),
  });
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
  serverLog.info('POST /agent/run', {
    mode: body.mode,
    model: body.model,
    provider: body.provider,
    workspaceRoot: body.workspaceRoot,
    messagePreview: String(body.message ?? '').slice(0, 80),
  });
  if (body.bridgeUrl) {
    setBridgeUrl(body.bridgeUrl);
    setIdeBridge(createHttpIdeBridge());
    serverLog.debug('IDE bridge URL set', { bridgeUrl: body.bridgeUrl });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const event of runAgent(body, getIdeBridge())) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'done' || event.type === 'error') break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    serverLog.error('Agent run stream error', message);
    res.write(`data: ${JSON.stringify({ type: 'error', data: { message } })}\n\n`);
  }
  serverLog.debug('POST /agent/run stream ended');
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
  try {
    const suggestion = await tabComplete(prefix, suffix, { model, apiKey });
    res.json({ suggestion });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ suggestion: '', error: message });
  }
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

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

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

process.on('uncaughtException', (err) => {
  console.error('[rubynod-ai] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[rubynod-ai] unhandledRejection:', reason);
});

export async function startRubynodServer(opts?: {
  port?: number;
  host?: string;
}): Promise<http.Server> {
  await initSqlEngine();

  const port = opts?.port ?? PORT;
  const host = opts?.host ?? HOST;
  if (httpServer.listening) {
    return httpServer;
  }
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      console.log(`Rubynod AI service listening on http://${host}:${port}`);
      resolve(httpServer);
    });
  });
}

export function stopRubynodServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!httpServer.listening) {
      resolve();
      return;
    }
    for (const ws of wsClients) {
      ws.close();
    }
    wsClients.clear();
    wss.close();
    httpServer.close(() => resolve());
  });
}

function isDirectCliRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectCliRun()) {
  void startRubynodServer().catch((err) => {
    console.error('[rubynod-ai] failed to start:', err);
    process.exit(1);
  });
}

export { app, httpServer as server, PORT, HOST };
