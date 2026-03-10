import { api } from './core/api';
import {
  APPS_REQUEST_MSG,
  APPS_RESPONSE_MSG,
  BRIDGE_READY_MSG,
  EQL_AUTOCOMPLETE_REQUEST_MSG,
  EQL_AUTOCOMPLETE_RESPONSE_MSG,
  EQL_REQUEST_MSG,
  EQL_RESPONSE_MSG,
  SPOTLIGHT_BRIDGE_CHANNEL,
} from './spotlight/constants';
import { humanizeLabel, processAppsPayload } from './spotlight/catalog';
import { navigate, triggerWorkflowRun } from './spotlight/navigation';
import { dedupeAndSortItems, scoreMatch } from './spotlight/search';
import type { EqlAutocompleteItem, EqlResult, NavItem } from './spotlight/types';
import { createSpotlightOverlay, renderEqlResultsView, renderNavResults } from './spotlight/view';

const SPOTLIGHT_ID = 'eda-ext-spotlight';
const PAGE_BRIDGE_ID = 'eda-ext-spotlight-page-bridge';
const PAGE_TARGET_ORIGIN = window.location.origin === 'null' ? '*' : window.location.origin;

const QUICK_ACTIONS: NavItem[] = [];

// Items fetched from the /apps API
let apiItems: NavItem[] = [];
let apiFetched = false;
let apiLoading = false;
let apiError = '';
let bridgeReady = false;
let appRenderCallback: (() => void) | null = null;
let appsRequestTimeout: ReturnType<typeof setTimeout> | null = null;

function injectAppsFetcher(): void {
  if (document.getElementById(PAGE_BRIDGE_ID)) {
    return;
  }

  const script = document.createElement('script');
  script.id = PAGE_BRIDGE_ID;
  script.src = api.runtime.getURL('spotlight-page.js');
  script.async = false;
  script.onerror = () => {
    apiError = 'Could not load spotlight bridge script';
    apiLoading = false;
    if (appRenderCallback) appRenderCallback();
  };

  const root = document.documentElement || document.head;
  if (!root) {
    document.addEventListener('DOMContentLoaded', injectAppsFetcher, { once: true });
    return;
  }
  root.prepend(script);
}

function processAppsResponse(data: unknown): boolean {
  const items = processAppsPayload(data, QUICK_ACTIONS);
  if (!items) return false;
  apiItems = items;
  apiFetched = true;
  apiError = '';
  return true;
}

// EQL query state
let eqlReqCounter = 0;
let eqlLatestReqId = 0;
let eqlResults: EqlResult[] = [];
let eqlError = '';
let eqlLoading = false;
let eqlCurrentQuery = '';
let eqlAutocompleteReqCounter = 0;
let eqlAutocompleteLatestReqId = 0;
let eqlAutocompleteItems: EqlAutocompleteItem[] = [];
let eqlAutocompleteLoading = false;
let eqlAutocompleteError = '';
let eqlRenderCallback: (() => void) | null = null;
let messageListenerSetup = false;

function processEqlResponse(data: unknown): EqlResult[] {
  if (!data || typeof data !== 'object') return [];
  const resp = data as Record<string, unknown>;

  // EQL responses have a "data" field with the results array
  const items = Array.isArray(resp.data) ? resp.data : Array.isArray(data) ? data : [];

  return items.map((item: Record<string, unknown>) => {
    const name = (item.name as string) || (item.metadata as Record<string, unknown>)?.name as string || '';
    const namespace = (item.namespace as string) || (item.metadata as Record<string, unknown>)?.namespace as string || '';
    const kind = (item.kind as string) || '';
    const apiVersion = (item.apiVersion as string) || '';

    // Build a path for display
    const parts = [apiVersion, namespace, kind, name].filter(Boolean);
    const path = parts.join('/');

    // Use kind as section
    const section = kind || 'Results';
    const label = name || JSON.stringify(item).slice(0, 80);

    return { label, path, section, fields: item };
  });
}

function processEqlAutocompleteResponse(data: unknown, query: string): EqlAutocompleteItem[] {
  if (!data || typeof data !== 'object') return [];
  const completions = Array.isArray((data as Record<string, unknown>).completions)
    ? (data as Record<string, unknown>).completions as Array<Record<string, unknown>>
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
    if (!suffix && query && value.startsWith(query)) {
      suffix = value.slice(query.length);
    }

    out.push({
      value,
      suffix: suffix || value,
    });
  }
  return out;
}

