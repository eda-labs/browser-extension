import { api } from './core/api';
import {
  type EdaState,
  type StoredConfig,
  type ConnectResult,
  type ProxyResponse,
  type TargetProfile,
} from './core/types';
import { getErrorMessage } from './core/utils';
import { tabIdByOrigin, tabOpenedAtByOrigin, doDirectFetch, doTabFetchFallback, ensureTransportTab } from './core/fetch';
import { decodeJwtExp, fetchToken, fetchClientSecret } from './core/auth';
import { initKeepalive, stopKeepalive } from './core/keepalive';

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

initKeepalive();

function persistStatus(): void {
  void api.storage.local.set({
    connectionStatus: state.status,
    activeTargetId: state.activeTargetId,
  });
}

function scheduleRefresh(): void {
  if (state.refreshTimerId) clearTimeout(state.refreshTimerId);
  const delay = Math.max(0, state.accessTokenExpiresAt - Date.now() - 30000);
  state.refreshTimerId = setTimeout(() => void refreshAccessToken(), delay);
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
    return { ok: false, error: getErrorMessage(err) };
  }
}

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
    return { ok: false, status: 0, body: getErrorMessage(err) };
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
        return { ok: false, error: getErrorMessage(err) };
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
        return { ok: false, error: getErrorMessage(err) };
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
    sendResponse({ ok: false, error: getErrorMessage(err) });
  });
  return true;
});

const restorePromise = migrateStorage().then(() => restoreSession());
