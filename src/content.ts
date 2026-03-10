import { api } from './core/api';
import { getErrorMessage } from './core/utils';
import { postCurrentStatus, handlePageMessage, handleStorageChange } from './core/handlers';

const PAGE_TARGET_ORIGIN = window.location.origin === 'null' ? '*' : window.location.origin;
let spotlightInitialized = false;
let spotlightInterceptorInitialized = false;
let keepaliveConnected = false;
let spotlightModulePromise: Promise<typeof import('./spotlight')> | null = null;

function getSpotlightModule(): Promise<typeof import('./spotlight')> {
  if (!spotlightModulePromise) {
    spotlightModulePromise = import('./spotlight');
  }
  return spotlightModulePromise;
}

async function ensureSpotlightInterceptor(): Promise<void> {
  if (spotlightInterceptorInitialized) return;
  const { injectSpotlightInterceptor } = await getSpotlightModule();
  if (spotlightInterceptorInitialized) return;
  injectSpotlightInterceptor();
  spotlightInterceptorInitialized = true;
}

function isEdaSite(): boolean {
  const desc = document.querySelector('meta[name="description"]');
  if (desc?.getAttribute('content') === 'EDA') return true;
  return location.pathname.startsWith('/ui/');
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
  ensureKeepalive();
  if (spotlightInitialized) return;
  spotlightInitialized = true;
  void (async () => {
    try {
      await ensureSpotlightInterceptor();
      const { initSpotlight } = await getSpotlightModule();
      initSpotlight();
    } catch {
      spotlightInitialized = false;
    }
  })();
}

if (location.pathname.startsWith('/ui/')) {
  void (async () => {
    try {
      await ensureSpotlightInterceptor();
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
