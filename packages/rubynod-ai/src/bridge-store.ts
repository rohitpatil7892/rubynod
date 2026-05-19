import type { IdeBridge } from './types.js';

let activeBridge: IdeBridge | undefined;

export function setIdeBridge(bridge: IdeBridge | undefined): void {
  activeBridge = bridge;
}

export function getIdeBridge(): IdeBridge | undefined {
  return activeBridge;
}
