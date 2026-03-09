import type { EqlAutocompleteItem, EqlResult, NavItem } from './types';

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
  return `${escapeHtml(before)}<span class="eda-spotlight-highlight">${escapeHtml(match)}</span>${escapeHtml(after)}`;
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

export function createSpotlightOverlay(spotlightId: string): HTMLDivElement {
  const existing = document.getElementById(spotlightId);
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = spotlightId;
  overlay.innerHTML = `
    <div class="eda-spotlight-backdrop"></div>
    <div class="eda-spotlight-panel">
      <div class="eda-spotlight-input-row">
        <svg class="eda-spotlight-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input class="eda-spotlight-input" type="text" placeholder="Search EDA... (type . for EQL)" autocomplete="off" spellcheck="false" />
        <kbd class="eda-spotlight-kbd">esc</kbd>
      </div>
      <div class="eda-spotlight-results"></div>
      <div class="eda-spotlight-footer">
        <span class="eda-spotlight-footer-hint"><kbd class="eda-spotlight-footer-key">&uarr;&darr;</kbd> navigate</span>
        <span class="eda-spotlight-footer-hint"><kbd class="eda-spotlight-footer-key">&crarr;</kbd> open</span>
        <span class="eda-spotlight-footer-hint"><kbd class="eda-spotlight-footer-key">.</kbd> EQL</span>
        <span class="eda-spotlight-footer-hint"><kbd class="eda-spotlight-footer-key">tab</kbd> complete</span>
        <span class="eda-spotlight-footer-count"></span>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #${spotlightId} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 14vh 20px 12vh 20px;
    }
    .eda-spotlight-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); }
    .eda-spotlight-panel {
      position: relative; width: 560px; max-width: 90vw; max-height: 60vh;
      background: #1a222e; border: 1px solid #4a536180; border-radius: 12px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.4); display: flex; flex-direction: column;
      overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #fff;
    }
    .eda-spotlight-input-row {
      display: flex; align-items: center; gap: 8px; padding: 12px 16px;
      border-bottom: 1px solid #4a536180;
    }
    .eda-spotlight-icon { width: 18px; height: 18px; color: #c9ced6; flex-shrink: 0; }
    .eda-spotlight-input {
      flex: 1; background: none; border: none; outline: none;
      font-size: 15px; color: #fff; font-family: inherit;
    }
    .eda-spotlight-input::placeholder { color: #c9ced680; }
    .eda-spotlight-kbd {
      font-size: 10px; color: #c9ced6; border: 1px solid #4a536180;
      border-radius: 4px; padding: 2px 6px; white-space: nowrap; font-family: inherit;
    }
    .eda-spotlight-results { overflow-y: auto; flex: 1; max-height: calc(60vh - 90px); }
    .eda-spotlight-section {
      padding: 6px 16px 2px; font-size: 11px; color: #c9ced650;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500;
    }
    .eda-spotlight-item {
      display: flex; align-items: center; gap: 10px; padding: 8px 16px;
      cursor: pointer; text-decoration: none; color: #fff; border: none;
      background: none; width: 100%; text-align: left; font-family: inherit; font-size: 14px;
    }
    .eda-spotlight-item:hover, .eda-spotlight-item[data-selected="true"] {
      background: #6098ff22;
    }
    .eda-spotlight-item[data-selected="true"] { background: #6098ff33; }
    .eda-spotlight-item-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .eda-spotlight-item-path {
      font-size: 12px; color: #c9ced650; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; max-width: 200px;
    }
    .eda-spotlight-item--autocomplete .eda-spotlight-item-label {
      overflow: visible;
      text-overflow: clip;
      white-space: normal;
      word-break: break-all;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    .eda-spotlight-item--autocomplete .eda-spotlight-item-path { display: none; }
    .eda-spotlight-eql-table-wrap {
      margin: 4px 12px 12px;
      border: 1px solid #4a536180;
      border-radius: 8px;
      overflow: auto;
      max-height: 280px;
      background: #111824;
    }
    .eda-spotlight-eql-table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .eda-spotlight-eql-table th,
    .eda-spotlight-eql-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #4a536140;
      text-align: left;
      white-space: nowrap;
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: top;
    }
    .eda-spotlight-eql-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #1d2633;
      color: #c9ced6;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      font-size: 10px;
      font-weight: 600;
    }
    .eda-spotlight-eql-table td { color: #dde5f2; }
    .eda-spotlight-eql-row { cursor: pointer; }
    .eda-spotlight-eql-row:hover { background: #6098ff22; }
    .eda-spotlight-eql-cell-resource {
      max-width: 360px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    .eda-spotlight-eql-note {
      padding: 6px 12px 10px;
      color: #c9ced680;
      font-size: 11px;
    }
    .eda-spotlight-empty {
      padding: 24px 16px; text-align: center; color: #c9ced680; font-size: 13px;
    }
    .eda-spotlight-footer {
      display: flex; gap: 16px; padding: 6px 16px; border-top: 1px solid #4a536180;
      font-size: 11px; color: #c9ced650;
    }
    .eda-spotlight-footer-hint { display: flex; align-items: center; gap: 4px; }
    .eda-spotlight-footer-key {
      font-size: 10px; color: #c9ced6; border: 1px solid #4a536140;
      border-radius: 3px; padding: 0 4px; font-family: inherit; line-height: 1.6;
    }
    .eda-spotlight-footer-count { margin-left: auto; }
    .eda-spotlight-highlight { color: #6098ff; font-weight: 600; }
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
    container.innerHTML = `<div class="eda-spotlight-empty">${escapeHtml(emptyMessage)}</div>`;
    return clampedIndex;
  }

  let html = '';
  let currentSection = '';

  items.forEach((item, index) => {
    if (item.section !== currentSection) {
      currentSection = item.section;
      html += `<div class="eda-spotlight-section">${escapeHtml(currentSection)}</div>`;
    }
    html += `
      <button class="eda-spotlight-item" data-index="${index}" data-selected="${index === clampedIndex}" data-href="${escapeAttr(item.href)}">
        <span class="eda-spotlight-item-label">${highlightMatch(item.label, query)}</span>
        <span class="eda-spotlight-item-path">${escapeHtml(item.href)}</span>
      </button>`;
  });

  container.innerHTML = html;
  return clampedIndex;
}

interface EqlRenderState {
  eqlLoading: boolean;
  eqlError: string;
  eqlAutocompleteLoading: boolean;
  eqlAutocompleteError: string;
}

export function renderEqlResultsView(
  container: HTMLElement,
  eqlItems: EqlResult[],
  autocompleteItems: EqlAutocompleteItem[],
  query: string,
  selectedIndex: number,
  state: EqlRenderState,
  countEl?: HTMLElement,
): number {
  const clampedIndex = Math.max(0, Math.min(selectedIndex, autocompleteItems.length - 1));

  if (countEl) {
    const resultText = `${eqlItems.length} result${eqlItems.length !== 1 ? 's' : ''}`;
    const autocompleteText = `${autocompleteItems.length} suggestion${autocompleteItems.length !== 1 ? 's' : ''}`;
    countEl.textContent = `${resultText} | ${autocompleteText}`;
  }

  if (query.length <= 1) {
    container.innerHTML = '<div class="eda-spotlight-empty">Start typing an EQL query after the dot</div>';
    return clampedIndex;
  }

  let html = '<div class="eda-spotlight-section">Autocomplete</div>';

  if (state.eqlAutocompleteLoading && !autocompleteItems.length) {
    html += '<div class="eda-spotlight-empty">Loading autocomplete suggestions...</div>';
  } else if (state.eqlAutocompleteError) {
    html += `<div class="eda-spotlight-empty">${escapeHtml(state.eqlAutocompleteError)}</div>`;
  } else if (!autocompleteItems.length) {
    html += '<div class="eda-spotlight-empty">No autocomplete suggestions</div>';
  } else {
    autocompleteItems.forEach((item, index) => {
      html += `
        <button class="eda-spotlight-item eda-spotlight-item--autocomplete" data-index="${index}" data-selected="${index === clampedIndex}" data-eql-autocomplete-index="${index}">
          <span class="eda-spotlight-item-label">${escapeHtml(item.value)}</span>
          <span class="eda-spotlight-item-path">${escapeHtml(item.suffix)}</span>
        </button>`;
    });
  }

  html += '<div class="eda-spotlight-section">EQL Results</div>';

  if (state.eqlLoading && !eqlItems.length) {
    html += '<div class="eda-spotlight-empty">Running EQL query...</div>';
    container.innerHTML = html;
    return clampedIndex;
  }

  if (state.eqlError) {
    html += `<div class="eda-spotlight-empty">${escapeHtml(state.eqlError)}</div>`;
    container.innerHTML = html;
    return clampedIndex;
  }

  if (!eqlItems.length) {
    html += '<div class="eda-spotlight-empty">No EQL results</div>';
    container.innerHTML = html;
    return clampedIndex;
  }

  const displayedItems = eqlItems.slice(0, 40);
  const flattenedRows = displayedItems.map((entry) => flattenResultFields(entry.fields));
  const columns = pickTableColumns(flattenedRows);

  html += '<div class="eda-spotlight-eql-table-wrap"><table class="eda-spotlight-eql-table"><thead><tr>';
  html += '<th>resource</th>';
  for (const column of columns) {
    html += `<th>${escapeHtml(column)}</th>`;
  }
  html += '</tr></thead><tbody>';

  displayedItems.forEach((item, index) => {
    const row = flattenedRows[index];
    html += `<tr class="eda-spotlight-eql-row" data-eql-result-index="${index}">`;
    html += `<td class="eda-spotlight-eql-cell-resource" title="${escapeAttr(item.path)}">${escapeHtml(item.path)}</td>`;
    for (const column of columns) {
      const value = row.get(column) ?? '';
      html += `<td title="${escapeAttr(value)}">${escapeHtml(value)}</td>`;
    }
    html += '</tr>';
  });

  html += '</tbody></table></div>';

  if (eqlItems.length > displayedItems.length) {
    html += `<div class="eda-spotlight-eql-note">Showing ${displayedItems.length} of ${eqlItems.length} EQL results</div>`;
  }

  container.innerHTML = html;
  return clampedIndex;
}
