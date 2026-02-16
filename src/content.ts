import { api } from './types';

window.addEventListener('message', async (event: MessageEvent) => {
  if (event.source !== window) return;

  if (event.data?.type === 'eda-ping') {
    try {
      const status = await api.runtime.sendMessage({ type: 'eda-get-status' });
      window.postMessage({ type: 'eda-pong', ...status }, '*');
    } catch {
      window.postMessage({ type: 'eda-pong', status: 'disconnected', edaUrl: '' }, '*');
    }
    return;
  }

  if (event.data?.type === 'eda-request') {
    const { id, path, method, headers, body } = event.data;

    try {
      const response = await api.runtime.sendMessage({
        type: 'eda-request',
        path,
        method,
        headers,
        body,
      });
      window.postMessage({ type: 'eda-response', id, ...response }, '*');
    } catch (err) {
      window.postMessage({
        type: 'eda-response',
        id,
        ok: false,
        status: 0,
        body: err instanceof Error ? err.message : String(err),
      }, '*');
    }
  }
});

// Announce presence on load
(async () => {
  try {
    const status = await api.runtime.sendMessage({ type: 'eda-get-status' });
    window.postMessage({ type: 'eda-pong', ...status }, '*');
  } catch {
    window.postMessage({ type: 'eda-pong', status: 'disconnected', edaUrl: '' }, '*');
  }
})();

// Forward status changes from background to page
api.runtime.onMessage.addListener((message) => {
  if (message.type === 'eda-status-update') {
    window.postMessage({
      type: 'eda-status-changed',
      status: message.status,
      edaUrl: message.edaUrl,
    }, '*');
  }
});
