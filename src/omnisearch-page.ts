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
  WORKFLOW_RUN_REQUEST_MSG,
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
const GROUP_FETCH_CONCURRENCY = 8;

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
      post(APPS_RESPONSE_MSG, { data: state.cachedItems, cached: true, loading: false });
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

    const groupPlans: Array<{ groupName: string; version: string }> = [];
    for (const group of groups) {
      const groupName = typeof group.name === 'string' ? group.name : '';
      const version = pickVersion(group);
      if (!groupName || !version) continue;
      groupPlans.push({ groupName, version });
    }

    if (groupPlans.length === 0) {
      state.cachedItems = [];
      state.lastFetchTs = Date.now();
      post(APPS_RESPONSE_MSG, { data: [], partial: false, loading: false });
      return;
    }

    const groupResults: ParsedKind[][] = Array.from({ length: groupPlans.length }, () => []);
    let publishedBaseCount = 0;

    function publishBase(partial: boolean, forcePublish = false): ParsedKind[] {
      const merged = mergeParsedKinds(...groupResults);
      if (!forcePublish && merged.length <= publishedBaseCount) return merged;
      publishedBaseCount = merged.length;
      const latestState = getState();
      latestState.cachedItems = merged;
      latestState.lastFetchTs = Date.now();
      post(APPS_RESPONSE_MSG, {
        data: merged,
        partial,
        loading: true,
        phase: partial ? 'apps' : 'resources',
      });
      return merged;
    }

    let nextGroupIndex = 0;
    async function groupWorker(): Promise<void> {
      while (nextGroupIndex < groupPlans.length) {
        const index = nextGroupIndex++;
        const group = groupPlans[index];
        groupResults[index] = await fetchGroupItems(group.groupName, group.version).catch(() => []);
        publishBase(true);
      }
    }

    const workerCount = Math.min(GROUP_FETCH_CONCURRENCY, groupPlans.length);
    await Promise.all(Array.from({ length: workerCount }, () => groupWorker()));

    let flattened = publishBase(false, true);

    // Read workflow types from the Redux store (synchronous) and apply flags
    // BEFORE the instance enrichment closure captures `flattened`.
    const workflowTypes = getWorkflowTypesFromStore();
    if (workflowTypes.length > 0) {
      const wfKeys = new Set(workflowTypes.map(w => `${w.group}/${w.version}/${w.plural}`));
      for (const item of flattened) {
        if (item.isInstance) continue;
        const key = `${item.group}/${item.version}/${item.plural}`;
        if (wfKeys.has(key)) {
          item.workflowCapable = true;
          wfKeys.delete(key);
        }
      }
      // Add workflow types not already in the resource list
      const newEntries = workflowTypes.filter(w => wfKeys.has(`${w.group}/${w.version}/${w.plural}`));
      if (newEntries.length > 0) {
        flattened = [...flattened, ...newEntries];
      }
      state.cachedItems = flattened;
      state.lastFetchTs = Date.now();
      post(APPS_RESPONSE_MSG, { data: flattened, loading: true, phase: 'resources' });
    }

    // If store wasn't ready yet, retry after a short delay
    if (workflowTypes.length === 0) {
      setTimeout(() => {
        const retryTypes = getWorkflowTypesFromStore();
        if (retryTypes.length === 0) return;
        const wfKeys = new Set(retryTypes.map(w => `${w.group}/${w.version}/${w.plural}`));
        const latestState = getState();
        let changed = false;
        for (const item of latestState.cachedItems) {
          if (item.workflowCapable || item.isInstance) continue;
          const key = `${item.group}/${item.version}/${item.plural}`;
          if (wfKeys.has(key)) { item.workflowCapable = true; wfKeys.delete(key); changed = true; }
        }
        const extras = retryTypes.filter(w => wfKeys.has(`${w.group}/${w.version}/${w.plural}`));
        if (extras.length > 0) { latestState.cachedItems = [...latestState.cachedItems, ...extras]; changed = true; }
        if (changed) {
          latestState.lastFetchTs = Date.now();
          post(APPS_RESPONSE_MSG, { data: latestState.cachedItems, enriched: true, loading: false, done: true, phase: 'resources' });
        }
      }, 3000);
    }

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
      let latestMerged = flattened;

      function publishMerged(): void {
        const merged = mergeParsedKinds(flattened, fastInstanceItems, slowInstanceItems);
        if (merged.length <= lastPublishedCount) return;
        lastPublishedCount = merged.length;
        latestMerged = merged;
        const latestEnrichedState = getState();
        latestEnrichedState.cachedItems = merged;
        latestEnrichedState.lastFetchTs = Date.now();
        post(APPS_RESPONSE_MSG, {
          data: merged,
          enriched: true,
          loading: true,
          phase: 'resources',
        });
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
        if (changed) publishMerged();
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

      const finalMerged = mergeParsedKinds(flattened, fastInstanceItems, slowInstanceItems);
      latestMerged = finalMerged.length > latestMerged.length ? finalMerged : latestMerged;
      const latestDoneState = getState();
      latestDoneState.cachedItems = latestMerged;
      latestDoneState.lastFetchTs = Date.now();
      post(APPS_RESPONSE_MSG, {
        data: latestMerged,
        enriched: true,
        loading: false,
        done: true,
        phase: 'resources',
      });
    })();
  } catch (err) {
    post(APPS_RESPONSE_MSG, {
      data: state.cachedItems,
      error: getErrorMessage(err),
      loading: false,
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
      return;
    }

    if (data.type === WORKFLOW_RUN_REQUEST_MSG) {
      const group = typeof data.group === 'string' ? data.group : '';
      const version = typeof data.version === 'string' ? data.version : '';
      const plural = typeof data.plural === 'string' ? data.plural : '';
      void triggerWorkflowRun(group, version, plural);
    }
  });
}

