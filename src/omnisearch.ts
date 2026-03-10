import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { api } from './core/api';
import { detectPreferredFontFamilyFromDocument, detectThemeModeFromDocument } from './core/theme-mode';
import {
  DEFAULT_OMNISEARCH_HOTKEY,
  OMNISEARCH_HOTKEY_STORAGE_KEY,
  getOmnisearchHotkey,
  matchesOmnisearchHotkey,
  normalizeOmnisearchHotkey,
  type OmnisearchHotkey,
} from './core/settings';
import {
  APPS_REQUEST_MSG,
  APPS_RESPONSE_MSG,
  BRIDGE_READY_MSG,
  OMNISEARCH_BRIDGE_CHANNEL,
} from './omnisearch/constants';
import { processAppsPayload } from './omnisearch/catalog';
import { dedupeAndSortItems } from './omnisearch/search';
import type { NavItem } from './omnisearch/types';
import { OmnisearchOverlay, type NavState } from './omnisearch/OmnisearchOverlay';

const OMNISEARCH_ID = 'eda-ext-omnisearch';
const PAGE_BRIDGE_ID = 'eda-ext-omnisearch-page-bridge';
const PAGE_TARGET_ORIGIN = window.location.origin === 'null' ? '*' : window.location.origin;

const QUICK_ACTIONS: NavItem[] = [];

// Persistent state across open/close cycles
let apiItems: NavItem[] = [];
let apiFetched = false;
let apiLoading = false;
let apiError = '';
let bridgeReady = false;
let appsRequestTimeout: ReturnType<typeof setTimeout> | null = null;
let appsLoadingStartedAt = 0;
let apiLoadingPhase: 'none' | 'apps' | 'resources' = 'none';
let appsLoadedAt = 0;
let appsLastLoadDurationMs = 0;

const navStateListeners = new Set<() => void>();
function notifyNavStateChange() {
  for (const cb of navStateListeners) cb();
}
function subscribeNavUpdate(cb: () => void): () => void {
  navStateListeners.add(cb);
  return () => {
    navStateListeners.delete(cb);
  };
}

function getNavState(): NavState {
  return {
    items: dedupeAndSortItems([...QUICK_ACTIONS, ...apiItems]),
    loading: apiLoading,
    error: apiError,
    bridgeReady,
    loadingStartedAt: appsLoadingStartedAt,
    loadingPhase: apiLoadingPhase,
    loadedAt: appsLoadedAt,
    lastLoadDurationMs: appsLastLoadDurationMs,
  };
}

let reactRoot: Root | null = null;
let overlayContainer: HTMLDivElement | null = null;

let messageListenerSetup = false;
let currentHotkey: OmnisearchHotkey = DEFAULT_OMNISEARCH_HOTKEY;
let hotkeyListenerInitialized = false;
let hotkeyStorageSyncInitialized = false;

