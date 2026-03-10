import type { EqlAutocompleteItem, EqlResult, NavItem } from './types';
import type { ThemeMode } from '../core/theme-mode';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function highlightMatch(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const lower = text.toLowerCase();
  const index = lower.indexOf(query);
  if (index === -1) return escapeHtml(text);
  const before = text.slice(0, index);
  const match = text.slice(index, index + query.length);
  const after = text.slice(index + query.length);
  return `${escapeHtml(before)}<span class="eda-omnisearch-highlight">${escapeHtml(match)}</span>${escapeHtml(after)}`;
}

function toFlatCellValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const preview = value
      .slice(0, 3)
      .map((entry) => {
        if (entry == null) return 'null';
        if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') return String(entry);
        if (Array.isArray(entry)) return '[..]';
        return '{..}';
      })
      .join(', ');
    const suffix = value.length > 3 ? ` +${value.length - 3}` : '';
    return `[${preview}${suffix}]`;
  }
  return '';
}

function flattenResultFields(
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

  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    if (!key) continue;
    const path = prefix ? `${prefix}.${key}` : key;

    const primitiveCell = toFlatCellValue(entry);
    if (primitiveCell) {
      out.set(path, primitiveCell);
      continue;
    }

    if (depth < 2 && entry && typeof entry === 'object') {
      flattenResultFields(entry, path, depth + 1, out);
    }
  }

  return out;
}

function pickTableColumns(rows: Array<Map<string, string>>): string[] {
  const preferred = [
    'kind',
    'namespace',
    'name',
    'apiVersion',
    'metadata.namespace',
    'metadata.name',
    'status.severity',
    'status.state',
    'status.phase',
    'status.health',
    'spec.node',
    'node',
  ];

  const columns: string[] = [];
  const hasColumn = (column: string) => rows.some((row) => Boolean(row.get(column)));

  for (const column of preferred) {
    if (!hasColumn(column) || columns.includes(column)) continue;
    columns.push(column);
  }

  const frequency = new Map<string, number>();
  for (const row of rows) {
    for (const [key, value] of row.entries()) {
      if (!value) continue;
      if (key.startsWith('metadata.annotations')) continue;
      if (key.endsWith('managedFields')) continue;
      frequency.set(key, (frequency.get(key) ?? 0) + 1);
    }
  }

  const extra = Array.from(frequency.entries())
    .filter(([key]) => !columns.includes(key))
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].length - b[0].length;
    })
    .map(([key]) => key);

  for (const key of extra) {
    columns.push(key);
    if (columns.length >= 8) break;
  }

  return columns.slice(0, 8);
}

