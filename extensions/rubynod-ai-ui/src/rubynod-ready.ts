import { extLog } from './logger';
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
  if (bridgePort > 0) {
    try {
      await registerBridge(bridgePort);
      extLog.debug('Bridge registered', { bridgePort });
    } catch (err) {
      extLog.warn('Bridge register failed, retrying', err instanceof Error ? err.message : String(err));
      await new Promise((r) => setTimeout(r, 300));
      try {
        await registerBridge(bridgePort);
        extLog.debug('Bridge registered on retry', { bridgePort });
      } catch (err2) {
        extLog.warn('Bridge register retry failed', err2 instanceof Error ? err2.message : String(err2));
      }
    }
  }
  return true;
}