// ── React fiber / Redux store access ──
// The page bridge runs in the EDA page's main world, so we can walk
// the React fiber tree to reach the Redux store and component state.

/* eslint-disable @typescript-eslint/no-explicit-any */
function findReactRoot(): any {
  const root = document.getElementById('root');
  if (!root) return null;
  const key = Object.keys(root).find(
    (k) => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'),
  );
  return key ? (root as any)[key] : null;
}

function walkFibers(start: any, predicate: (fiber: any) => boolean): any {
  if (!start) return null;
  const visited = new WeakSet();
  const stack: any[] = [start];
  while (stack.length) {
    const fiber = stack.pop();
    if (!fiber || visited.has(fiber)) continue;
    visited.add(fiber);
    if (predicate(fiber)) return fiber;
    if (fiber.child) stack.push(fiber.child);
    if (fiber.sibling) stack.push(fiber.sibling);
  }
  return null;
}

function getReduxStore(): any {
  const root = findReactRoot();
  const provider = walkFibers(root, (f) => {
    const store = f.memoizedProps?.store;
    return Boolean(store?.getState && store?.dispatch);
  });
  return provider?.memoizedProps?.store ?? null;
}

/**
 * Read workflow-capable resource types from the EDA app's Redux store.
 * Iterates `manifests.manifests`, picks kinds where `workflow === true`.
 */
function getWorkflowTypesFromStore(): ParsedKind[] {
  const store = getReduxStore();
  if (!store) return [];

  const storeState = store.getState();
  const manifests: Record<string, any> = storeState?.manifests?.manifests ?? {};
  const out: ParsedKind[] = [];
  const seen = new Set<string>();

  for (const key of Object.keys(manifests)) {
    const manifest = manifests[key];
    if (!manifest) continue;
    const group: string = manifest.group ?? '';
    const version: string = manifest.version ?? '';
    if (!group || !version) continue;

    for (const kind of manifest.kinds ?? []) {
      if (!kind.workflow) continue;

      const plural: string = kind.plural ?? '';
      const kindName: string = kind.kind ?? '';
      if (!plural) continue;

      const entryKey = `${group}/${version}/${plural}`;
      if (seen.has(entryKey)) continue;
      seen.add(entryKey);

      out.push({
        plural,
        kind: kindName,
        label: kindName,
        category: '',
        panel: 'main',
        group,
        version,
        namespaced: kind.namespaced ?? true,
        workflowCapable: true,
      });
    }
  }

  return out;
}


async function triggerWorkflowRun(group: string, version: string, plural: string): Promise<void> {
  const store = getReduxStore();
  if (!store) return;

  const manifests: Record<string, any> = store.getState()?.manifests?.manifests ?? {};
  let gvk: any = null;

  for (const key of Object.keys(manifests)) {
    const manifest = manifests[key];
    if (!manifest || manifest.group !== group) continue;
    for (const kind of manifest.kinds ?? []) {
      if (kind.plural === plural) {
        gvk = { group, version: manifest.version || version, kind: kind.kind };
        break;
      }
    }
    if (gvk) break;
  }

  if (!gvk) return;

  if (!window.location.pathname.startsWith('/ui/main/workflows')) {
    const root = findReactRoot();
    const routerFiber = walkFibers(root, (f) => Boolean(f.memoizedProps?.router?.navigate));
    if (routerFiber?.memoizedProps?.router?.navigate) {
      routerFiber.memoizedProps.router.navigate('/ui/main/workflows');
    } else {
      return;
    }
  }

  let createBtn: HTMLElement | null = null;
  for (let i = 0; i < 80; i++) {
    createBtn = findButtonByText('create') as HTMLElement | null;
    if (createBtn) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!createBtn) return;
  createBtn.click();

  const acRoot = await waitForElement('.MuiAutocomplete-root', 4000);
  if (!acRoot) return;

  const acFiberKey = Object.keys(acRoot).find((k) => k.startsWith('__reactFiber$'));
  if (!acFiberKey) return;

  let acOnChange: ((event: any, value: any, reason: string) => void) | null = null;
  let targetOption: any = null;

  for (let attempt = 0; attempt < 60; attempt++) {
    let fiber = (acRoot as any)[acFiberKey];
    let d = 0;
    while (fiber && d < 25) {
      const props = fiber.memoizedProps;
      if (props?.onChange && Array.isArray(props?.options) && props.options.length > 0) {
        acOnChange = props.onChange;
        targetOption = props.options.find((opt: any) =>
          opt && ((opt.kind || '').toLowerCase() === gvk.kind.toLowerCase()
            || (opt.plural || '').toLowerCase() === plural.toLowerCase()),
        );
        break;
      }
      fiber = fiber.return;
      d++;
    }
    if (targetOption) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  if (!acOnChange || !targetOption) return;
  acOnChange({} as any, targetOption, 'selectOption');

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const btn = document.getElementById('WorkflowDefinitionSelectionModal-modal-Confirm') as HTMLButtonElement | null;
    if (btn && !btn.disabled) { btn.click(); return; }
  }
}

function waitForElement(selector: string, timeout: number): Promise<Element | null> {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }
    const obs = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { obs.disconnect(); resolve(found); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
  });
}

function findButtonByText(text: string): Element | null {
  const buttons = document.querySelectorAll('button');
  for (let i = 0; i < buttons.length; i++) {
    if ((buttons[i].textContent || '').trim().toLowerCase() === text) return buttons[i];
  }
  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

patchXhr();
patchFetch();
setupMessageBridge();
post(BRIDGE_READY_MSG, { ok: true });
