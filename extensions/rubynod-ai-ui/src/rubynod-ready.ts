import { extLog } from './logger';
import { ensureAiServiceStarted } from './ai-service';
import { registerBridge } from './api';

let extensionPath = '';
let bridgePort = 0;
let bridgeReady = false;

export function configureRubynod(extPath: string, port: number): void {
  extensionPath = extPath;
  bridgePort = port;
  bridgeReady = false;
}

export function getRubynodExtensionPath(): string {
  return extensionPath;
}

/** Returns true once the bridge has been successfully registered with the AI service. */
export function isBridgeReady(): boolean {
  return bridgeReady;
}

async function tryRegisterBridge(port: number, attempts = 3, delayMs = 400): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await registerBridge(port);
      extLog.debug('Bridge registered', { port, attempt: i + 1 });
      bridgeReady = true;
      return true;
    } catch (err) {
      extLog.warn(`Bridge register attempt ${i + 1}/${attempts} failed`, err instanceof Error ? err.message : String(err));
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  extLog.error('Bridge registration failed after all attempts');
  return false;
}

/** Start bundled AI agent (if needed) and register the IDE bridge. */
export async function ensureRubynodReady(): Promise<boolean> {
  if (!extensionPath) {
    extLog.warn('ensureRubynodReady: extension path not configured');
    return false;
  }
  extLog.debug('ensureRubynodReady: starting AI service');
  const ok = await ensureAiServiceStarted(extensionPath);
  if (!ok) {
    extLog.error('ensureRubynodReady: AI service failed to start');
    return false;
  }
  if (bridgePort > 0 && !bridgeReady) {
    await tryRegisterBridge(bridgePort);
  }
  return true;
}
