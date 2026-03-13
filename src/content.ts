import { api } from './core/api';
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
let omnisearchInitialized = false;
let omnisearchInterceptorInitialized = false;
let keepaliveConnected = false;
let omnisearchModulePromise: Promise<typeof import('./omnisearch')> | null = null;
let edaThemeObserver: MutationObserver | null = null;
let themeSyncTimeout: ReturnType<typeof setTimeout> | null = null;
let lastStoredThemeMode: ThemeMode | null = null;
let lastStoredFontFamily: string | null = null;
let appearanceSyncedOnce = false;

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

let workflowLogModulePromise: Promise<typeof import('./workflow-log/WorkflowLogTable')> | null = null;

function formatWorkflowLogs(): void {
  const logContainer = document.getElementById('WorkflowLog');
  if (!logContainer || logContainer.dataset.edaFormatted === '1') return;

  let lineDivs = logContainer.querySelectorAll('.css-t86uxs');
  if (lineDivs.length === 0) {
    const inner = logContainer.firstElementChild;
    if (inner) lineDivs = inner.querySelectorAll('div');
  }
  const rawLines: string[] = [];
  for (let i = 0; i < lineDivs.length; i++) {
    const text = (lineDivs[i].textContent || '').trim();
    if (text) rawLines.push(text);
  }
  if (!rawLines.some((l) => l.startsWith('{'))) return;
  logContainer.dataset.edaFormatted = '1';

  if (!workflowLogModulePromise) {
    workflowLogModulePromise = import('./workflow-log/WorkflowLogTable');
  }

  void (async () => {
    try {
      const { WorkflowLogTable, parseLogLines } = await workflowLogModulePromise!;
      const React = await import('react');
      const { createRoot } = await import('react-dom/client');

      const rows = parseLogLines(rawLines);
      if (rows.length === 0) return;

      const mountDiv = document.createElement('div');
      mountDiv.style.cssText = 'width:100%;height:100%';

      const inner = logContainer.firstElementChild as HTMLElement | null;
      if (inner) {
        inner.style.padding = '0';
        inner.style.height = '100%';
        inner.replaceChildren(mountDiv);
      } else {
        logContainer.replaceChildren(mountDiv);
      }
      logContainer.style.overflow = 'hidden';

      const edaRoot = document.getElementById('root') || document.documentElement;
      const cs = getComputedStyle(edaRoot);
      const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
      const themeVars = {
        bgDefault: v('--mui-palette-background-default', '#1a222e'),
        bgPaper: v('--mui-palette-background-paper', '#1a222e'),
        textPrimary: v('--mui-palette-text-primary', 'rgba(255,255,255,0.87)'),
        textSecondary: v('--mui-palette-text-secondary', 'rgba(255,255,255,0.6)'),
        textDisabled: v('--mui-palette-text-disabled', 'rgba(255,255,255,0.38)'),
        borderColor: v('--mui-palette-TableCell-border', 'rgba(81,81,81,1)'),
        primaryMain: v('--mui-palette-primary-main', '#1976d2'),
        errorMain: v('--mui-palette-error-main', '#d32f2f'),
        actionHover: v('--mui-palette-action-hover', 'rgba(255,255,255,0.08)'),
        hoverOpacity: v('--mui-palette-action-hoverOpacity', '0.08'),
        selectedOpacity: v('--mui-palette-action-selectedOpacity', '0.16'),
        spacing: v('--mui-spacing', '8px'),
        fontFamily: v('--mui-font-fontFamily', '"Nokia Pure Text", sans-serif'),
      };

      const root = createRoot(mountDiv);
      root.render(React.createElement(WorkflowLogTable, { rows, themeVars } as any));
    } catch (err) {
      console.error('[eda-ext] workflow log table error:', err);
    }
  })();
}

let workflowLogObserver: MutationObserver | null = null;

function ensureWorkflowLogObserver(): void {
  if (workflowLogObserver || !isEdaSite()) return;
  workflowLogObserver = new MutationObserver(() => formatWorkflowLogs());
  workflowLogObserver.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initEdaFeatures();
    ensureWorkflowLogObserver();
  });
} else {
  initEdaFeatures();
  ensureWorkflowLogObserver();
}