let selectedIndex = 0;
let filteredItems: NavItem[] = [];

function setupMessageListener(): void {
  if (messageListenerSetup) return;
  messageListenerSetup = true;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    if (window.location.origin !== 'null' && event.origin !== window.location.origin) return;
    if (!event.data || typeof event.data !== 'object') return;

    const data = event.data as Record<string, unknown>;
    if (data.channel !== SPOTLIGHT_BRIDGE_CHANNEL) return;

    if (data.type === BRIDGE_READY_MSG) {
      bridgeReady = true;
      if ((apiLoading || !apiFetched) && !apiItems.length) {
        requestApps(false);
      }
      return;
    }

    if (data.type === APPS_RESPONSE_MSG) {
      if (appsRequestTimeout) {
        clearTimeout(appsRequestTimeout);
        appsRequestTimeout = null;
      }
      apiLoading = false;

      const responseError = typeof data.error === 'string' ? data.error : '';
      if (responseError && apiItems.length === 0) {
        apiError = responseError;
      }
      if (processAppsResponse(data.data)) {
        apiError = '';
      } else if (apiItems.length === 0 && !responseError) {
        apiError = 'Invalid apps response';
      }
      if (appRenderCallback) appRenderCallback();
      return;
    }

    if (data.type === EQL_RESPONSE_MSG) {
      const reqId = data.reqId as number;
      if (reqId !== eqlLatestReqId) return; // stale response
      eqlLoading = false;
      if (data.error) {
        eqlError = data.error as string;
        eqlResults = [];
      } else {
        eqlError = '';
        eqlResults = processEqlResponse(data.data);
      }
      if (eqlRenderCallback) eqlRenderCallback();
      return;
    }

    if (data.type === EQL_AUTOCOMPLETE_RESPONSE_MSG) {
      const reqId = data.reqId as number;
      if (reqId !== eqlAutocompleteLatestReqId) return;
      eqlAutocompleteLoading = false;

      if (data.error) {
        eqlAutocompleteError = data.error as string;
        eqlAutocompleteItems = [];
      } else {
        eqlAutocompleteError = '';
        eqlAutocompleteItems = processEqlAutocompleteResponse(data.data, eqlCurrentQuery).slice(0, 10);
      }
      selectedIndex = 0;
      if (eqlRenderCallback) eqlRenderCallback();
    }
  });
}

function getAllItems(): NavItem[] {
  return dedupeAndSortItems([...QUICK_ACTIONS, ...apiItems]);
}

function createSpotlight(): HTMLDivElement {
  return createSpotlightOverlay(SPOTLIGHT_ID);
}

function renderResults(
  container: HTMLElement,
  items: NavItem[],
  query: string,
  countEl?: HTMLElement,
  emptyMessage = 'No matching pages',
) {
  filteredItems = items;
  selectedIndex = renderNavResults(container, items, query, selectedIndex, countEl, emptyMessage);
}

function renderEqlResults(
  container: HTMLElement,
  eqlItems: EqlResult[],
  autocompleteItems: EqlAutocompleteItem[],
  countEl?: HTMLElement,
  query = '',
) {
  selectedIndex = renderEqlResultsView(
    container,
    eqlItems,
    autocompleteItems,
    query,
    selectedIndex,
    {
      eqlLoading,
      eqlError,
      eqlAutocompleteLoading,
      eqlAutocompleteError,
    },
    countEl,
  );
}

function sendEqlQuery(query: string): void {
  eqlReqCounter++;
  eqlLatestReqId = eqlReqCounter;
  eqlLoading = true;
  eqlResults = [];
  eqlError = '';
  window.postMessage({
    type: EQL_REQUEST_MSG,
    channel: SPOTLIGHT_BRIDGE_CHANNEL,
    query,
    reqId: eqlLatestReqId,
  }, PAGE_TARGET_ORIGIN);
}

function sendEqlAutocompleteQuery(query: string): void {
  eqlAutocompleteReqCounter++;
  eqlAutocompleteLatestReqId = eqlAutocompleteReqCounter;
  eqlAutocompleteLoading = true;
  eqlAutocompleteError = '';
  eqlAutocompleteItems = [];
  window.postMessage({
    type: EQL_AUTOCOMPLETE_REQUEST_MSG,
    channel: SPOTLIGHT_BRIDGE_CHANNEL,
    query,
    reqId: eqlAutocompleteLatestReqId,
    completionLimit: 10,
  }, PAGE_TARGET_ORIGIN);
}

