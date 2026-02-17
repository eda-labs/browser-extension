import { api } from './core/api';
import {
  type EdaState,
  type StoredConfig,
  type TokenResponse,
  type ConnectResult,
  type ProxyResponse,
  type TargetProfile,
} from './core/types';

let state: EdaState = {
  status: 'disconnected',
  edaUrl: '',
  accessToken: null,
  refreshToken: null,
  clientSecret: null,
  accessTokenExpiresAt: 0,
  refreshTimerId: null,
  activeTargetId: null,
  username: null,
  password: null,
};

const tabIdByOrigin = new Map<string, number>();
const tabOpenedAtByOrigin = new Map<string, number>();
const TRANSPORT_TAB_REOPEN_COOLDOWN_MS = 15000;

function normalizeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function parseJson<T>(text: string, errorMessage: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(errorMessage);
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

async function doDirectFetch(
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

async function doTabFetchFallback(
  edaUrl: string,
  url: string,
  method: string,
  headers: Record<string, string> | undefined,
  body: string | undefined,
): Promise<ProxyResponse | null> {
  const origin = normalizeOrigin(edaUrl);
  if (!origin) return null;

  const tabId = tabIdByOrigin.get(origin);
  if (tabId == null) return null;

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
    return null;
  }
}

async function doFetchWithTlsFallback(
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

async function ensureTransportTab(edaUrl: string): Promise<{ opened: boolean; pending?: boolean }> {
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

function decodeJwtExp(jwt: string): number {
  const parts = jwt.split('.');
  if (parts.length !== 3) return 0;
  const payload: { exp?: number } = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  return (payload.exp ?? 0) * 1000;
}

async function fetchToken(edaUrl: string, realmPath: string, params: Record<string, string>): Promise<TokenResponse> {
  const url = edaUrl.replace(/\/+$/, '') +
    '/core/httpproxy/v1/keycloak/realms/' + realmPath + '/protocol/openid-connect/token';
  const response = await doFetchWithTlsFallback(
    edaUrl,
    url,
    'POST',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    new URLSearchParams(params).toString(),
  );

  if (!response.ok) {
    throw new Error('Token request failed (' + response.status + '): ' + response.body);
  }

  return parseJson<TokenResponse>(response.body, 'Invalid token response payload');
}

async function fetchKeycloakToken(edaUrl: string, username: string, password: string): Promise<string> {
  const data = await fetchToken(edaUrl, 'master', {
    grant_type: 'password',
    client_id: 'admin-cli',
    username,
    password,
  });
  return data.access_token;
}

async function fetchClientSecret(edaUrl: string, username: string, password: string): Promise<string> {
  const base = edaUrl.replace(/\/+$/, '') + '/core/httpproxy/v1/keycloak';
  const kcToken = await fetchKeycloakToken(edaUrl, username, password);
  const authHeader = { Authorization: 'Bearer ' + kcToken };

  const clientsResponse = await doFetchWithTlsFallback(
    edaUrl,
    base + '/admin/realms/eda/clients?clientId=eda',
    'GET',
    authHeader,
    undefined,
  );
  if (!clientsResponse.ok) {
    throw new Error('Failed to list Keycloak clients (' + clientsResponse.status + '): ' + clientsResponse.body);
  }
  const clients = parseJson<Array<{ id: string }>>(
    clientsResponse.body,
    'Invalid Keycloak client list response',
  );
  if (!clients.length) {
    throw new Error('Keycloak client "eda" not found – check privileges');
  }
  const clientUuid = clients[0].id;

  const secretResponse = await doFetchWithTlsFallback(
    edaUrl,
    base + '/admin/realms/eda/clients/' + clientUuid + '/client-secret',
    'GET',
    authHeader,
    undefined,
  );
  if (!secretResponse.ok) {
    throw new Error('Failed to fetch client secret (' + secretResponse.status + '): ' + secretResponse.body);
  }
  const secretData = parseJson<{ value: string }>(
    secretResponse.body,
    'Invalid Keycloak secret response',
  );
  return secretData.value;
}

async function connect(
  targetId: string,
  edaUrl: string,
  username: string,
  password: string,
  clientSecret: string,
): Promise<ConnectResult> {
  if (state.activeTargetId && state.activeTargetId !== targetId) {
    disconnect();
  }

  state.status = 'connecting';
  state.edaUrl = edaUrl;
  state.activeTargetId = targetId;
  persistStatus();

  try {
    state.clientSecret = clientSecret;

    const data = await fetchToken(edaUrl, 'eda', {
      grant_type: 'password',
      client_id: 'eda',
      client_secret: clientSecret,
      username,
      password,
      scope: 'openid',
    });

    state.status = 'connected';
    state.username = username;
    state.password = password;
    state.accessToken = data.access_token;
    state.refreshToken = data.refresh_token;
    state.accessTokenExpiresAt = decodeJwtExp(data.access_token);

    await api.storage.local.set({
      edaUrl,
      clientSecret,
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      accessTokenExpiresAt: state.accessTokenExpiresAt,
      activeTargetId: targetId,
      connectionStatus: state.status,
    });

    scheduleRefresh();
    startKeepalive();
    return { ok: true };
  } catch (err) {
    state.status = 'error';
    state.accessToken = null;
    state.refreshToken = null;
    state.activeTargetId = null;
    await api.storage.local.set({
      connectionStatus: state.status,
      activeTargetId: state.activeTargetId,
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function refreshAccessToken(): Promise<void> {
  if (!state.refreshToken || !state.clientSecret) {
    disconnect();
    return;
  }

  try {
    const data = await fetchToken(state.edaUrl, 'eda', {
      grant_type: 'refresh_token',
      client_id: 'eda',
      client_secret: state.clientSecret,
      refresh_token: state.refreshToken,
    });

    state.accessToken = data.access_token;
    state.refreshToken = data.refresh_token;
    state.accessTokenExpiresAt = decodeJwtExp(data.access_token);

    await api.storage.local.set({
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      accessTokenExpiresAt: state.accessTokenExpiresAt,
    });

    scheduleRefresh();
  } catch {
    disconnect();
  }
}

function scheduleRefresh(): void {
  if (state.refreshTimerId) clearTimeout(state.refreshTimerId);
  const delay = Math.max(0, state.accessTokenExpiresAt - Date.now() - 30000);
  state.refreshTimerId = setTimeout(() => void refreshAccessToken(), delay);
}

// Chrome enforces minimum alarm periods; 1 minute is broadly supported across Chromium releases.
const KEEPALIVE_ALARM_PERIOD_MINUTES = 1;

function startKeepalive(): void {
  api.alarms.create('keepalive', { periodInMinutes: KEEPALIVE_ALARM_PERIOD_MINUTES });
}

function stopKeepalive(): void {
  api.alarms.clear('keepalive');
}

api.alarms.onAlarm.addListener(() => { /* wake up */ });

function disconnect(): void {
  if (state.refreshTimerId) clearTimeout(state.refreshTimerId);
  stopKeepalive();
  state = {
    status: 'disconnected',
    edaUrl: '',
    accessToken: null,
    refreshToken: null,
    clientSecret: null,
    accessTokenExpiresAt: 0,
    refreshTimerId: null,
    activeTargetId: null,
    username: null,
    password: null,
  };
  void api.storage.local.remove(['edaUrl', 'clientSecret', 'accessToken', 'refreshToken', 'accessTokenExpiresAt', 'activeTargetId', 'connectionStatus']);
  persistStatus();
}

async function restoreSession(): Promise<void> {
  const stored = await api.storage.local.get([
    'edaUrl', 'clientSecret', 'accessToken', 'refreshToken', 'accessTokenExpiresAt', 'activeTargetId',
  ]) as StoredConfig & { activeTargetId?: string };

  if (!stored.accessToken || !stored.refreshToken || !stored.edaUrl || !stored.clientSecret) return;

  state.edaUrl = stored.edaUrl;
  state.clientSecret = stored.clientSecret;
  state.accessToken = stored.accessToken;
  state.refreshToken = stored.refreshToken;
  state.accessTokenExpiresAt = stored.accessTokenExpiresAt ?? 0;
  state.activeTargetId = stored.activeTargetId ?? null;

  const targetStore = await api.storage.local.get(['targets']);
  const targets = (targetStore.targets as TargetProfile[] | undefined) ?? [];
  const activeTarget = targets.find((t) => t.id === state.activeTargetId);
  if (activeTarget) {
    state.username = activeTarget.username;
    state.password = activeTarget.password;
  }

  if (Date.now() < state.accessTokenExpiresAt) {
    state.status = 'connected';
    scheduleRefresh();
  } else {
    await refreshAccessToken();
    if (state.accessToken) {
      state.status = 'connected';
    }
  }
  if (state.status === 'connected') startKeepalive();
  persistStatus();
}

async function migrateStorage(): Promise<void> {
  const stored = await api.storage.local.get(['edaUrl', 'targets']);
  if (stored.edaUrl && !stored.targets) {
    const target: TargetProfile = {
      id: crypto.randomUUID(),
      edaUrl: stored.edaUrl as string,
      username: '',
      password: '',
      clientSecret: '',
    };
    await api.storage.local.set({
      targets: [target],
      activeTargetId: target.id,
    });
  }
}

function persistStatus(): void {
  void api.storage.local.set({
    connectionStatus: state.status,
    activeTargetId: state.activeTargetId,
  });
}

async function handleRequest(
  path: string,
  method: string | undefined,
  headers: Record<string, string> | undefined,
  body: string | undefined,
): Promise<ProxyResponse> {
  if (state.status !== 'connected' || !state.accessToken) {
    return { ok: false, status: 0, body: 'Not connected to EDA' };
  }

  const url = state.edaUrl.replace(/\/+$/, '') + path;
  const reqHeaders = { ...headers, Authorization: 'Bearer ' + state.accessToken };

  try {
    return await doDirectFetch(
      url,
      method ?? 'GET',
      reqHeaders,
      body ?? undefined,
    );
  } catch (err) {
    const fallback = await doTabFetchFallback(
      state.edaUrl,
      url,
      method ?? 'GET',
      reqHeaders,
      body ?? undefined,
    );
    if (fallback) return fallback;
    return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
  }
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  async function handleMessage(): Promise<unknown> {
    if (message.type === 'eda-tab-ready') {
      const origin = typeof message.origin === 'string' ? message.origin : '';
      const tabId = sender.tab?.id;
      if (origin && typeof tabId === 'number') {
        tabIdByOrigin.set(origin, tabId);
        tabOpenedAtByOrigin.set(origin, Date.now());
      }
      return { ok: true };
    }

    if (message.type === 'eda-open-transport-tab') {
      const edaUrl = typeof message.edaUrl === 'string' ? message.edaUrl : '';
      if (!edaUrl) return { ok: false, error: 'Missing edaUrl' };
      try {
        return { ok: true, ...await ensureTransportTab(edaUrl) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    if (message.type === 'eda-get-status') {
      return { status: state.status, edaUrl: state.edaUrl };
    }

    if (message.type === 'eda-get-credentials') {
      if (state.status === 'connected' && state.username && state.password) {
        return { ok: true, username: state.username, password: state.password };
      }
      return { ok: false };
    }

    if (message.type === 'eda-connect') {
      return connect(
        message.targetId as string,
        message.edaUrl as string,
        message.username as string,
        message.password as string,
        message.clientSecret as string,
      );
    }

    if (message.type === 'eda-disconnect') {
      disconnect();
      return { ok: true };
    }

    if (message.type === 'eda-fetch-client-secret') {
      try {
        const secret = await fetchClientSecret(
          message.edaUrl as string,
          message.username as string,
          message.password as string,
        );
        return { ok: true, clientSecret: secret };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    if (message.type === 'eda-request') {
      return handleRequest(
        message.path as string,
        message.method as string | undefined,
        message.headers as Record<string, string> | undefined,
        message.body as string | undefined,
      );
    }

    return { ok: false, error: 'Unknown message type' };
  }

  void restorePromise.then(() => handleMessage()).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  });
  return true;
});

const restorePromise = migrateStorage().then(() => restoreSession());
