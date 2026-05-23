/**
 * Strip secrets from context content before it is sent to the LLM.
 * This is a best-effort pass — it catches common patterns but is not a full DLP.
 */

type StringReplacement = string;
type FnReplacement = (_match: string, p1: string) => string;
type Replacement = StringReplacement | FnReplacement;

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: Replacement }> = [
  {
    name: 'env-var-value',
    pattern: /^(.*(?:KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|AUTH|CREDENTIAL)[^=\n]*=\s*)([^\n]+)$/gmi,
    replacement: '$1[REDACTED]',
  },
  {
    name: 'bearer-token',
    pattern: /Bearer\s+[A-Za-z0-9\-_]{20,}/g,
    replacement: 'Bearer [REDACTED]',
  },
  {
    name: 'aws-key',
    pattern: /(?:AKIA|AIPA|ASIA|AROA)[A-Z0-9]{16}/g,
    replacement: '[AWS-KEY-REDACTED]',
  },
  {
    name: 'private-key-block',
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
    replacement: '[PRIVATE-KEY-REDACTED]',
  },
  {
    name: 'generic-secret-json',
    pattern: /"(?:password|secret|token|api_key|apikey|auth)"\s*:\s*"([^"]{4,})"/gi,
    replacement: (_match: string, p1: string) => `"<field>":"${p1.slice(0, 2)}[REDACTED]"`,
  },
];

/** Sensitive file paths that should not be sent to the LLM without user confirmation. */
const SENSITIVE_PATH_PATTERNS = [
  /^\.env(\.[a-z]+)?$/i,
  /(?:^|\/)id_(?:rsa|ed25519|ecdsa|dsa)$/,
  /\.pem$/i,
  /\.key$/i,
  /secrets?\.(json|yaml|yml)$/i,
  /credentials?\.(json|yaml|yml)$/i,
];

export function isSensitivePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? normalized;
  return SENSITIVE_PATH_PATTERNS.some((re) => re.test(base) || re.test(normalized));
}

export function redactSecrets(content: string): string {
  let out = content;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    if (typeof replacement === 'string') {
      out = out.replace(pattern, replacement);
    } else {
      out = out.replace(pattern, replacement as (...args: string[]) => string);
    }
  }
  return out;
}
