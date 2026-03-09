const APPS_REQUEST_MSG = 'eda-ext-fetch-apps';
const APPS_RESPONSE_MSG = 'eda-ext-apps-response';
const EQL_REQUEST_MSG = 'eda-ext-eql-request';
const EQL_RESPONSE_MSG = 'eda-ext-eql-response';
const EQL_AUTOCOMPLETE_REQUEST_MSG = 'eda-ext-eql-autocomplete-request';
const EQL_AUTOCOMPLETE_RESPONSE_MSG = 'eda-ext-eql-autocomplete-response';
const BRIDGE_READY_MSG = 'eda-ext-bridge-ready';

interface ParsedKind {
  plural: string;
  kind: string;
  label: string;
  category: string;
  panel: string;
  group: string;
  version: string;
  namespaced?: boolean;
  isWorkflow?: boolean;
}

interface AppsGroup {
  name?: string;
  preferredVersion?: { version?: string };
  versions?: Array<{ version?: string } | string>;
}

type SpotlightWindow = Window & {
  __edaExtSpotlightState?: {
    token: string;
    cachedItems: ParsedKind[];
    lastFetchTs: number;
    fetching: boolean;
  };
};

const CACHE_TTL_MS = 60_000;

function post(type: string, payload: Record<string, unknown>): void {
  window.postMessage({ type, ...payload }, '*');
}

function getState(): NonNullable<SpotlightWindow['__edaExtSpotlightState']> {
  const w = window as SpotlightWindow;
  if (!w.__edaExtSpotlightState) {
    w.__edaExtSpotlightState = {
      token: '',
      cachedItems: [],
      lastFetchTs: 0,
      fetching: false,
    };
  }
  return w.__edaExtSpotlightState;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

function checkAccess(
  openApiPaths: Record<string, unknown>,
  group: string,
  version: string,
  plural: string,
  namespaced: boolean,
  isWorkflow: boolean,
): 'None' | 'Read' | 'ReadWrite' {
  let access: 'None' | 'Read' | 'ReadWrite' = 'None';

  const base = isWorkflow
    ? `/workflows/v1/${group}/${version}/${plural}`
    : `/apps/${group}/${version}${namespaced ? '/[^/]+' : ''}/${plural}`;

  let re: RegExp;
  try {
    re = new RegExp(`^${base}(/.+)?$`);
  } catch {
    return 'None';
  }

  for (const [path, methods] of Object.entries(openApiPaths)) {
    if (!re.test(path)) continue;
    if (!methods || typeof methods !== 'object') continue;
    for (const method of Object.keys(methods as Record<string, unknown>)) {
      const normalized = method.toLowerCase();
      if (normalized !== 'get') access = 'ReadWrite';
      else if (access === 'None') access = 'Read';
    }
  }

  return access;
}

function toHeadersList(headers: HeadersInit | undefined): Array<[string, string]> {
  if (!headers) return [];
  if (headers instanceof Headers) {
    const out: Array<[string, string]> = [];
    headers.forEach((value, key) => {
      out.push([key, value]);
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return headers
      .map((entry) => [String(entry[0]), String(entry[1])] as [string, string]);
  }
  return Object.entries(headers).map(([key, value]) => [key, String(value)]);
}

function captureTokenFromHeaders(headers: HeadersInit | undefined): void {
  const state = getState();
  for (const [name, value] of toHeadersList(headers)) {
    if (name.toLowerCase() !== 'authorization') continue;
    if (!value.startsWith('Bearer ')) continue;
    const token = value.slice(7).trim();
    if (!token) continue;
    if (token === state.token) return;
    state.token = token;
    state.cachedItems = [];
    state.lastFetchTs = 0;
    void fetchAllResources(true);
    return;
  }
}

function patchXhr(): void {
  const proto = XMLHttpRequest.prototype as unknown as {
    setRequestHeader: (name: string, value: string) => void;
    __edaExtSpotlightPatched?: boolean;
  };

  if (proto.__edaExtSpotlightPatched) return;

  const originalSetRequestHeader = proto.setRequestHeader;
  proto.setRequestHeader = function patchedSetRequestHeader(name: string, value: string): void {
    captureTokenFromHeaders([[name, value]]);
    originalSetRequestHeader.call(this, name, value);
  };
  proto.__edaExtSpotlightPatched = true;
}

function patchFetch(): void {
  const w = window as Window & { __edaExtSpotlightFetchPatched?: boolean };
  if (w.__edaExtSpotlightFetchPatched) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    captureTokenFromHeaders(init?.headers);
    if (input instanceof Request) {
      captureTokenFromHeaders(input.headers);
    }
    return originalFetch(input, init);
  };
  w.__edaExtSpotlightFetchPatched = true;
}

async function fetchJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`${url} failed (${response.status})`);
  }
  return response.json();
}

function pickVersion(group: AppsGroup): string | null {
  if (typeof group.preferredVersion?.version === 'string' && group.preferredVersion.version) {
    return group.preferredVersion.version;
  }
  const first = group.versions?.[0];
  if (typeof first === 'string' && first) return first;
  if (first && typeof first === 'object' && typeof first.version === 'string' && first.version) {
    return first.version;
  }
  return null;
}

