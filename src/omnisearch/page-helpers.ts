import type { ParsedKind } from './types';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function checkAccess(
  openApiPaths: Record<string, unknown>,
  group: string,
  version: string,
  plural: string,
  namespaced: boolean,
): 'None' | 'Read' | 'ReadWrite' {
  let access: 'None' | 'Read' | 'ReadWrite' = 'None';

  const groupEscaped = escapeRegex(group);
  const versionEscaped = escapeRegex(version);
  const pluralEscaped = escapeRegex(plural);

  const patterns: string[] = [];
  // Newer EDA OpenAPI exposes both collection and namespaced forms:
  // /apps/<group>/<version>/<plural>
  // /apps/<group>/<version>/namespaces/<ns>/<plural>
  patterns.push(`^/apps/${groupEscaped}/${versionEscaped}/${pluralEscaped}(/.+)?$`);
  if (namespaced) {
    patterns.push(`^/apps/${groupEscaped}/${versionEscaped}/namespaces/[^/]+/${pluralEscaped}(/.+)?$`);
  }

  const matchers: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      matchers.push(new RegExp(pattern));
    } catch {
      return 'None';
    }
  }

  for (const [path, methods] of Object.entries(openApiPaths)) {
    if (!matchers.some((matcher) => matcher.test(path))) continue;
    if (!methods || typeof methods !== 'object') continue;
    for (const method of Object.keys(methods as Record<string, unknown>)) {
      const normalized = method.toLowerCase();
      if (normalized !== 'get') access = 'ReadWrite';
      else if (access === 'None') access = 'Read';
    }
  }

  return access;
}

export function parseResponseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export function extractObjectArray(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  }
  if (!data || typeof data !== 'object') return [];

  const record = data as Record<string, unknown>;
  for (const key of ['items', 'data', 'resources', 'results']) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    }
  }

  for (const value of Object.values(record)) {
    if (!Array.isArray(value)) continue;
    const array = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    if (array.length > 0) return array;
  }

  return [];
}

export function extractItemName(item: Record<string, unknown>): string {
  const direct = typeof item.name === 'string' ? item.name.trim() : '';
  if (direct) return direct;
  const metadata = item.metadata && typeof item.metadata === 'object'
    ? item.metadata as Record<string, unknown>
    : null;
  const metadataName = typeof metadata?.name === 'string' ? metadata.name.trim() : '';
  if (metadataName) return metadataName;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  return id;
}

export function extractItemNamespace(item: Record<string, unknown>): string {
  const direct = typeof item.namespace === 'string' ? item.namespace.trim() : '';
  if (direct) return direct;
  const metadata = item.metadata && typeof item.metadata === 'object'
    ? item.metadata as Record<string, unknown>
    : null;
  return typeof metadata?.namespace === 'string' ? metadata.namespace.trim() : '';
}

function normalizeIdentifierToken(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function singularizeIdentifier(token: string): string {
  if (token.length <= 1) return token;
  if (token.endsWith('ies') && token.length > 3) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith('sses') && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith('ses') && token.length > 3) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s') && token.length > 1) {
    return token.slice(0, -1);
  }
  return token;
}

function buildKindCandidates(resource: ParsedKind): string[] {
  const candidates = new Set<string>();
  const add = (value: string): void => {
    const normalized = normalizeIdentifierToken(value);
    if (normalized) candidates.add(normalized);
  };

  add(resource.kind);
  add(resource.plural);
  add(singularizeIdentifier(resource.plural));

  return Array.from(candidates);
}

export function buildResourceEqlQueries(resource: ParsedKind, instanceLimit: number): string[] {
  const groupToken = normalizeIdentifierToken(resource.group);
  const versionToken = normalizeIdentifierToken(resource.version);
  if (!groupToken || !versionToken) return [];

  const kinds = buildKindCandidates(resource);
  return kinds.map((kindToken) => `.namespace.resources.cr.${groupToken}.${versionToken}.${kindToken} limit ${instanceLimit}`);
}

function addSearchTerm(out: Set<string>, raw: string): void {
  if (out.size >= 140) return;
  const value = raw.trim().toLowerCase();
  if (!value || value.length > 120) return;
  out.add(value);
  if (out.size >= 140) return;
  const compact = value.replace(/[^a-z0-9]+/g, '');
  if (compact && compact !== value) out.add(compact);
}

function collectSearchTerms(value: unknown, out: Set<string>, depth = 0): void {
  if (out.size >= 140 || value == null || depth > 4) return;

  if (typeof value === 'string') {
    addSearchTerm(out, value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    addSearchTerm(out, String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 40)) {
      collectSearchTerms(entry, out, depth + 1);
      if (out.size >= 140) return;
    }
    return;
  }
  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  let keyCount = 0;
  for (const [key, entry] of Object.entries(record)) {
    keyCount += 1;
    if (keyCount > 80) break;
    if (key) addSearchTerm(out, key);
    collectSearchTerms(entry, out, depth + 1);
    if (out.size >= 140) return;
  }
}

export function extractInstanceSearchText(item: Record<string, unknown>): string {
  const terms = new Set<string>();
  collectSearchTerms(item, terms);
  const result = Array.from(terms).join(' ');
  if (result.length <= 2200) return result;
  return result.slice(0, 2200);
}

export function resourcePriority(resource: ParsedKind): number {
  const key = `${resource.group}/${resource.plural}`.toLowerCase();
  if (key.includes('fabric')) return 0;
  if (key.includes('interface')) return 1;
  if (key.includes('bgp')) return 2;
  if (key.includes('topolog')) return 3;
  if (key.includes('node')) return 4;
  if (!resource.namespaced) return 5;
  return 6;
}
