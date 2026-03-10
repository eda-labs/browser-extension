import { api } from './core/api';
import {
  AUTO_SIZE_ALL_COLUMNS_STORAGE_KEY,
  normalizeAutoSizeAllColumns,
} from './core/settings';
import {
  detectPreferredFontFamilyFromDocument,
  detectThemeModeFromDocument,
  EDA_FONT_FAMILY_STORAGE_KEY,
  EDA_THEME_MODE_STORAGE_KEY,
  type ThemeMode,
} from './core/theme-mode';
import { getErrorMessage } from './core/utils';
import { postCurrentStatus, handlePageMessage, handleStorageChange } from './core/handlers';

const PAGE_TARGET_ORIGIN = window.location.origin === 'null' ? '*' : window.location.origin;
const THEME_MUTATION_ATTRIBUTES = [
  'class',
  'style',
  'data-theme',
  'data-color-scheme',
  'data-mui-color-scheme',
];
const AUTOSIZE_ROUTE_RETRY_DELAYS_MS = [250, 900, 2000, 3600, 6000];
const AUTOSIZE_OPTIONS = { includeHeaders: true, includeOutliers: true, expand: true };
const AUTOSIZE_BRIDGE_ID = 'eda-ext-autosize-page-bridge';
const AUTOSIZE_BRIDGE_CHANNEL = 'eda-autosize-bridge';
const AUTOSIZE_REQUEST_MSG = 'eda-autosize-request';
const AUTOSIZE_RESPONSE_MSG = 'eda-autosize-response';
const AUTOSIZE_REQUEST_TIMEOUT_MS = 2500;
let omnisearchInitialized = false;
let omnisearchInterceptorInitialized = false;
let keepaliveConnected = false;
let omnisearchModulePromise: Promise<typeof import('./omnisearch')> | null = null;
let edaThemeObserver: MutationObserver | null = null;
let themeSyncTimeout: ReturnType<typeof setTimeout> | null = null;
let lastStoredThemeMode: ThemeMode | null = null;
let lastStoredFontFamily: string | null = null;
let appearanceSyncedOnce = false;
let autoSizeAllColumnsEnabled = false;
let autosizeRouteWatcherId: ReturnType<typeof setInterval> | null = null;
let autosizeLastRouteKey = '';
let autosizeLastRetryAt = 0;
let autosizeRunInProgress = false;
let autosizeScheduleGeneration = 0;
const autosizedRouteKeys = new Set<string>();

function getOmnisearchModule(): Promise<typeof import('./omnisearch')> {
  if (!omnisearchModulePromise) {
    omnisearchModulePromise = import('./omnisearch');
  }
  return omnisearchModulePromise;
}

async function ensureOmnisearchInterceptor(): Promise<void> {
  if (omnisearchInterceptorInitialized) return;
  const { injectOmnisearchInterceptor } = await getOmnisearchModule();
  if (omnisearchInterceptorInitialized) return;
  injectOmnisearchInterceptor();
  omnisearchInterceptorInitialized = true;
}

function isEdaSite(): boolean {
  const desc = document.querySelector('meta[name="description"]');
  if (desc?.getAttribute('content') === 'EDA') return true;
  return location.pathname.startsWith('/ui/');
}

