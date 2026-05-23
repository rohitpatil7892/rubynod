import * as vscode from 'vscode';
import * as path from 'node:path';
import type { ContextAttachment } from './context';

const SENSITIVE_PATTERNS = [
  /^\.env(\.[a-z]+)?$/i,
  /(?:^|\/)id_(?:rsa|ed25519|ecdsa|dsa)$/,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.crt$/i,
  /secrets?\.(json|yaml|yml)$/i,
  /credentials?\.(json|yaml|yml)$/i,
];

function isSensitive(attachment: ContextAttachment): boolean {
  const name = attachment.path ? path.basename(attachment.path) : attachment.label;
  return SENSITIVE_PATTERNS.some((re) => re.test(name) || (attachment.path ? re.test(attachment.path) : false));
}

/**
 * Filter attachments: sensitive files show a confirmation modal.
 * Returns only the attachments the user approved (or that are not sensitive).
 */
export async function checkSensitiveAttachments(
  attachments: ContextAttachment[]
): Promise<ContextAttachment[]> {
  const safe: ContextAttachment[] = [];
  const sensitive: ContextAttachment[] = [];

  for (const att of attachments) {
    if (isSensitive(att)) {
      sensitive.push(att);
    } else {
      safe.push(att);
    }
  }

  if (sensitive.length === 0) return safe;

  const names = sensitive.map((a) => a.path ?? a.label).join(', ');
  const answer = await vscode.window.showWarningMessage(
    `This file may contain secrets (${names}). Attach it to chat anyway?`,
    { modal: true },
    'Attach',
    'Cancel'
  );

  if (answer === 'Attach') {
    return [...safe, ...sensitive];
  }
  return safe;
}