function requireElement<T extends Element>(element: T | null, selector: string): T {
  if (!element) {
    throw new Error(`Spotlight overlay is missing required element: ${selector}`);
  }
  return element;
}

function requestApps(force = false): void {
  apiLoading = true;
  if (appsRequestTimeout) {
    clearTimeout(appsRequestTimeout);
  }
  appsRequestTimeout = setTimeout(() => {
    if (!apiLoading) return;
    apiLoading = false;
    apiError = bridgeReady
      ? 'Waiting for EDA API response'
      : 'Search bridge did not initialize';
    if (appRenderCallback) appRenderCallback();
  }, 8_000);
  window.postMessage({ type: APPS_REQUEST_MSG, channel: SPOTLIGHT_BRIDGE_CHANNEL, force }, PAGE_TARGET_ORIGIN);
}

function openSpotlight() {
  if (!bridgeReady) injectAppsFetcher();
  if (!apiLoading && (!apiFetched || apiItems.length === 0)) {
    requestApps(!apiFetched);
  }

  const overlay = createSpotlight();
  document.body.appendChild(overlay);

  const input = requireElement(overlay.querySelector<HTMLInputElement>('.eda-spotlight-input'), '.eda-spotlight-input');
  const results = requireElement(overlay.querySelector<HTMLElement>('.eda-spotlight-results'), '.eda-spotlight-results');
  const backdrop = requireElement(overlay.querySelector<HTMLElement>('.eda-spotlight-backdrop'), '.eda-spotlight-backdrop');
  const countEl = requireElement(overlay.querySelector<HTMLElement>('.eda-spotlight-footer-count'), '.eda-spotlight-footer-count');

  selectedIndex = 0;
  let eqlMode = false;
  eqlCurrentQuery = '';
  eqlAutocompleteItems = [];
  eqlAutocompleteLoading = false;
  eqlAutocompleteError = '';

  function getNavEmptyMessage(query: string): string {
    if (!bridgeReady) return 'Initializing EDA search bridge...';
    if (apiLoading && apiItems.length === 0) return 'Loading EDA pages...';
    if (apiError && apiItems.length === 0) return `Could not load pages: ${apiError}`;
    if (!query && apiItems.length === 0) return 'No pages discovered yet';
    return 'No matching pages';
  }

  function renderCurrentNav(rawQuery: string): void {
    const navItems = getAllItems();
    const q = rawQuery.toLowerCase().trim();
    if (!q) {
      selectedIndex = 0;
      renderResults(results, navItems, '', countEl, getNavEmptyMessage(''));
      return;
    }

    const scored = navItems
      .map((item) => ({ item, score: scoreMatch(item, q) }))
      .filter((s) => s.score >= 0)
      .sort((a, b) => b.score - a.score);

    selectedIndex = 0;
    renderResults(results, scored.map((s) => s.item), q, countEl, getNavEmptyMessage(q));
  }

  renderCurrentNav('');

  input.focus();

  function renderCurrentEql() {
    renderEqlResults(results, eqlResults, eqlAutocompleteItems, countEl, eqlCurrentQuery);
  }

  eqlRenderCallback = renderCurrentEql;
  appRenderCallback = () => {
    if (eqlMode) return;
    renderCurrentNav(input.value);
  };

  function filter() {
    const raw = input.value;

    // EQL mode: first char is "."
    if (raw.startsWith('.')) {
      eqlMode = true;
      input.placeholder = 'EQL query...';
      const query = raw;
      eqlCurrentQuery = query;

      if (query.length <= 1) {
        eqlResults = [];
        eqlError = '';
        eqlLoading = false;
        eqlAutocompleteItems = [];
        eqlAutocompleteLoading = false;
        eqlAutocompleteError = '';
        selectedIndex = 0;
        renderEqlResults(results, [], [], countEl, query);
        return;
      }

      selectedIndex = 0;
      sendEqlQuery(query);
      sendEqlAutocompleteQuery(query);
      renderCurrentEql();
      return;
    }

    // Normal navigation mode
    if (eqlMode) {
      eqlMode = false;
      input.placeholder = 'Search EDA... (type . for EQL)';
      eqlResults = [];
      eqlError = '';
      eqlLoading = false;
      eqlCurrentQuery = '';
      eqlAutocompleteItems = [];
      eqlAutocompleteLoading = false;
      eqlAutocompleteError = '';
    }

    renderCurrentNav(raw);
  }

  function close() {
    eqlRenderCallback = null;
    appRenderCallback = null;
    eqlCurrentQuery = '';
    eqlResults = [];
    eqlError = '';
    eqlLoading = false;
    eqlAutocompleteItems = [];
    eqlAutocompleteLoading = false;
    eqlAutocompleteError = '';
    overlay.remove();
  }

  function navigateToEql() {
    const query = input.value.trim();
    close();
    navigate('/ui/main/queryapi');
    // Fill the query into the EDA Query API editor after navigation
    setTimeout(() => {
      const editor = document.getElementById('QueryBuilderInput-eql-Input-Autocomplete') as HTMLInputElement | null;
      if (editor) {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(editor, query);
        else editor.value = query;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        editor.focus();
        setTimeout(() => {
          editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }, 200);
      }
    }, 500);
  }

  function applyAutocomplete(index = selectedIndex): boolean {
    const suggestion = eqlAutocompleteItems[index];
    if (!suggestion) return false;
    input.value = suggestion.value;
    input.focus();
    filter();
    return true;
  }

  function selectCurrent() {
    if (eqlMode) {
      navigateToEql();
      return;
    }
    if (filteredItems.length > 0) {
      const item = filteredItems[selectedIndex];
      close();
      if (item.action === 'workflow-run' && item.workflowMeta) {
        triggerWorkflowRun(item.workflowMeta, humanizeLabel);
      } else {
        navigate(item.href);
      }
    }
  }

  input.addEventListener('input', filter);

  input.addEventListener('keydown', (e) => {
    const maxIndex = eqlMode ? eqlAutocompleteItems.length - 1 : filteredItems.length - 1;

    if (e.key === 'Tab' && eqlMode) {
      if (applyAutocomplete()) {
        e.preventDefault();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (maxIndex < 0) return;
      selectedIndex = Math.min(selectedIndex + 1, maxIndex);
      if (eqlMode) {
        renderEqlResults(results, eqlResults, eqlAutocompleteItems, countEl, eqlCurrentQuery);
      } else {
        renderResults(results, filteredItems, input.value.toLowerCase().trim(), countEl);
      }
      results.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (maxIndex < 0) return;
      selectedIndex = Math.max(selectedIndex - 1, 0);
      if (eqlMode) {
        renderEqlResults(results, eqlResults, eqlAutocompleteItems, countEl, eqlCurrentQuery);
      } else {
        renderResults(results, filteredItems, input.value.toLowerCase().trim(), countEl);
      }
      results.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectCurrent();
    }
  });

  results.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>('.eda-spotlight-item');
    const eqlRow = target.closest<HTMLElement>('[data-eql-result-index]');
    if (!btn && !eqlRow) return;

    if (eqlMode) {
      const autocompleteIdx = Number.parseInt(btn?.dataset.eqlAutocompleteIndex ?? '', 10);
      if (btn && !Number.isNaN(autocompleteIdx)) {
        selectedIndex = autocompleteIdx;
        applyAutocomplete(autocompleteIdx);
        return;
      }

      const resultIdx = Number.parseInt((btn?.dataset.eqlResultIndex ?? eqlRow?.dataset.eqlResultIndex) ?? '', 10);
      if (!Number.isNaN(resultIdx)) {
        navigateToEql();
      }
      return;
    }

    if (!btn) return;

    const idx = parseInt(btn.dataset.index ?? '0', 10);
    const item = filteredItems[idx];
    if (item) {
      close();
      if (item.action === 'workflow-run' && item.workflowMeta) {
        triggerWorkflowRun(item.workflowMeta, humanizeLabel);
      } else {
        navigate(item.href);
      }
    }
  });

  backdrop.addEventListener('click', close);
}

function isSpotlightOpen(): boolean {
  return !!document.getElementById(SPOTLIGHT_ID);
}

function closeSpotlightImmediately(): void {
  eqlRenderCallback = null;
  appRenderCallback = null;
  document.getElementById(SPOTLIGHT_ID)?.remove();
}

/**
 * Initializes spotlight message listeners in the content script and
 * injects the page bridge so auth token capture can start immediately.
 */
export function injectSpotlightInterceptor(): void {
  setupMessageListener();
  injectAppsFetcher();
}

export function initSpotlight(): void {

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
      e.preventDefault();
      e.stopPropagation();
      if (isSpotlightOpen()) {
        closeSpotlightImmediately();
      } else {
        openSpotlight();
      }
    }
  }, true);
}
