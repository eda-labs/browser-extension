import { api } from './api';
import { type ProxyResponse } from './types';

export const tabIdByOrigin = new Map<string, number>();
export const tabOpenedAtByOrigin = new Map<string, number>();
const TRANSPORT_TAB_REOPEN_COOLDOWN_MS = 15000;

function normalizeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function asProxyResponse(value: unknown): ProxyResponse | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.ok !== 'boolean' ||
    typeof raw.status !== 'number' ||
    typeof raw.body !== 'string'
  ) {
    return null;
  }
  return {
    ok: raw.ok,
    status: raw.status,
    body: raw.body,
  };
}

export async function doDirectFetch(
  url: string,
  method: string,
  headers: Record<string, string> | undefined,
  body: string | undefined,
): Promise<ProxyResponse> {
  const res = await fetch(url, {
    method,
    headers,
    body,
  });
  return {
    ok: res.ok,
    status: res.status,
    body: await res.text(),
  };
}

async function discoverTransportTab(origin: string): Promise<number | null> {
  let tabs: Array<{ id?: number; url?: string }>;
  try {
    tabs = await api.tabs.query({ url: origin + '/*' });
  } catch {
    return null;
  }

  for (const tab of tabs) {
    if (typeof tab.id !== 'number') continue;
    try {
      const ping = await api.tabs.sendMessage(tab.id, { type: 'eda-tab-ping' });
      if (ping && ping.ok === true) {
        tabIdByOrigin.set(origin, tab.id);
        return tab.id;
      }
    } catch {
      // content script not loaded in this tab, try next
    }
  }
  return null;
}

export async function doTabFetchFallback(
  edaUrl: string,
  url: string,
  method: string,
  headers: Record<string, string> | undefined,
  body: string | undefined,
): Promise<ProxyResponse | null> {
  const origin = normalizeOrigin(edaUrl);
  if (!origin) return null;

  let tabId = tabIdByOrigin.get(origin);

  if (tabId == null) {
    tabId = (await discoverTransportTab(origin)) ?? undefined;
    if (tabId == null) return null;
  }

  try {
    const rawResponse = await api.tabs.sendMessage(tabId, {
      type: 'eda-tab-fetch',
      url,
      method,
      headers,
      body,
    });
    return asProxyResponse(rawResponse);
  } catch {
    // Known tab failed — try to discover a different one
    tabIdByOrigin.delete(origin);
    const recoveredId = await discoverTransportTab(origin);
    if (recoveredId == null) return null;

    try {
      const rawResponse = await api.tabs.sendMessage(recoveredId, {
        type: 'eda-tab-fetch',
        url,
        method,
        headers,
        body,
      });
      return asProxyResponse(rawResponse);
    } catch {
      return null;
    }
  }
}

export async function doFetchWithTlsFallback(
  edaUrl: string,
  url: string,
  method: string,
  headers: Record<string, string> | undefined,
  body: string | undefined,
): Promise<ProxyResponse> {
  try {
    return await doDirectFetch(url, method, headers, body);
  } catch {
    const fallback = await doTabFetchFallback(edaUrl, url, method, headers, body);
    if (fallback) return fallback;
    throw new Error('TLS_CERT_ERROR');
  }
}

function buildTlsBootstrapUrl(edaUrl: string): string {
  return edaUrl.replace(/\/+$/, '') + '/';
}

export async function ensureTransportTab(edaUrl: string): Promise<{ opened: boolean; pending?: boolean }> {
  const origin = normalizeOrigin(edaUrl);
  if (!origin) throw new Error('Invalid EDA URL');

  const knownTabId = tabIdByOrigin.get(origin);
  if (knownTabId != null) {
    try {
      const ping = await api.tabs.sendMessage(knownTabId, { type: 'eda-tab-ping' });
      if (ping.ok === true) {
        return { opened: false };
      }
    } catch {
      const openedAt = tabOpenedAtByOrigin.get(origin) ?? 0;
      if (Date.now() - openedAt < TRANSPORT_TAB_REOPEN_COOLDOWN_MS) {
        return { opened: false, pending: true };
      }
      tabIdByOrigin.delete(origin);
    }
  }

  const tab = await api.tabs.create({
    url: buildTlsBootstrapUrl(edaUrl),
    active: false,
  });
  if (typeof tab?.id === 'number') {
    tabIdByOrigin.set(origin, tab.id);
    tabOpenedAtByOrigin.set(origin, Date.now());
  }
  return { opened: true };
}
