import { api } from './core/api';
import { postCurrentStatus, handlePageMessage, handleStorageChange } from './core/handlers';

window.addEventListener('message', (event: MessageEvent) => void handlePageMessage(event));

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'eda-tab-ping') {
    sendResponse({ ok: true, origin: location.origin });
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

  void fetch(url, {
    method,
    headers,
    body,
  }).then(async (res) => {
    sendResponse({
      ok: res.ok,
      status: res.status,
      body: await res.text(),
    });
  }).catch((err) => {
    sendResponse({
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
    });
  });

  return true;
});

void api.runtime.sendMessage({
  type: 'eda-tab-ready',
  origin: location.origin,
}).catch(() => undefined);

function connectKeepalive(): void {
  const port = api.runtime.connect({ name: 'eda-keepalive' });
  port.onDisconnect.addListener(() => {
    setTimeout(connectKeepalive, 1000);
  });
}
connectKeepalive();

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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void tryAutoLogin());
} else {
  void tryAutoLogin();
}
