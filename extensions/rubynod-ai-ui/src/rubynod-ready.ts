import { ensureAiServiceStarted } from './ai-service';
import { registerBridge } from './api';

let extensionPath = '';
let bridgePort = 0;

export function configureRubynod(extPath: string, port: number): void {
  extensionPath = extPath;
  bridgePort = port;
}

export function getRubynodExtensionPath(): string {
  return extensionPath;
}

/** Start bundled AI agent (if needed) and register the IDE bridge. */
export async function ensureRubynodReady(): Promise<boolean> {
  if (!extensionPath) return false;
  const ok = await ensureAiServiceStarted(extensionPath);
  if (!ok) return false;
  if (bridgePort > 0) {
    try {
      await registerBridge(bridgePort);
    } catch {
      // AI may be up but bridge registration races on first connect — retry once
      await new Promise((r) => setTimeout(r, 300));
      try {
        await registerBridge(bridgePort);
      } catch {
        // non-fatal until first agent run
      }
    }
  }
  return true;
}
