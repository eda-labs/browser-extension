import { getErrorMessage } from './core/utils';
import {
  APPS_REQUEST_MSG,
  APPS_RESPONSE_MSG,
  BRIDGE_READY_MSG,
  EDA_REQUEST_CHANNEL,
  EDA_REQUEST_MSG,
  EDA_RESPONSE_MSG,
  EQL_AUTOCOMPLETE_REQUEST_MSG,
  EQL_AUTOCOMPLETE_RESPONSE_MSG,
  EQL_REQUEST_MSG,
  EQL_RESPONSE_MSG,
  SPOTLIGHT_BRIDGE_CHANNEL,
} from './spotlight/constants';
import {
  buildResourceEqlQueries,
  checkAccess,
  extractInstanceSearchText,
  extractItemName,
  extractItemNamespace,
  extractObjectArray,
  parseResponseBody,
  resourcePriority,
} from './spotlight/page-helpers';
import type { AppsGroup, ParsedKind } from './spotlight/types';

const PAGE_TARGET_ORIGIN = window.location.origin === 'null' ? '*' : window.location.origin;

type SpotlightWindow = Window & {
  __edaExtSpotlightState?: {
    cachedItems: ParsedKind[];
    lastFetchTs: number;
    fetching: boolean;
  };
};

const CACHE_TTL_MS = 60_000;
const INSTANCE_RESOURCE_LIMIT = 220;
const INSTANCE_ITEMS_PER_RESOURCE = 250;
const INSTANCE_FETCH_CONCURRENCY = 6;
const INSTANCE_TOTAL_LIMIT = 8000;
const INSTANCE_EQL_QUERY_LIMIT = 1000;
const EDA_REQUEST_TIMEOUT_MS = 15_000;

let edaReqCounter = 0;

interface EdaResponsePayload {
  ok: boolean;
  status: number;
  body: unknown;
}

function post(type: string, payload: Record<string, unknown>): void {
  window.postMessage({ type, channel: SPOTLIGHT_BRIDGE_CHANNEL, ...payload }, PAGE_TARGET_ORIGIN);
}

function getState(): NonNullable<SpotlightWindow['__edaExtSpotlightState']> {
  const w = window as SpotlightWindow;
  if (!w.__edaExtSpotlightState) {
    w.__edaExtSpotlightState = {
      cachedItems: [],
      lastFetchTs: 0,
      fetching: false,
    };
  }
  return w.__edaExtSpotlightState;
}


function nextEdaRequestId(): string {
  edaReqCounter += 1;
  return `eda-ext-spotlight-${Date.now()}-${edaReqCounter}`;
}

function sendEdaRequest(path: string, method = 'GET', body?: string): Promise<EdaResponsePayload> {
  const id = nextEdaRequestId();
  return new Promise((resolve, reject) => {
    let timeoutId = 0;

    function cleanup(): void {
      window.clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
    }

    function onMessage(event: MessageEvent): void {
      if (event.source !== window) return;
      if (window.location.origin !== 'null' && event.origin !== window.location.origin) return;
      if (!event.data || typeof event.data !== 'object') return;
      const data = event.data as Record<string, unknown>;
      if (data.type !== EDA_RESPONSE_MSG) return;
      if (data.channel !== EDA_REQUEST_CHANNEL) return;
      if (data.id !== id) return;
      cleanup();
      resolve({
        ok: Boolean(data.ok),
        status: typeof data.status === 'number' ? data.status : 0,
        body: data.body,
      });
    }

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(`EDA request timed out (${method} ${path})`));
    }, EDA_REQUEST_TIMEOUT_MS);

    window.addEventListener('message', onMessage);
    window.postMessage({
      type: EDA_REQUEST_MSG,
      channel: EDA_REQUEST_CHANNEL,
      id,
      path,
      method,
      body,
    }, PAGE_TARGET_ORIGIN);
  });
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

async function fetchResourceInstances(resource: ParsedKind): Promise<Array<Record<string, unknown>>> {
  const queries = buildResourceEqlQueries(resource, INSTANCE_EQL_QUERY_LIMIT);
  for (const query of queries) {
    const objects = await fetchEqlItems(query).catch(() => []);
    if (objects.length > 0) return objects;
  }
  return [];
}

async function fetchInstanceItems(resources: ParsedKind[]): Promise<ParsedKind[]> {
  const uniqueResources = new Map<string, ParsedKind>();

  for (const resource of resources) {
    if (resource.isWorkflow || resource.isInstance) continue;
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
  const resourcesToFetch = sortedResources.slice(0, INSTANCE_RESOURCE_LIMIT);

  const out: ParsedKind[] = [];
  const seen = new Set<string>();
  let index = 0;

  async function worker(): Promise<void> {
    while (out.length < INSTANCE_TOTAL_LIMIT && index < resourcesToFetch.length) {
      const resource = resourcesToFetch[index++];
      const objects = (await fetchResourceInstances(resource))
        .slice(0, INSTANCE_ITEMS_PER_RESOURCE);
      for (const object of objects) {
        const instanceName = extractItemName(object);
        if (!instanceName) continue;
        const objectNamespace = extractItemNamespace(object);
        const key = `${resource.group}/${resource.version}/${resource.plural}/${objectNamespace}/${instanceName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          plural: resource.plural,
          kind: resource.kind,
          label: instanceName,
          category: resource.category,
          panel: resource.panel,
          group: resource.group,
          version: resource.version,
          namespaced: resource.namespaced,
          isWorkflow: false,
          isInstance: true,
          instanceName,
          instanceNamespace: objectNamespace || undefined,
          instanceSearchText: extractInstanceSearchText(object),
        });
        if (out.length >= INSTANCE_TOTAL_LIMIT) break;
      }
    }
  }

  const workers = Array.from({ length: INSTANCE_FETCH_CONCURRENCY }, () => worker());
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

    // Keep all discovered resources searchable, even when OpenAPI access
    // metadata is incomplete or does not expose a GET path for this target.
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
      const instanceItems = await fetchInstanceItems(flattened).catch(() => []);
      if (instanceItems.length === 0) return;
      const latestState = getState();
      const merged = [...flattened, ...instanceItems];
      latestState.cachedItems = merged;
      latestState.lastFetchTs = Date.now();
      post(APPS_RESPONSE_MSG, { data: merged, enriched: true });
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
    if (data.channel !== SPOTLIGHT_BRIDGE_CHANNEL) return;
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

setupMessageBridge();
post(BRIDGE_READY_MSG, { ok: true });