export function createOmnisearchOverlay(
  omnisearchId: string,
  mode: ThemeMode = 'dark',
): HTMLDivElement {
  const existing = document.getElementById(omnisearchId);
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = omnisearchId;
  overlay.dataset.theme = mode;
  overlay.innerHTML = `
    <div class="eda-omnisearch-backdrop"></div>
    <div class="eda-omnisearch-panel">
      <div class="eda-omnisearch-input-row">
        <svg class="eda-omnisearch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input class="eda-omnisearch-input" type="text" placeholder="Search EDA... (type . for EQL)" autocomplete="off" spellcheck="false" />
        <kbd class="eda-omnisearch-kbd">esc</kbd>
      </div>
      <div class="eda-omnisearch-completions" data-open="false"></div>
      <div class="eda-omnisearch-results"></div>
      <div class="eda-omnisearch-footer">
        <span class="eda-omnisearch-footer-hint"><kbd class="eda-omnisearch-footer-key">&uarr;&darr;</kbd> navigate</span>
        <span class="eda-omnisearch-footer-hint"><kbd class="eda-omnisearch-footer-key">&crarr;</kbd> open</span>
        <span class="eda-omnisearch-footer-hint"><kbd class="eda-omnisearch-footer-key">.</kbd> EQL</span>
        <span class="eda-omnisearch-footer-hint"><kbd class="eda-omnisearch-footer-key">tab</kbd> complete</span>
        <span class="eda-omnisearch-footer-count"></span>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #${omnisearchId} {
      --eda-omnisearch-backdrop-bg: rgba(0, 0, 0, 0.5);
      --eda-omnisearch-panel-bg: #1a222e;
      --eda-omnisearch-border: #4a536180;
      --eda-omnisearch-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
      --eda-omnisearch-text-primary: #ffffff;
      --eda-omnisearch-text-secondary: #c9ced6;
      --eda-omnisearch-text-strong: #dde5f2;
      --eda-omnisearch-text-muted: #c9ced680;
      --eda-omnisearch-text-subtle: #c9ced650;
      --eda-omnisearch-accent-weak: #6098ff22;
      --eda-omnisearch-accent-strong: #6098ff33;
      --eda-omnisearch-highlight: #6098ff;
      --eda-omnisearch-completion-bg: #111824;
      --eda-omnisearch-completion-border: #4a5361;
      --eda-omnisearch-table-bg: #111824;
      --eda-omnisearch-table-head-bg: #1d2633;
      --eda-omnisearch-table-divider: #4a536140;
      --eda-omnisearch-kbd-border: #4a536180;
      --eda-omnisearch-footer-kbd-border: #4a536140;
      color-scheme: dark;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 14vh 20px 12vh 20px;
    }
    #${omnisearchId}[data-theme="light"] {
      --eda-omnisearch-backdrop-bg: rgba(15, 23, 42, 0.28);
      --eda-omnisearch-panel-bg: #ffffff;
      --eda-omnisearch-border: #d6dce8;
      --eda-omnisearch-shadow: 0 16px 48px rgba(15, 23, 42, 0.18);
      --eda-omnisearch-text-primary: #152033;
      --eda-omnisearch-text-secondary: #42526a;
      --eda-omnisearch-text-strong: #1f2f45;
      --eda-omnisearch-text-muted: #42526a99;
      --eda-omnisearch-text-subtle: #42526a80;
      --eda-omnisearch-accent-weak: #2f72ff14;
      --eda-omnisearch-accent-strong: #2f72ff24;
      --eda-omnisearch-highlight: #2f72ff;
      --eda-omnisearch-completion-bg: #ffffff;
      --eda-omnisearch-completion-border: #d6dce8;
      --eda-omnisearch-table-bg: #f7f9fc;
      --eda-omnisearch-table-head-bg: #eef2f8;
      --eda-omnisearch-table-divider: #d6dce8;
      --eda-omnisearch-kbd-border: #d6dce8;
      --eda-omnisearch-footer-kbd-border: #d6dce8;
      color-scheme: light;
    }
    .eda-omnisearch-backdrop {
      position: fixed;
      inset: 0;
      background: var(--eda-omnisearch-backdrop-bg);
    }
    .eda-omnisearch-panel {
      position: relative; width: 560px; max-width: 90vw; max-height: 60vh;
      background: var(--eda-omnisearch-panel-bg);
      border: 1px solid var(--eda-omnisearch-border);
      border-radius: 12px;
      box-shadow: var(--eda-omnisearch-shadow);
      display: flex;
      flex-direction: column;
      overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: var(--eda-omnisearch-text-primary);
    }
    .eda-omnisearch-input-row {
      display: flex; align-items: center; gap: 8px; padding: 12px 16px;
      border-bottom: 1px solid var(--eda-omnisearch-border);
    }
    .eda-omnisearch-icon {
      width: 18px;
      height: 18px;
      color: var(--eda-omnisearch-text-secondary);
      flex-shrink: 0;
    }
    .eda-omnisearch-input {
      flex: 1; background: none; border: none; outline: none;
      font-size: 15px;
      color: var(--eda-omnisearch-text-primary);
      font-family: inherit;
    }
    .eda-omnisearch-input::placeholder { color: var(--eda-omnisearch-text-muted); }
    .eda-omnisearch-kbd {
      font-size: 10px;
      color: var(--eda-omnisearch-text-secondary);
      border: 1px solid var(--eda-omnisearch-kbd-border);
      border-radius: 4px; padding: 2px 6px; white-space: nowrap; font-family: inherit;
    }
    .eda-omnisearch-completions {
      display: none;
      margin: -4px 16px 8px 42px;
      border: 1px solid var(--eda-omnisearch-completion-border);
      border-radius: 8px;
      background: var(--eda-omnisearch-completion-bg);
      box-shadow: 0 10px 28px rgba(0,0,0,0.45);
      overflow-y: auto;
      max-height: 200px;
    }
    .eda-omnisearch-completions[data-open="true"] { display: block; }
    .eda-omnisearch-completion-item {
      display: block;
      width: 100%;
      padding: 7px 10px;
      border: none;
      background: none;
      color: var(--eda-omnisearch-text-strong);
      text-align: left;
      cursor: pointer;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      line-height: 1.4;
    }
    .eda-omnisearch-completion-item:hover,
    .eda-omnisearch-completion-item[data-selected="true"] { background: var(--eda-omnisearch-accent-strong); }
    .eda-omnisearch-completions-empty {
      padding: 8px 10px;
      font-size: 11px;
      color: var(--eda-omnisearch-text-muted);
    }
    .eda-omnisearch-results { overflow-y: auto; flex: 1; max-height: calc(60vh - 90px); }
    .eda-omnisearch-section {
      padding: 6px 16px 2px;
      font-size: 11px;
      color: var(--eda-omnisearch-text-subtle);
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500;
    }
    .eda-omnisearch-item {
      display: flex; align-items: center; gap: 10px; padding: 8px 16px;
      cursor: pointer;
      text-decoration: none;
      color: var(--eda-omnisearch-text-primary);
      border: none;
      background: none; width: 100%; text-align: left; font-family: inherit; font-size: 14px;
    }
    .eda-omnisearch-item:hover, .eda-omnisearch-item[data-selected="true"] {
      background: var(--eda-omnisearch-accent-weak);
    }
    .eda-omnisearch-item[data-selected="true"] { background: var(--eda-omnisearch-accent-strong); }
    .eda-omnisearch-item-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .eda-omnisearch-item-path {
      font-size: 12px;
      color: var(--eda-omnisearch-text-subtle);
      overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; max-width: 200px;
    }
    .eda-omnisearch-item--autocomplete .eda-omnisearch-item-label {
      overflow: visible;
      text-overflow: clip;
      white-space: normal;
      word-break: break-all;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    .eda-omnisearch-item--autocomplete .eda-omnisearch-item-path { display: none; }
    .eda-omnisearch-eql-table-wrap {
      margin: 4px 12px 12px;
      border: 1px solid var(--eda-omnisearch-border);
      border-radius: 8px;
      overflow: auto;
      max-height: 280px;
      background: var(--eda-omnisearch-table-bg);
    }
    .eda-omnisearch-eql-table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .eda-omnisearch-eql-table th,
    .eda-omnisearch-eql-table td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--eda-omnisearch-table-divider);
      text-align: left;
      white-space: nowrap;
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: top;
    }
    .eda-omnisearch-eql-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--eda-omnisearch-table-head-bg);
      color: var(--eda-omnisearch-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.3px;
      font-size: 10px;
      font-weight: 600;
    }
    .eda-omnisearch-eql-table td { color: var(--eda-omnisearch-text-strong); }
    .eda-omnisearch-eql-row { cursor: pointer; }
    .eda-omnisearch-eql-row:hover { background: var(--eda-omnisearch-accent-weak); }
    .eda-omnisearch-eql-cell-resource {
      max-width: 360px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    .eda-omnisearch-eql-note {
      padding: 6px 12px 10px;
      color: var(--eda-omnisearch-text-muted);
      font-size: 11px;
    }
    .eda-omnisearch-empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--eda-omnisearch-text-muted);
      font-size: 13px;
    }
    .eda-omnisearch-footer {
      display: flex;
      gap: 16px;
      padding: 6px 16px;
      border-top: 1px solid var(--eda-omnisearch-border);
      font-size: 11px;
      color: var(--eda-omnisearch-text-subtle);
    }
    .eda-omnisearch-footer-hint { display: flex; align-items: center; gap: 4px; }
    .eda-omnisearch-footer-key {
      font-size: 10px;
      color: var(--eda-omnisearch-text-secondary);
      border: 1px solid var(--eda-omnisearch-footer-kbd-border);
      border-radius: 3px; padding: 0 4px; font-family: inherit; line-height: 1.6;
    }
    .eda-omnisearch-footer-count { margin-left: auto; }
    .eda-omnisearch-highlight { color: var(--eda-omnisearch-highlight); font-weight: 600; }
  `;
  overlay.prepend(style);
  return overlay;
}

