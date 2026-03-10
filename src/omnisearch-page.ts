import { getErrorMessage } from './core/utils';
import {
  APPS_REQUEST_MSG,
  APPS_RESPONSE_MSG,
  BRIDGE_READY_MSG,
  EQL_AUTOCOMPLETE_REQUEST_MSG,
  EQL_AUTOCOMPLETE_RESPONSE_MSG,
  EQL_REQUEST_MSG,
  EQL_RESPONSE_MSG,
  OMNISEARCH_BRIDGE_CHANNEL,
} from './omnisearch/constants';
import {
  buildResourceEqlQueries,
  checkAccess,
  extractInstanceSearchText,
  extractItemName,
  extractItemNamespace,
  extractObjectArray,
  parseResponseBody,
  resourcePriority,
} from './omnisearch/page-helpers';
import type { AppsGroup, ParsedKind } from './omnisearch/types';

const PAGE_TARGET_ORIGIN = window.location.origin === 'null' ? '*' : window.location.origin;

type OmnisearchWindow = Window & {
  __edaExtOmnisearchState?: {
    token: string;
    cachedItems: ParsedKind[];
    lastFetchTs: number;
    fetching: boolean;
  };
};

const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const INSTANCE_RESOURCE_LIMIT = 220;
const INSTANCE_ITEMS_PER_RESOURCE = 250;
const INSTANCE_FETCH_CONCURRENCY = 6;
const INSTANCE_TOTAL_LIMIT = 8000;
const INSTANCE_EQL_QUERY_LIMIT = 1000;
const FAST_INSTANCE_RESOURCE_LIMIT = 20;
const SLOW_INSTANCE_RESOURCE_LIMIT = Math.max(0, INSTANCE_RESOURCE_LIMIT - FAST_INSTANCE_RESOURCE_LIMIT);
const FAST_INSTANCE_ITEMS_PER_RESOURCE = 80;
const FAST_INSTANCE_TOTAL_LIMIT = 1200;
const FAST_INSTANCE_EQL_QUERY_LIMIT = 120;
const FAST_INSTANCE_FETCH_CONCURRENCY = 12;

interface EdaResponsePayload {
  ok: boolean;
  status: number;
  body: unknown;
}

function post(type: string, payload: Record<string, unknown>): void {
  window.postMessage({ type, channel: OMNISEARCH_BRIDGE_CHANNEL, ...payload }, PAGE_TARGET_ORIGIN);
}

function getState(): NonNullable<OmnisearchWindow['__edaExtOmnisearchState']> {
  const w = window as OmnisearchWindow;
  if (!w.__edaExtOmnisearchState) {
    w.__edaExtOmnisearchState = {
      token: '',
      cachedItems: [],
      lastFetchTs: 0,
      fetching: false,
    };
  }
  return w.__edaExtOmnisearchState;
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
    if (!token || token === state.token) return;

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
    __edaExtOmnisearchPatched?: boolean;
  };

  if (proto.__edaExtOmnisearchPatched) return;

  const originalSetRequestHeader = proto.setRequestHeader;
  proto.setRequestHeader = function patchedSetRequestHeader(name: string, value: string): void {
    captureTokenFromHeaders([[name, value]]);
    originalSetRequestHeader.call(this, name, value);
  };
  proto.__edaExtOmnisearchPatched = true;
}

function patchFetch(): void {
  const w = window as Window & { __edaExtOmnisearchFetchPatched?: boolean };
  if (w.__edaExtOmnisearchFetchPatched) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    captureTokenFromHeaders(init?.headers);
    if (input instanceof Request) {
      captureTokenFromHeaders(input.headers);
    }
    return originalFetch(input, init);
  };
  w.__edaExtOmnisearchFetchPatched = true;
}

