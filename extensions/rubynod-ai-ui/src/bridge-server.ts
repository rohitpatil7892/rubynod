import * as http from 'node:http';
import { createIdeBridge } from './bridge';

let server: http.Server | undefined;
let bridgePort = 0;

export function startBridgeServer(): Promise<number> {
  return new Promise((resolve) => {
    const bridge = createIdeBridge();
    server = http.createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/call') {
        res.writeHead(404);
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const { method, args } = JSON.parse(body) as { method: string; args: unknown[] };
          const fn = bridge[method as keyof typeof bridge];
          if (typeof fn !== 'function') {
            res.writeHead(400).end(JSON.stringify({ error: 'Unknown method' }));
            return;
          }
          const result = await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result }));
        } catch (e) {
          res.writeHead(500).end(JSON.stringify({ error: String(e) }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      bridgePort = typeof addr === 'object' && addr ? addr.port : 3848;
      resolve(bridgePort);
    });
  });
}

export function getBridgePort(): number {
  return bridgePort;
}

export function stopBridgeServer(): void {
  server?.close();
}