export function renderNavResults(
  container: HTMLElement,
  items: NavItem[],
  query: string,
  selectedIndex: number,
  countEl?: HTMLElement,
  emptyMessage = 'No matching pages',
): number {
  const clampedIndex = Math.max(0, Math.min(selectedIndex, items.length - 1));

  if (countEl) {
    countEl.textContent = `${items.length} result${items.length !== 1 ? 's' : ''}`;
  }

  if (items.length === 0) {
    container.innerHTML = `<div class="eda-omnisearch-empty">${escapeHtml(emptyMessage)}</div>`;
    return clampedIndex;
  }

  let html = '';
  let currentSection = '';

  items.forEach((item, index) => {
    if (item.section !== currentSection) {
      currentSection = item.section;
      html += `<div class="eda-omnisearch-section">${escapeHtml(currentSection)}</div>`;
    }
    html += `
      <button class="eda-omnisearch-item" data-index="${index}" data-selected="${index === clampedIndex}" data-href="${escapeAttr(item.href)}">
        <span class="eda-omnisearch-item-label">${highlightMatch(item.label, query)}</span>
        <span class="eda-omnisearch-item-path">${escapeHtml(item.href)}</span>
      </button>`;
  });

  container.innerHTML = html;
  return clampedIndex;
}

interface EqlRenderState {
  eqlAutocompleteLoading: boolean;
  eqlAutocompleteError: string;
}

