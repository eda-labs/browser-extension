import { api } from './core/api';
import { postCurrentStatus, handlePageMessage, handleStorageChange } from './core/handlers';

window.addEventListener('message', (event: MessageEvent) => void handlePageMessage(event));

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