async function sendEdaRequest(path: string, method = 'GET', body?: string): Promise<EdaResponsePayload> {
  const state = getState();
  if (!state.token) {
    return { ok: false, status: 0, body: 'Waiting for EDA auth token' };
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    : null;

  const requestInit: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${state.token}`,
    },
    credentials: 'same-origin',
    signal: controller?.signal,
  };

  if (body && method !== 'GET' && method !== 'HEAD') {
    requestInit.body = body;
  }

  try {
    const response = await fetch(path, requestInit);
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: getErrorMessage(error),
    };
  } finally {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await sendEdaRequest(url, 'GET');
  if (!response.ok) {
    throw new Error(`${url} failed (${response.status})`);
  }
  return parseResponseBody(response.body);
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

async function fetchEqlItems(query: string): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams({ query });
  const response = await sendEdaRequest(`/core/query/v1/eql?${params.toString()}`, 'GET');
  if (!response.ok) return [];
  const payload = parseResponseBody(response.body);
  return extractObjectArray(payload);
}

async function fetchResourceInstances(
  resource: ParsedKind,
  eqlQueryLimit: number,
  itemLimitPerResource: number,
): Promise<Array<Record<string, unknown>>> {
  const queries = buildResourceEqlQueries(resource, eqlQueryLimit);
  for (const query of queries) {
    const objects = (await fetchEqlItems(query).catch(() => []))
      .slice(0, itemLimitPerResource);
    if (objects.length > 0) return objects;
  }
  return [];
}

interface FetchInstanceOptions {
  resourceLimit?: number;
  itemLimitPerResource?: number;
  totalLimit?: number;
  eqlQueryLimit?: number;
  concurrency?: number;
  onItems?: (items: ParsedKind[]) => void;
  priority?: (resource: ParsedKind) => number;
}

async function fetchInstanceItems(
  resources: ParsedKind[],
  options: FetchInstanceOptions = {},
): Promise<ParsedKind[]> {
  const resourceLimit = options.resourceLimit ?? INSTANCE_RESOURCE_LIMIT;
  const itemLimitPerResource = options.itemLimitPerResource ?? INSTANCE_ITEMS_PER_RESOURCE;
  const totalLimit = options.totalLimit ?? INSTANCE_TOTAL_LIMIT;
  const eqlQueryLimit = options.eqlQueryLimit ?? INSTANCE_EQL_QUERY_LIMIT;
  const concurrency = options.concurrency ?? INSTANCE_FETCH_CONCURRENCY;
  const onItems = options.onItems;
  const priority = options.priority ?? resourcePriority;

  const uniqueResources = new Map<string, ParsedKind>();

  for (const resource of resources) {
    if (resource.isInstance) continue;
    const key = `${resource.group}/${resource.version}/${resource.plural}`;
    if (!uniqueResources.has(key)) {
      uniqueResources.set(key, resource);
    }
  }

  const sortedResources = Array.from(uniqueResources.values()).sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    return `${a.group}/${a.plural}`.localeCompare(`${b.group}/${b.plural}`);
  });
  const resourcesToFetch = sortedResources.slice(0, resourceLimit);

  const out: ParsedKind[] = [];
  const seen = new Set<string>();
  let index = 0;

  async function worker(): Promise<void> {
    while (out.length < totalLimit && index < resourcesToFetch.length) {
      const resource = resourcesToFetch[index++];
      const objects = await fetchResourceInstances(
        resource,
        eqlQueryLimit,
        itemLimitPerResource,
      );
      const fresh: ParsedKind[] = [];
      for (const object of objects) {
        const instanceName = extractItemName(object);
        if (!instanceName) continue;
        if (resource.plural.toLowerCase() === 'workflowdefinitions' && instanceName.toLowerCase().endsWith('-gvk')) {
          continue;
        }
        const objectNamespace = extractItemNamespace(object);
        const key = `${resource.group}/${resource.version}/${resource.plural}/${objectNamespace}/${instanceName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const item: ParsedKind = {
          plural: resource.plural,
          kind: resource.kind,
          label: instanceName,
          category: resource.category,
          panel: resource.panel,
          group: resource.group,
          version: resource.version,
          namespaced: resource.namespaced,
          isInstance: true,
          instanceName,
          instanceNamespace: objectNamespace || undefined,
          instanceSearchText: extractInstanceSearchText(object),
        };
        out.push(item);
        fresh.push(item);
        if (out.length >= totalLimit) break;
      }
      if (fresh.length > 0 && onItems) {
        try {
          onItems(fresh);
        } catch {
          // Never fail enrichment due to a callback error.
        }
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return out;
}

async function fetchGroupItems(groupName: string, version: string): Promise<ParsedKind[]> {
  const encodedGroup = encodeURIComponent(groupName);
  const encodedVersion = encodeURIComponent(version);

  const [resourceListRaw, openApiRaw] = await Promise.all([
    fetchJson(`/apps/${encodedGroup}/${encodedVersion}`).catch(() => null),
    fetchJson(`/openapi/v3/apps/${encodedGroup}/${encodedVersion}`).catch(() => null),
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

    const access = checkAccess(openApiPaths, groupName, version, plural, namespaced);
    if (access === 'None') continue;

    out.push({
      plural,
      kind,
      label: kind,
      category: '',
      panel: 'main',
      group: groupName,
      version,
      namespaced,
    });
  }
  return out;
}

function parsedKindCacheKey(item: ParsedKind): string {
  if (item.isInstance) {
    return `i:${item.group}/${item.version}/${item.plural}/${item.instanceNamespace || ''}/${item.instanceName || ''}`;
  }
  return `r:${item.group}/${item.version}/${item.plural}`;
}

function mergeParsedKinds(...lists: ParsedKind[][]): ParsedKind[] {
  const out: ParsedKind[] = [];
  const seen = new Set<string>();

  for (const list of lists) {
    for (const item of list) {
      const key = parsedKindCacheKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}

async function fetchAllResources(force: boolean): Promise<void> {
  const state = getState();

  if (state.fetching) return;

  const now = Date.now();
  if (!force && state.cachedItems.length > 0 && now - state.lastFetchTs < CACHE_TTL_MS) {
    post(APPS_RESPONSE_MSG, { data: state.cachedItems, cached: true });
    return;
  }

  state.fetching = true;
  try {
    const appsRaw = await fetchJson('/apps');
    const groupsRaw = (
      appsRaw && typeof appsRaw === 'object'
        ? (appsRaw as { groups?: unknown }).groups
        : []
    );
    if (!Array.isArray(groupsRaw)) {
      throw new Error('Unexpected /apps response');
    }

    const groups = groupsRaw
      .filter((groupRaw): groupRaw is AppsGroup => Boolean(groupRaw) && typeof groupRaw === 'object');

    const groupResults = await Promise.all(groups.map(async (group) => {
      const groupName = typeof group.name === 'string' ? group.name : '';
      const version = pickVersion(group);
      if (!groupName || !version) return [];
      return fetchGroupItems(groupName, version).catch(() => []);
    }));

    const flattened = groupResults.flat();
    state.cachedItems = flattened;
    state.lastFetchTs = Date.now();
    post(APPS_RESPONSE_MSG, { data: flattened });

    void (async () => {
      const uniqueResources = new Map<string, ParsedKind>();
      for (const resource of flattened) {
        const key = `${resource.group}/${resource.version}/${resource.plural}`;
        if (!uniqueResources.has(key)) {
          uniqueResources.set(key, resource);
        }
      }
      const sortedResources = Array.from(uniqueResources.values()).sort((a, b) => {
        const pa = resourcePriority(a);
        const pb = resourcePriority(b);
        if (pa !== pb) return pa - pb;
        return `${a.group}/${a.plural}`.localeCompare(`${b.group}/${b.plural}`);
      });

      const fastResources = sortedResources.slice(0, FAST_INSTANCE_RESOURCE_LIMIT);
      const slowResources = sortedResources.slice(
        FAST_INSTANCE_RESOURCE_LIMIT,
        FAST_INSTANCE_RESOURCE_LIMIT + SLOW_INSTANCE_RESOURCE_LIMIT,
      );

      const fastInstanceItems: ParsedKind[] = [];
      const slowInstanceItems: ParsedKind[] = [];
      const fastSeen = new Set<string>();
      const slowSeen = new Set<string>();
      let lastPublishedCount = flattened.length;

      function publishMerged(): void {
        const merged = mergeParsedKinds(flattened, fastInstanceItems, slowInstanceItems);
        if (merged.length <= lastPublishedCount) return;
        lastPublishedCount = merged.length;
        const latestState = getState();
        latestState.cachedItems = merged;
        latestState.lastFetchTs = Date.now();
        post(APPS_RESPONSE_MSG, { data: merged, enriched: true });
      }

      function appendItems(target: ParsedKind[], targetSeen: Set<string>, items: ParsedKind[]): void {
        let changed = false;
        for (const item of items) {
          const key = parsedKindCacheKey(item);
          if (targetSeen.has(key)) continue;
          targetSeen.add(key);
          target.push(item);
          changed = true;
        }
        if (changed) {
          publishMerged();
        }
      }

      if (fastResources.length > 0) {
        try {
          const items = await fetchInstanceItems(
            fastResources,
            {
              itemLimitPerResource: FAST_INSTANCE_ITEMS_PER_RESOURCE,
              totalLimit: FAST_INSTANCE_TOTAL_LIMIT,
              eqlQueryLimit: FAST_INSTANCE_EQL_QUERY_LIMIT,
              concurrency: FAST_INSTANCE_FETCH_CONCURRENCY,
              onItems: (newItems) => appendItems(fastInstanceItems, fastSeen, newItems),
            },
          );
          appendItems(fastInstanceItems, fastSeen, items);
        } catch {
          // Preserve base resource results even if enrichment fails.
        }
      }

      if (slowResources.length > 0) {
        try {
          const items = await fetchInstanceItems(
            slowResources,
            {
              onItems: (newItems) => appendItems(slowInstanceItems, slowSeen, newItems),
            },
          );
          appendItems(slowInstanceItems, slowSeen, items);
        } catch {
          // Preserve base resource results even if enrichment fails.
        }
      }
    })();
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
  try {
    const params = new URLSearchParams({ query });
    const response = await sendEdaRequest(`/core/query/v1/eql?${params.toString()}`, 'GET');

    if (!response.ok) {
      throw new Error(`EQL query failed (${response.status})`);
    }

    const data = parseResponseBody(response.body);
    post(EQL_RESPONSE_MSG, { reqId, data });
  } catch (err) {
    post(EQL_RESPONSE_MSG, {
      reqId,
      error: getErrorMessage(err),
    });
  }
}

async function runEqlAutocomplete(query: string, reqId: number, completionLimit: number): Promise<void> {
  try {
    const params = new URLSearchParams({
      query,
      completion_limit: String(completionLimit > 0 ? completionLimit : 10),
    });
    const response = await sendEdaRequest(`/core/query/v1/eql/autocomplete?${params.toString()}`, 'GET');

    if (!response.ok) {
      throw new Error(`EQL autocomplete failed (${response.status})`);
    }

    const data = parseResponseBody(response.body);
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
    if (window.location.origin !== 'null' && event.origin !== window.location.origin) return;
    if (!event.data || typeof event.data !== 'object') return;

    const data = event.data as Record<string, unknown>;
    if (data.channel !== OMNISEARCH_BRIDGE_CHANNEL) return;
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
