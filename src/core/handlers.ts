import { api } from './api';
import { getErrorMessage } from './utils';

const PAGE_TARGET_ORIGIN = window.location.origin === 'null' ? '*' : window.location.origin;
const ALLOWED_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function postToPage(message: Record<string, unknown>): void {
  window.postMessage(message, PAGE_TARGET_ORIGIN);
}

export async function postCurrentStatus(): Promise<void> {
  try {
    const stored = await api.storage.local.get(['connectionStatus', 'edaUrl']);
    postToPage({
      type: 'eda-pong',
      status: stored.connectionStatus ?? 'disconnected',
      edaUrl: stored.edaUrl ?? '',
    });
  } catch {
    postToPage({ type: 'eda-pong', status: 'disconnected', edaUrl: '' });
  }
}

export async function handlePageMessage(event: MessageEvent): Promise<void> {
  if (event.source !== window) return;
  if (window.location.origin !== 'null' && event.origin !== window.location.origin) return;
  if (!event.data || typeof event.data !== 'object') return;

  const data = event.data as Record<string, unknown>;

  if (data.type === 'eda-ping') {
    await postCurrentStatus();
    return;
  }

  if (data.type === 'eda-request') {
    const id = data.id;
    const path = typeof data.path === 'string' ? data.path : '';
    const methodRaw = typeof data.method === 'string' ? data.method.toUpperCase() : 'GET';
    const method = ALLOWED_HTTP_METHODS.has(methodRaw) ? methodRaw : 'GET';
    const headers = data.headers && typeof data.headers === 'object' && !Array.isArray(data.headers)
      ? data.headers as Record<string, string>
      : undefined;
    const body = typeof data.body === 'string' ? data.body : undefined;
    const channel = typeof data.channel === 'string' ? data.channel : undefined;
    if (!path || !path.startsWith('/')) {
      postToPage({
        type: 'eda-response',
        id,
        channel,
        ok: false,
        status: 0,
        body: 'Invalid path for eda-request',
      });
      return;
    }

    try {
      const response = await api.runtime.sendMessage({
        type: 'eda-request',
        requestOrigin: window.location.origin,
        channel,
        path,
        method,
        headers,
        body,
      });
      postToPage({ type: 'eda-response', id, channel, ...response });
    } catch (err) {
      postToPage({
        type: 'eda-response',
        id,
        channel,
        ok: false,
        status: 0,
        body: getErrorMessage(err),
      });
    }
  }
}

export async function handleStorageChange(
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
): Promise<void> {
  if (changes.connectionStatus || changes.edaUrl) {
    const stored = await api.storage.local.get(['connectionStatus', 'edaUrl']);
    postToPage({
      type: 'eda-status-changed',
      status: stored.connectionStatus ?? 'disconnected',
      edaUrl: stored.edaUrl ?? '',
    });
  }
}
