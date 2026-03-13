import type { EqlAutocompleteItem, EqlResult } from './types';

function toFlatCellValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const preview = value
      .slice(0, 3)
      .map((e) => {
        if (e == null) return 'null';
        if (typeof e === 'string' || typeof e === 'number' || typeof e === 'boolean') return String(e);
        if (Array.isArray(e)) return '[..]';
        return '{..}';
      })
      .join(', ');
    return `[${preview}${value.length > 3 ? ` +${value.length - 3}` : ''}]`;
  }
  return '';
}

export function flattenResultFields(
  value: unknown,
  prefix = '',
  depth = 0,
  out: Map<string, string> = new Map<string, string>(),
): Map<string, string> {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    if (prefix) {
      const cell = toFlatCellValue(value);
      if (cell) out.set(prefix, cell);
    }
    return out;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const cell = toFlatCellValue(entry);
    if (cell) {
      out.set(path, cell);
      continue;
    }
    if (depth < 2 && entry && typeof entry === 'object') {
      flattenResultFields(entry, path, depth + 1, out);
    }
  }
  return out;
}

export function pickTableColumns(rows: Array<Map<string, string>>): string[] {
  const preferred = [
    'kind', 'namespace', 'name', 'apiVersion',
    'metadata.namespace', 'metadata.name',
    'status.severity', 'status.state', 'status.phase', 'status.health',
    'spec.node', 'node',
  ];
  const columns: string[] = [];
  for (const col of preferred) {
    if (columns.includes(col) || !rows.some((r) => Boolean(r.get(col)))) continue;
    columns.push(col);
  }
  const freq = new Map<string, number>();
  for (const row of rows) {
    for (const [k, v] of row.entries()) {
      if (!v || k.startsWith('metadata.annotations') || k.endsWith('managedFields')) continue;
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
  }
  const extra = [...freq.entries()]
    .filter(([k]) => !columns.includes(k))
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].length - b[0].length))
    .map(([k]) => k);
  for (const k of extra) {
    columns.push(k);
    if (columns.length >= 8) break;
  }
  return columns.slice(0, 8);
}

export function processEqlResponse(data: unknown): EqlResult[] {
  if (!data || typeof data !== 'object') return [];
  const resp = data as Record<string, unknown>;
  const items = Array.isArray(resp.data) ? resp.data : Array.isArray(data) ? (data as unknown[]) : [];
  return (items as Array<Record<string, unknown>>).map((item) => {
    const name = (item.name as string) || ((item.metadata as Record<string, unknown>)?.name as string) || '';
    const namespace = (item.namespace as string) || ((item.metadata as Record<string, unknown>)?.namespace as string) || '';
    const kind = (item.kind as string) || '';
    const apiVersion = (item.apiVersion as string) || '';
    const path = [apiVersion, namespace, kind, name].filter(Boolean).join('/');
    return { label: name || JSON.stringify(item).slice(0, 80), path, section: kind || 'Results', fields: item };
  });
}

export function processEqlAutocompleteResponse(data: unknown, query: string): EqlAutocompleteItem[] {
  if (!data || typeof data !== 'object') return [];
  const completions = Array.isArray((data as Record<string, unknown>).completions)
    ? ((data as Record<string, unknown>).completions as Array<Record<string, unknown>>)
    : [];
  const out: EqlAutocompleteItem[] = [];
  const seen = new Set<string>();
  for (const item of completions) {
    if (!item || typeof item !== 'object') continue;
    const token = typeof item.token === 'string' ? item.token : '';
    const completion = typeof item.completion === 'string' ? item.completion : '';
    const value = token || (completion ? `${query}${completion}` : '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    let suffix = completion;
    if (!suffix && query && value.startsWith(query)) suffix = value.slice(query.length);
    out.push({ value, suffix: suffix || value });
  }
  return out;
}
