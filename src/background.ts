import {
  api,
  type EdaState,
  type StoredConfig,
  type TokenResponse,
  type ConnectResult,
  type ProxyResponse,
  type TargetProfile,
} from './types';

let state: EdaState = {
  status: 'disconnected',
  edaUrl: '',
  accessToken: null,
  refreshToken: null,
  clientSecret: null,
  accessTokenExpiresAt: 0,
  refreshTimerId: null,
  activeTargetId: null,
};

async function getTargets(): Promise<TargetProfile[]> {
  const stored = await api.storage.local.get(['targets']);
  return (stored.targets as TargetProfile[] | undefined) ?? [];
}

async function saveTarget(target: TargetProfile): Promise<void> {
  const targets = await getTargets();
  const idx = targets.findIndex((t) => t.id === target.id);
  if (idx >= 0) {
    targets[idx] = target;
  } else {
    targets.push(target);
  }
  await api.storage.local.set({ targets });
}

async function deleteTarget(targetId: string): Promise<void> {
  if (state.activeTargetId === targetId) {
    disconnect();
  }
  const targets = await getTargets();
  await api.storage.local.set({ targets: targets.filter((t) => t.id !== targetId) });
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Token request failed (' + res.status + '): ' + text);
  }
  return res.json() as Promise<TokenResponse>;
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

  const clientsRes = await fetch(
    base + '/admin/realms/eda/clients?clientId=eda',
    { headers: authHeader },
  );
  if (!clientsRes.ok) {
    const text = await clientsRes.text();
    throw new Error('Failed to list Keycloak clients (' + clientsRes.status + '): ' + text);
  }
  const clients = await clientsRes.json() as Array<{ id: string }>;
  if (!clients.length) {
    throw new Error('Keycloak client "eda" not found – check privileges');
  }
  const clientUuid = clients[0].id;

  const secretRes = await fetch(
    base + '/admin/realms/eda/clients/' + clientUuid + '/client-secret',
    { headers: authHeader },
  );
  if (!secretRes.ok) {
    const text = await secretRes.text();
    throw new Error('Failed to fetch client secret (' + secretRes.status + '): ' + text);
  }
  const secretData = await secretRes.json() as { value: string };
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
  broadcastStatus();

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
    });

    scheduleRefresh();
    broadcastStatus();
    return { ok: true };
  } catch (err) {
    state.status = 'error';
    state.accessToken = null;
    state.refreshToken = null;
    state.activeTargetId = null;
    broadcastStatus();
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

function disconnect(): void {
  if (state.refreshTimerId) clearTimeout(state.refreshTimerId);
  state = {
    status: 'disconnected',
    edaUrl: '',
    accessToken: null,
    refreshToken: null,
    clientSecret: null,
    accessTokenExpiresAt: 0,
    refreshTimerId: null,
    activeTargetId: null,
  };
  void api.storage.local.remove(['edaUrl', 'clientSecret', 'accessToken', 'refreshToken', 'accessTokenExpiresAt', 'activeTargetId']);
  broadcastStatus();
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

  if (Date.now() < state.accessTokenExpiresAt) {
    state.status = 'connected';
    scheduleRefresh();
  } else {
    await refreshAccessToken();
    if (state.accessToken) {
      state.status = 'connected';
    }
  }
}

async function migrateStorage(): Promise<void> {
  const stored = await api.storage.local.get(['edaUrl', 'targets']);
  if (stored.edaUrl && !stored.targets) {
    const target: TargetProfile = {
      id: crypto.randomUUID(),
      edaUrl: stored.edaUrl as string,
      username: '',
      clientSecret: '',
    };
    await api.storage.local.set({
      targets: [target],
      activeTargetId: target.id,
    });
  }
}

function broadcastStatus(): void {
  api.runtime.sendMessage({
    type: 'eda-status-update',
    status: state.status,
    edaUrl: state.edaUrl,
    activeTargetId: state.activeTargetId,
  }).catch(() => {});
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
    const res = await fetch(url, {
      method: method ?? 'GET',
      headers: reqHeaders,
      body: body ?? undefined,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (err) {
    return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
  }
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'eda-connect') {
    void connect(
      message.targetId as string,
      message.edaUrl as string,
      message.username as string,
      message.password as string,
      message.clientSecret as string,
    ).then(sendResponse);
    return true;
  }

  if (message.type === 'eda-disconnect') {
    disconnect();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'eda-get-status') {
    sendResponse({ status: state.status, edaUrl: state.edaUrl, activeTargetId: state.activeTargetId });
    return false;
  }

  if (message.type === 'eda-get-targets') {
    void getTargets().then((targets) => {
      sendResponse({ targets, activeTargetId: state.activeTargetId });
    });
    return true;
  }

  if (message.type === 'eda-save-target') {
    void saveTarget(message.target as TargetProfile).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'eda-delete-target') {
    void deleteTarget(message.targetId as string).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'eda-fetch-client-secret') {
    void fetchClientSecret(
      message.edaUrl as string,
      message.username as string,
      message.password as string,
    ).then((secret) => {
      sendResponse({ ok: true, clientSecret: secret });
    }).catch((err) => {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });
    return true;
  }

  if (message.type === 'eda-request') {
    void handleRequest(
      message.path as string,
      message.method as string | undefined,
      message.headers as Record<string, string> | undefined,
      message.body as string | undefined,
    ).then(sendResponse);
    return true;
  }

  if (message.type === 'eda-get-config') {
    void api.storage.local.get(['edaUrl']).then((stored) => {
      sendResponse({
        edaUrl: (stored.edaUrl as string) ?? '',
      });
    });
    return true;
  }

  return false;
});

void migrateStorage().then(() => restoreSession());
