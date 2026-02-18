import { api } from './api';
import { getErrorMessage } from './utils';

export async function postCurrentStatus(): Promise<void> {
  try {
    const stored = await api.storage.local.get(['connectionStatus', 'edaUrl']);
    window.postMessage({
      type: 'eda-pong',
      status: stored.connectionStatus ?? 'disconnected',
      edaUrl: stored.edaUrl ?? '',
    }, '*');
  } catch {
    window.postMessage({ type: 'eda-pong', status: 'disconnected', edaUrl: '' }, '*');
  }
}

export async function handlePageMessage(event: MessageEvent): Promise<void> {
  if (event.source !== window) return;

  if (event.data?.type === 'eda-ping') {
    await postCurrentStatus();
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
        body: getErrorMessage(err),
      }, '*');
    }
  }
}

export async function handleStorageChange(
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
): Promise<void> {
  if (changes.connectionStatus || changes.edaUrl) {
    const stored = await api.storage.local.get(['connectionStatus', 'edaUrl']);
    window.postMessage({
      type: 'eda-status-changed',
      status: stored.connectionStatus ?? 'disconnected',
      edaUrl: stored.edaUrl ?? '',
    }, '*');
  }
}