function isElementVisible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getVisibleElements(selectors: string[]): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const out: HTMLElement[] = [];

  for (const selector of selectors) {
    const candidates = document.querySelectorAll(selector);
    for (const candidate of Array.from(candidates)) {
      if (!isElementVisible(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  }

  return out;
}

function hasVisibleDataGridRows(): boolean {
  return getVisibleElements(['.MuiDataGrid-row']).length > 0;
}

function injectAutosizeBridge(): void {
  if (document.getElementById(AUTOSIZE_BRIDGE_ID)) return;

  const script = document.createElement('script');
  script.id = AUTOSIZE_BRIDGE_ID;
  script.src = api.runtime.getURL('autosize-page.js');
  script.async = false;

  const root = document.documentElement || document.head;
  if (!root) {
    document.addEventListener('DOMContentLoaded', injectAutosizeBridge, { once: true });
    return;
  }
  root.prepend(script);
}

function getCurrentRouteKey(): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

async function runAutosizeAllColumns(): Promise<boolean> {
  injectAutosizeBridge();

  const requestId = `autosize-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let onMessage: ((event: MessageEvent) => void) | null = null;

  const responsePromise = new Promise<boolean>((resolve) => {
    onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (!event.data || typeof event.data !== 'object') return;

      const data = event.data as Record<string, unknown>;
      if (data.channel !== AUTOSIZE_BRIDGE_CHANNEL) return;
      if (data.type !== AUTOSIZE_RESPONSE_MSG) return;
      if (data.reqId !== requestId) return;

      if (onMessage) {
        window.removeEventListener('message', onMessage);
        onMessage = null;
      }
      resolve(data.ok === true);
    };

    window.addEventListener('message', onMessage);
  });

  const timeoutPromise = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      if (onMessage) {
        window.removeEventListener('message', onMessage);
        onMessage = null;
      }
      resolve(false);
    }, AUTOSIZE_REQUEST_TIMEOUT_MS);
  });

  window.postMessage({
    type: AUTOSIZE_REQUEST_MSG,
    channel: AUTOSIZE_BRIDGE_CHANNEL,
    reqId: requestId,
    options: AUTOSIZE_OPTIONS,
  }, PAGE_TARGET_ORIGIN);

  return Promise.race([responsePromise, timeoutPromise]);
}

async function tryAutosizeCurrentRoute(routeKey: string): Promise<void> {
  if (autosizeRunInProgress) return;
  if (!autoSizeAllColumnsEnabled || !isEdaSite()) return;
  if (routeKey !== getCurrentRouteKey()) return;
  if (autosizedRouteKeys.has(routeKey)) return;

  autosizeRunInProgress = true;
  try {
    const hadVisibleRows = hasVisibleDataGridRows();
    const applied = await runAutosizeAllColumns();
    if (!applied) return;

    if (!hadVisibleRows) return;

    autosizedRouteKeys.add(routeKey);
    if (autosizedRouteKeys.size > 120) {
      autosizedRouteKeys.clear();
      autosizedRouteKeys.add(routeKey);
    }
  } finally {
    autosizeRunInProgress = false;
  }
}

function scheduleAutosizeForRoute(routeKey: string): void {
  if (!autoSizeAllColumnsEnabled || !isEdaSite()) return;
  if (autosizedRouteKeys.has(routeKey)) return;

  autosizeLastRetryAt = Date.now();
  const generation = ++autosizeScheduleGeneration;
  for (const delayMs of AUTOSIZE_ROUTE_RETRY_DELAYS_MS) {
    setTimeout(() => {
      if (generation !== autosizeScheduleGeneration) return;
      void tryAutosizeCurrentRoute(routeKey);
    }, delayMs);
  }
}

function ensureAutosizeRouteWatcher(): void {
  if (!isEdaSite() || autosizeRouteWatcherId) return;
  autosizeLastRouteKey = getCurrentRouteKey();

  autosizeRouteWatcherId = setInterval(() => {
    const routeKey = getCurrentRouteKey();
    if (routeKey !== autosizeLastRouteKey) {
      const previousRouteKey = autosizeLastRouteKey;
      if (previousRouteKey) {
        autosizedRouteKeys.delete(previousRouteKey);
      }
      autosizeLastRouteKey = routeKey;
      autosizeLastRetryAt = 0;
      scheduleAutosizeForRoute(routeKey);
      return;
    }

    if (!autoSizeAllColumnsEnabled || autosizedRouteKeys.has(routeKey)) return;
    if (Date.now() - autosizeLastRetryAt < 5000) return;
    scheduleAutosizeForRoute(routeKey);
  }, 500);
}

function applyAutoSizeSetting(enabled: boolean): void {
  const changed = autoSizeAllColumnsEnabled !== enabled;
  autoSizeAllColumnsEnabled = enabled;

  if (!autoSizeAllColumnsEnabled) {
    autosizeScheduleGeneration += 1;
    return;
  }

  if (!isEdaSite()) return;

  ensureAutosizeRouteWatcher();
  autosizeLastRouteKey = getCurrentRouteKey();
  if (changed || !autosizedRouteKeys.has(autosizeLastRouteKey)) {
    scheduleAutosizeForRoute(autosizeLastRouteKey);
  }
}

async function loadAutoSizeSetting(): Promise<void> {
  if (!isEdaSite()) return;

  try {
    const stored = await api.storage.local.get([AUTO_SIZE_ALL_COLUMNS_STORAGE_KEY]);
    applyAutoSizeSetting(normalizeAutoSizeAllColumns(stored[AUTO_SIZE_ALL_COLUMNS_STORAGE_KEY]));
  } catch {
    // Autosize setting is best effort only.
  }
}

async function persistThemeMode(mode: ThemeMode): Promise<void> {
  const fontFamily = detectPreferredFontFamilyFromDocument();
  const patch: Record<string, string> = {};
  const forceSync = !appearanceSyncedOnce;

  if (forceSync || mode !== lastStoredThemeMode) {
    patch[EDA_THEME_MODE_STORAGE_KEY] = mode;
    lastStoredThemeMode = mode;
  }

  if (forceSync || fontFamily !== lastStoredFontFamily) {
    patch[EDA_FONT_FAMILY_STORAGE_KEY] = fontFamily ?? '';
    lastStoredFontFamily = fontFamily;
  }

  if (Object.keys(patch).length === 0) return;

  try {
    await api.storage.local.set(patch);
    appearanceSyncedOnce = true;
  } catch {
    // Theme sync is best effort only.
  }
}

function syncCurrentThemeMode(): void {
  if (!isEdaSite()) return;
  void persistThemeMode(detectThemeModeFromDocument());
}

function scheduleThemeSync(): void {
  if (themeSyncTimeout) return;
  themeSyncTimeout = setTimeout(() => {
    themeSyncTimeout = null;
    syncCurrentThemeMode();
  }, 80);
}

function ensureThemeObserver(): void {
  if (!isEdaSite() || edaThemeObserver) return;

  syncCurrentThemeMode();

  const root = document.documentElement;
  if (!root) return;

  edaThemeObserver = new MutationObserver(() => {
    scheduleThemeSync();
  });
  edaThemeObserver.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: THEME_MUTATION_ATTRIBUTES,
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      scheduleThemeSync();
      scheduleAutosizeForRoute(getCurrentRouteKey());
    }
  });
}

window.addEventListener('message', (event: MessageEvent) => void handlePageMessage(event));

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'eda-tab-ping') {
    sendResponse({ ok: true, origin: location.origin });
    return false;
  }

  if (message.type === 'eda-status-changed') {
    window.postMessage({
      type: 'eda-status-changed',
      status: message.status ?? 'disconnected',
      edaUrl: message.edaUrl ?? '',
    }, PAGE_TARGET_ORIGIN);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type !== 'eda-tab-fetch') return false;

  const url = message.url;
  if (typeof url !== 'string') {
    sendResponse({ ok: false, status: 0, body: 'Missing URL for tab fetch' });
    return false;
  }

  let targetOrigin = '';
  try {
    targetOrigin = new URL(url).origin;
  } catch {
    sendResponse({ ok: false, status: 0, body: 'Invalid URL for tab fetch' });
    return false;
  }

  if (targetOrigin !== location.origin) {
    sendResponse({ ok: false, status: 0, body: 'Origin mismatch for tab fetch' });
    return false;
  }

  const method = typeof message.method === 'string' ? message.method : 'GET';
  const headers = (message.headers as Record<string, string> | undefined) ?? undefined;
  const body = typeof message.body === 'string' ? message.body : undefined;

  void (async () => {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
      });

      sendResponse({
        ok: res.ok,
        status: res.status,
        body: await res.text(),
      });
    } catch (error) {
      sendResponse({
        ok: false,
        status: 0,
        body: getErrorMessage(error),
      });
    }
  })();

  return true;
});

void (async () => {
  try {
    await api.runtime.sendMessage({
      type: 'eda-tab-ready',
      origin: location.origin,
    });
  } catch {
    // Best effort announce only.
  }
})();

function connectKeepalive(): void {
  const port = api.runtime.connect({ name: 'eda-keepalive' });
  port.onDisconnect.addListener(() => {
    setTimeout(connectKeepalive, 1000);
  });
}

function ensureKeepalive(): void {
  if (keepaliveConnected) return;
  keepaliveConnected = true;
  connectKeepalive();
}

// Announce presence on load
void postCurrentStatus();

// React to status changes via storage
api.storage.onChanged.addListener((changes) => void handleStorageChange(changes));
api.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const changedSetting = changes[AUTO_SIZE_ALL_COLUMNS_STORAGE_KEY];
  if (!changedSetting) return;
  applyAutoSizeSetting(normalizeAutoSizeAllColumns(changedSetting.newValue));
});

async function tryAutoLogin(): Promise<void> {
  if (!location.href.includes('core/httpproxy/v1/keycloak/realms/eda/protocol/openid-connect/')) return;

  const stored = await api.storage.local.get(['autoLogin']);
  if (!stored.autoLogin) return;

  const form = document.getElementById('kc-form-login') as HTMLFormElement | null;
  if (!form) return;

  const usernameInput = form.querySelector<HTMLInputElement>('#username');
  const passwordInput = form.querySelector<HTMLInputElement>('#password');
  if (!usernameInput || !passwordInput) return;

  const result = await api.runtime.sendMessage({ type: 'eda-get-credentials' });
  if (!result.ok) return;

  usernameInput.value = result.username as string;
  passwordInput.value = result.password as string;
  form.submit();
}

function initEdaFeatures(): void {
  void tryAutoLogin();
  if (!isEdaSite()) return;
  ensureThemeObserver();
  ensureKeepalive();
  ensureAutosizeRouteWatcher();
  void loadAutoSizeSetting();
  if (omnisearchInitialized) return;
  omnisearchInitialized = true;
  void (async () => {
    try {
      await ensureOmnisearchInterceptor();
      const { initOmnisearch } = await getOmnisearchModule();
      initOmnisearch();
    } catch {
      omnisearchInitialized = false;
    }
  })();
}

if (location.pathname.startsWith('/ui/')) {
  void (async () => {
    try {
      await ensureOmnisearchInterceptor();
    } catch {
      // Ignore pre-initialization failures; regular init retries.
    }
  })();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEdaFeatures);
} else {
  initEdaFeatures();
}