function injectAppsFetcher(): void {
  if (document.getElementById(PAGE_BRIDGE_ID)) return;

  const script = document.createElement('script');
  script.id = PAGE_BRIDGE_ID;
  script.src = api.runtime.getURL('omnisearch-page.js');
  script.async = false;
  script.onerror = () => {
    apiError = 'Could not load omnisearch bridge script';
    apiLoading = false;
    notifyNavStateChange();
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

function requestApps(force = false): void {
  if (!apiLoading) {
    appsLoadingStartedAt = Date.now();
  }
  apiLoading = true;
  apiLoadingPhase = 'apps';
  appsLoadedAt = 0;
  appsLastLoadDurationMs = 0;
  if (appsRequestTimeout) clearTimeout(appsRequestTimeout);
  appsRequestTimeout = setTimeout(() => {
    if (!apiLoading) return;
    apiLoading = false;
    apiLoadingPhase = 'none';
    appsLoadingStartedAt = 0;
    appsLoadedAt = 0;
    appsLastLoadDurationMs = 0;
    apiError = bridgeReady ? 'Waiting for EDA API response' : 'Search bridge did not initialize';
    notifyNavStateChange();
  }, 8_000);
  window.postMessage({ type: APPS_REQUEST_MSG, channel: OMNISEARCH_BRIDGE_CHANNEL, force }, PAGE_TARGET_ORIGIN);
}

function setupMessageListener(): void {
  if (messageListenerSetup) return;
  messageListenerSetup = true;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    if (window.location.origin !== 'null' && event.origin !== window.location.origin) return;
    if (!event.data || typeof event.data !== 'object') return;

    const data = event.data as Record<string, unknown>;
    if (data.channel !== OMNISEARCH_BRIDGE_CHANNEL) return;

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
      const explicitLoading = typeof data.loading === 'boolean' ? data.loading : null;
      if (explicitLoading != null) {
        apiLoading = explicitLoading;
      } else {
        const isPartialResponse = Boolean(data.partial);
        apiLoading = isPartialResponse;
      }

      if (apiLoading) {
        if (!appsLoadingStartedAt) appsLoadingStartedAt = Date.now();
        apiLoadingPhase = String(data.phase || '') === 'resources' ? 'resources' : 'apps';
        appsLoadedAt = 0;
        appsLastLoadDurationMs = 0;
      } else {
        if (appsLoadingStartedAt > 0) {
          appsLastLoadDurationMs = Math.max(0, Date.now() - appsLoadingStartedAt);
          appsLoadedAt = Date.now();
        } else {
          appsLastLoadDurationMs = 0;
          appsLoadedAt = 0;
        }
        appsLoadingStartedAt = 0;
        apiLoadingPhase = 'none';
      }

      const responseError = typeof data.error === 'string' ? data.error : '';
      if (responseError && apiItems.length === 0) {
        apiError = responseError;
      }
      if (processAppsResponse(data.data)) {
        apiError = '';
      } else if (apiItems.length === 0 && !responseError) {
        apiError = 'Invalid apps response';
      }
      notifyNavStateChange();
    }
  });
}

function closeOmnisearch() {
  if (reactRoot) {
    reactRoot.unmount();
    reactRoot = null;
  }
  if (overlayContainer) {
    overlayContainer.remove();
    overlayContainer = null;
  }
}

function openOmnisearch() {
  if (!bridgeReady) injectAppsFetcher();
  if (!apiLoading && (!apiFetched || apiItems.length === 0)) {
    requestApps(!apiFetched);
  }

  closeOmnisearch();

  overlayContainer = document.createElement('div');
  overlayContainer.id = OMNISEARCH_ID;
  document.body.appendChild(overlayContainer);

  reactRoot = createRoot(overlayContainer);
  reactRoot.render(
    React.createElement(OmnisearchOverlay, {
      mode: detectThemeModeFromDocument(),
      fontFamily: detectPreferredFontFamilyFromDocument(),
      getNavState,
      onClose: closeOmnisearch,
      subscribeNavUpdate,
    }),
  );
}

function isOmnisearchOpen(): boolean {
  return !!document.getElementById(OMNISEARCH_ID);
}

/**
 * Initializes omnisearch message listeners in the content script and
 * injects the page bridge so auth token capture can start immediately.
 */
export function injectOmnisearchInterceptor(): void {
  setupMessageListener();
  injectAppsFetcher();
}

function updateHotkeyFromStorage(rawValue: unknown): void {
  currentHotkey = normalizeOmnisearchHotkey(rawValue);
}

function syncHotkeyFromStorage(): void {
  void (async () => {
    try {
      currentHotkey = await getOmnisearchHotkey();
    } catch {
      currentHotkey = DEFAULT_OMNISEARCH_HOTKEY;
    }
  })();
}

function ensureHotkeyStorageSync(): void {
  if (hotkeyStorageSyncInitialized) return;
  hotkeyStorageSyncInitialized = true;
  syncHotkeyFromStorage();

  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const hotkeyChange = changes[OMNISEARCH_HOTKEY_STORAGE_KEY];
    if (!hotkeyChange) return;
    updateHotkeyFromStorage(hotkeyChange.newValue);
  });
}

function handleOmnisearchHotkey(event: KeyboardEvent): void {
  if (event.repeat) return;
  if (!matchesOmnisearchHotkey(event, currentHotkey)) return;

  event.preventDefault();
  event.stopPropagation();

  if (isOmnisearchOpen()) {
    closeOmnisearch();
  } else {
    openOmnisearch();
  }
}

export function initOmnisearch(): void {
  ensureHotkeyStorageSync();
  if (hotkeyListenerInitialized) return;
  hotkeyListenerInitialized = true;
  window.addEventListener('keydown', handleOmnisearchHotkey, true);
}