interface EqlResultsRenderState {
  eqlLoading: boolean;
  eqlError: string;
}

export function renderEqlAutocompleteView(
  container: HTMLElement,
  autocompleteItems: EqlAutocompleteItem[],
  query: string,
  selectedIndex: number,
  state: EqlRenderState,
): number {
  if (query.length <= 1) {
    container.dataset.open = 'false';
    container.innerHTML = '';
    return 0;
  }

  const clampedIndex = Math.max(0, Math.min(selectedIndex, autocompleteItems.length - 1));

  if (state.eqlAutocompleteLoading && !autocompleteItems.length) {
    container.dataset.open = 'true';
    container.innerHTML = '<div class="eda-omnisearch-completions-empty">Loading suggestions...</div>';
    return 0;
  }

  if (state.eqlAutocompleteError) {
    container.dataset.open = 'true';
    container.innerHTML = `<div class="eda-omnisearch-completions-empty">${escapeHtml(state.eqlAutocompleteError)}</div>`;
    return 0;
  }

  if (!autocompleteItems.length) {
    container.dataset.open = 'false';
    container.innerHTML = '';
    return 0;
  }

  container.dataset.open = 'true';
  let html = '';
  autocompleteItems.forEach((item, index) => {
    html += `
      <button class="eda-omnisearch-completion-item" data-selected="${index === clampedIndex}" data-eql-autocomplete-index="${index}">
        ${escapeHtml(item.value)}
      </button>`;
  });
  container.innerHTML = html;
  return clampedIndex;
}

export function renderEqlResultsView(
  container: HTMLElement,
  eqlItems: EqlResult[],
  query: string,
  state: EqlResultsRenderState,
  autocompleteCount: number,
  countEl?: HTMLElement,
): void {
  if (countEl) {
    const resultText = `${eqlItems.length} result${eqlItems.length !== 1 ? 's' : ''}`;
    const autocompleteText = `${autocompleteCount} suggestion${autocompleteCount !== 1 ? 's' : ''}`;
    countEl.textContent = `${resultText} | ${autocompleteText}`;
  }

  if (query.length <= 1) {
    container.innerHTML = '<div class="eda-omnisearch-empty">Start typing an EQL query after the dot</div>';
    return;
  }

  let html = '<div class="eda-omnisearch-section">EQL Results</div>';

  if (state.eqlLoading && !eqlItems.length) {
    html += '<div class="eda-omnisearch-empty">Running EQL query...</div>';
    container.innerHTML = html;
    return;
  }

  if (state.eqlError) {
    html += `<div class="eda-omnisearch-empty">${escapeHtml(state.eqlError)}</div>`;
    container.innerHTML = html;
    return;
  }

  if (!eqlItems.length) {
    html += '<div class="eda-omnisearch-empty">No EQL results</div>';
    container.innerHTML = html;
    return;
  }

  const displayedItems = eqlItems.slice(0, 40);
  const flattenedRows = displayedItems.map((entry) => flattenResultFields(entry.fields));
  const columns = pickTableColumns(flattenedRows);

  html += '<div class="eda-omnisearch-eql-table-wrap"><table class="eda-omnisearch-eql-table"><thead><tr>';
  html += '<th>resource</th>';
  for (const column of columns) {
    html += `<th>${escapeHtml(column)}</th>`;
  }
  html += '</tr></thead><tbody>';

  displayedItems.forEach((item, index) => {
    const row = flattenedRows[index];
    html += `<tr class="eda-omnisearch-eql-row" data-eql-result-index="${index}">`;
    html += `<td class="eda-omnisearch-eql-cell-resource" title="${escapeAttr(item.path)}">${escapeHtml(item.path)}</td>`;
    for (const column of columns) {
      const value = row.get(column) ?? '';
      html += `<td title="${escapeAttr(value)}">${escapeHtml(value)}</td>`;
    }
    html += '</tr>';
  });

  html += '</tbody></table></div>';

  if (eqlItems.length > displayedItems.length) {
    html += `<div class="eda-omnisearch-eql-note">Showing ${displayedItems.length} of ${eqlItems.length} EQL results</div>`;
  }

  container.innerHTML = html;
}
