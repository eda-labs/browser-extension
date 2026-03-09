const APPS_REQUEST_MSG = 'eda-ext-fetch-apps';
const APPS_RESPONSE_MSG = 'eda-ext-apps-response';
const EQL_REQUEST_MSG = 'eda-ext-eql-request';
const EQL_RESPONSE_MSG = 'eda-ext-eql-response';
const EQL_AUTOCOMPLETE_REQUEST_MSG = 'eda-ext-eql-autocomplete-request';
const EQL_AUTOCOMPLETE_RESPONSE_MSG = 'eda-ext-eql-autocomplete-response';
const BRIDGE_READY_MSG = 'eda-ext-bridge-ready';
const SPOTLIGHT_BRIDGE_CHANNEL = 'eda-ext-spotlight-bridge';
const EDA_REQUEST_MSG = 'eda-request';
const EDA_RESPONSE_MSG = 'eda-response';
const EDA_REQUEST_CHANNEL = 'eda-ext-spotlight-request';
const PAGE_TARGET_ORIGIN = window.location.origin === 'null' ? '*' : window.location.origin;

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
  isInstance?: boolean;
  instanceName?: string;
  instanceNamespace?: string;
  instanceSearchText?: string;
}

interface AppsGroup {
  name?: string;
  preferredVersion?: { version?: string };
  versions?: Array<{ version?: string } | string>;
}

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

function parseResponseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
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

function extractObjectArray(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  }
  if (!data || typeof data !== 'object') return [];

  const record = data as Record<string, unknown>;
  for (const key of ['items', 'data', 'resources', 'results']) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    }
  }

  for (const value of Object.values(record)) {
    if (!Array.isArray(value)) continue;
    const arr = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    if (arr.length > 0) return arr;
  }

  return [];
}

function extractItemName(item: Record<string, unknown>): string {
  const direct = typeof item.name === 'string' ? item.name.trim() : '';
  if (direct) return direct;
  const metadata = item.metadata && typeof item.metadata === 'object'
    ? item.metadata as Record<string, unknown>
    : null;
  const metadataName = typeof metadata?.name === 'string' ? metadata.name.trim() : '';
  if (metadataName) return metadataName;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  return id;
}

function extractItemNamespace(item: Record<string, unknown>): string {
  const direct = typeof item.namespace === 'string' ? item.namespace.trim() : '';
  if (direct) return direct;
  const metadata = item.metadata && typeof item.metadata === 'object'
    ? item.metadata as Record<string, unknown>
    : null;
  return typeof metadata?.namespace === 'string' ? metadata.namespace.trim() : '';
}

function normalizeIdentifierToken(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function singularizeIdentifier(token: string): string {
  if (token.length <= 1) return token;
  if (token.endsWith('ies') && token.length > 3) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith('sses') && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith('ses') && token.length > 3) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s') && token.length > 1) {
    return token.slice(0, -1);
  }
  return token;
}

function buildKindCandidates(resource: ParsedKind): string[] {
  const candidates = new Set<string>();
  const add = (value: string): void => {
    const normalized = normalizeIdentifierToken(value);
    if (normalized) candidates.add(normalized);
  };

  add(resource.kind);
  add(resource.plural);
  add(singularizeIdentifier(resource.plural));

  return Array.from(candidates);
}

function buildResourceEqlQueries(resource: ParsedKind): string[] {
  const groupToken = normalizeIdentifierToken(resource.group);
  const versionToken = normalizeIdentifierToken(resource.version);
  if (!groupToken || !versionToken) return [];

  const kinds = buildKindCandidates(resource);
  return kinds.map((kindToken) => `.namespace.resources.cr.${groupToken}.${versionToken}.${kindToken} limit ${INSTANCE_EQL_QUERY_LIMIT}`);
}

async function fetchEqlItems(query: string): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams({ query });
  const response = await sendEdaRequest(`/core/query/v1/eql?${params.toString()}`, 'GET');
  if (!response.ok) return [];
  const payload = parseResponseBody(response.body);
  return extractObjectArray(payload);
}

function addSearchTerm(out: Set<string>, raw: string): void {
  if (out.size >= 140) return;
  const value = raw.trim().toLowerCase();
  if (!value || value.length > 120) return;
  out.add(value);
  if (out.size >= 140) return;
  const compact = value.replace(/[^a-z0-9]+/g, '');
  if (compact && compact !== value) out.add(compact);
}

function collectSearchTerms(value: unknown, out: Set<string>, depth = 0): void {
  if (out.size >= 140 || value == null || depth > 4) return;

  if (typeof value === 'string') {
    addSearchTerm(out, value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    addSearchTerm(out, String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 40)) {
      collectSearchTerms(entry, out, depth + 1);
      if (out.size >= 140) return;
    }
    return;
  }
  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  let keyCount = 0;
  for (const [key, entry] of Object.entries(record)) {
    keyCount += 1;
    if (keyCount > 80) break;
    if (key) addSearchTerm(out, key);
    collectSearchTerms(entry, out, depth + 1);
    if (out.size >= 140) return;
  }
}

function extractInstanceSearchText(item: Record<string, unknown>): string {
  const terms = new Set<string>();
  collectSearchTerms(item, terms);
  const result = Array.from(terms).join(' ');
  if (result.length <= 2200) return result;
  return result.slice(0, 2200);
}

function resourcePriority(resource: ParsedKind): number {
  const key = `${resource.group}/${resource.plural}`.toLowerCase();
  if (key.includes('fabric')) return 0;
  if (key.includes('interface')) return 1;
  if (key.includes('bgp')) return 2;
  if (key.includes('topolog')) return 3;
  if (key.includes('node')) return 4;
  if (!resource.namespaced) return 5;
  return 6;
}

async function fetchResourceInstances(resource: ParsedKind): Promise<Array<Record<string, unknown>>> {
  const queries = buildResourceEqlQueries(resource);
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
