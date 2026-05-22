/** Pull a service/client slug from natural language (order-independent). */
export function extractServiceSlugFromMessage(userMessage: string): string | undefined {
  const msg = userMessage.trim();
  if (!msg) return undefined;

  const apiNamed = msg.match(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+)*-(?:api-client|client-api))\b/i);
  if (apiNamed) return apiNamed[1]!.toLowerCase();

  const beforeShared = msg.match(
    /\b(?:create|add)\s+(?:a\s+)?(?:new\s+)?([a-z][a-z0-9-]+)\s+shared(?:\s+service)?\b/i
  );
  if (beforeShared) return beforeShared[1]!.toLowerCase();

  const explicitFile = msg.match(/\b([a-z][a-z0-9-]*\.service\.(?:ts|js))\b/i);
  if (explicitFile) return explicitFile[1]!.replace(/\.service\.(ts|js)$/i, '').toLowerCase();

  const forSlug = msg.match(
    /\b(?:add|create)\s+(?:a\s+)?(?:new\s+)?(?:shared\s+)?(?:service|client|module)(?:\s+for)?\s+([a-z][a-z0-9-]*)\b/i
  );
  if (forSlug) return forSlug[1]!.toLowerCase();

  return undefined;
}

function serviceFileName(slug: string): string {
  if (/\.service\.(ts|js)$/i.test(slug)) return slug.toLowerCase();
  if (/\.(ts|js)$/i.test(slug)) return slug.toLowerCase();
  return `${slug}.service.ts`;
}

/** Infer a conventional path when the model omits write_file.path for "create service" requests. */
export function inferNewServicePath(userMessage: string): string | undefined {
  const slug = extractServiceSlugFromMessage(userMessage);
  if (!slug) return undefined;

  const file = serviceFileName(slug);
  if (/\bshared\b/i.test(userMessage)) return `shared/${file}`;
  if (/\b(?:libs?|library|nx|monorepo)\b/i.test(userMessage)) return `libs/shared/${file}`;
  return `shared/${file}`;
}

/** Fallback read path when the model omits read_file.path. */
export function inferReadFilePath(userMessage: string): string | undefined {
  const service = inferNewServicePath(userMessage);
  if (service) return service;
  if (/\b(?:add|create|new)\s+(?:a\s+)?(?:shared\s+)?(?:service|client)\b/i.test(userMessage)) {
    return 'package.json';
  }
  return undefined;
}