async function fetchGroupItems(groupName: string, version: string, token: string): Promise<ParsedKind[]> {
  const encodedGroup = encodeURIComponent(groupName);
  const encodedVersion = encodeURIComponent(version);

  const [resourceListRaw, openApiRaw] = await Promise.all([
    fetchJson(`/apps/${encodedGroup}/${encodedVersion}`, token).catch(() => null),
    fetchJson(`/openapi/v3/apps/${encodedGroup}/${encodedVersion}`, token).catch(() => null),
  ]);

  if (!resourceListRaw || typeof resourceListRaw !== 'object') return [];
  const resources = (resourceListRaw as { resources?: unknown }).resources;
  if (!Array.isArray(resources)) return [];

  const paths = (
    openApiRaw && typeof openApiRaw === 'object'
      ? (openApiRaw as { paths?: unknown }).paths
      : {}
  );
  const openApiPaths = (paths && typeof paths === 'object' ? paths : {}) as Record<string, unknown>;

  const out: ParsedKind[] = [];
  for (const resource of resources) {
    if (!resource || typeof resource !== 'object') continue;
    const item = resource as Record<string, unknown>;
    const plural = typeof item.name === 'string' ? item.name : '';
    if (!plural || plural.includes('/')) continue;

    const kind = typeof item.kind === 'string' && item.kind ? item.kind : plural;
    const namespaced = Boolean(item.namespaced);

    const access = checkAccess(openApiPaths, groupName, version, plural, namespaced, false);
    if (access !== 'None') {
      out.push({
        plural,
        kind,
        label: kind,
        category: '',
        panel: 'main',
        group: groupName,
        version,
        namespaced,
        isWorkflow: false,
      });
    }

    const workflowAccess = checkAccess(openApiPaths, groupName, version, plural, namespaced, true);
    if (workflowAccess !== 'None') {
      out.push({
        plural,
        kind,
        label: kind,
        category: '',
        panel: 'main',
        group: groupName,
        version,
        namespaced,
        isWorkflow: true,
      });
    }
  }
  return out;
}

async function fetchAllResources(force: boolean): Promise<void> {
  const state = getState();

  if (!state.token) return;
  if (state.fetching) return;

  const now = Date.now();
  if (!force && state.cachedItems.length > 0 && now - state.lastFetchTs < CACHE_TTL_MS) {
    post(APPS_RESPONSE_MSG, { data: state.cachedItems, cached: true });
    return;
  }

  state.fetching = true;
  try {
    const appsRaw = await fetchJson('/apps', state.token);
    const groups = (
      appsRaw && typeof appsRaw === 'object'
        ? (appsRaw as { groups?: unknown }).groups
        : []
    );
    if (!Array.isArray(groups)) {
      throw new Error('Unexpected /apps response');
    }

    const groupResults = await Promise.all(groups.map(async (groupRaw) => {
      if (!groupRaw || typeof groupRaw !== 'object') return [];
      const group = groupRaw as AppsGroup;
      const groupName = typeof group.name === 'string' ? group.name : '';
      const version = pickVersion(group);
      if (!groupName || !version) return [];
      return fetchGroupItems(groupName, version, state.token).catch(() => []);
    }));

    const flattened = groupResults.flat();
    state.cachedItems = flattened;
    state.lastFetchTs = Date.now();
    post(APPS_RESPONSE_MSG, { data: flattened });
  } catch (err) {
    post(APPS_RESPONSE_MSG, {
      data: state.cachedItems,
      error: getErrorMessage(err),
    });
  } finally {
    state.fetching = false;
  }
}

async function runEqlQuery(query: string, reqId: number): Promise<void> {
  const state = getState();
  if (!state.token) {
    post(EQL_RESPONSE_MSG, { reqId, error: 'Waiting for EDA auth token' });
    return;
  }

  try {
    const params = new URLSearchParams({ query });
    const response = await fetch(`/core/query/v1/eql?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
      credentials: 'same-origin',
    });

    if (!response.ok) {
      throw new Error(`EQL query failed (${response.status})`);
    }

    const data = await response.json();
    post(EQL_RESPONSE_MSG, { reqId, data });
  } catch (err) {
    post(EQL_RESPONSE_MSG, {
      reqId,
      error: getErrorMessage(err),
    });
  }
}

async function runEqlAutocomplete(query: string, reqId: number, completionLimit: number): Promise<void> {
  const state = getState();
  if (!state.token) {
    post(EQL_AUTOCOMPLETE_RESPONSE_MSG, { reqId, error: 'Waiting for EDA auth token' });
    return;
  }

  try {
    const params = new URLSearchParams({
      query,
      completion_limit: String(completionLimit > 0 ? completionLimit : 10),
    });
    const response = await fetch(`/core/query/v1/eql/autocomplete?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
      credentials: 'same-origin',
    });

    if (!response.ok) {
      throw new Error(`EQL autocomplete failed (${response.status})`);
    }

    const data = await response.json();
    post(EQL_AUTOCOMPLETE_RESPONSE_MSG, { reqId, data });
  } catch (err) {
    post(EQL_AUTOCOMPLETE_RESPONSE_MSG, {
      reqId,
      error: getErrorMessage(err),
    });
  }
}

function setupMessageBridge(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    if (!event.data || typeof event.data !== 'object') return;

    const data = event.data as Record<string, unknown>;
    if (data.type === APPS_REQUEST_MSG) {
      void fetchAllResources(Boolean(data.force));
      return;
    }

    if (data.type === EQL_REQUEST_MSG) {
      const query = typeof data.query === 'string' ? data.query : '';
      const reqId = typeof data.reqId === 'number' ? data.reqId : 0;
      void runEqlQuery(query, reqId);
      return;
    }

    if (data.type === EQL_AUTOCOMPLETE_REQUEST_MSG) {
      const query = typeof data.query === 'string' ? data.query : '';
      const reqId = typeof data.reqId === 'number' ? data.reqId : 0;
      const completionLimit = typeof data.completionLimit === 'number' ? data.completionLimit : 10;
      void runEqlAutocomplete(query, reqId, completionLimit);
    }
  });
}

patchXhr();
patchFetch();
setupMessageBridge();
post(BRIDGE_READY_MSG, { ok: true });
