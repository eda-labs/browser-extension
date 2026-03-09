const SPOTLIGHT_ID = 'eda-ext-spotlight';
const APPS_RESPONSE_MSG = 'eda-ext-apps-response';
const EQL_RESPONSE_MSG = 'eda-ext-eql-response';
const EQL_REQUEST_MSG = 'eda-ext-eql-request';

interface NavItem {
  label: string;
  href: string;
  section: string;
  keywords: string;
  action?: 'workflow-run';
  workflowMeta?: { group: string; version: string; plural: string; kind: string };
}

interface EqlResult {
  label: string;
  path: string;
  section: string;
  fields: Record<string, unknown>;
}

const QUICK_ACTIONS: NavItem[] = [];

// Items fetched from the /apps API
let apiItems: NavItem[] = [];
let apiFetched = false;

const GROUP_TO_SECTION: Record<string, string> = {
  'aaa.eda.nokia.com': 'Security',
  'aifabrics.eda.nokia.com': 'AI Fabrics',
  'appstore.eda.nokia.com': 'App Management',
  'bootstrap.eda.nokia.com': 'Bootstrap',
  'components.eda.nokia.com': 'Components',
  'config.eda.nokia.com': 'Configuration',
  'core.eda.nokia.com': 'Core',
  'environment.eda.nokia.com': 'Configuration',
  'fabrics.eda.nokia.com': 'Fabrics',
  'filters.eda.nokia.com': 'Filters',
  'interfaces.eda.nokia.com': 'System Interface',
  'management.eda.nokia.com': 'Management Router',
  'oam.eda.nokia.com': 'OAM',
  'os.eda.nokia.com': 'Node Management',
  'protocols.eda.nokia.com': 'Protocols',
  'qos.eda.nokia.com': 'QoS',
  'routing.eda.nokia.com': 'Default Routing',
  'routingpolicies.eda.nokia.com': 'Routing Policies',
  'security.eda.nokia.com': 'Security',
  'services.eda.nokia.com': 'Virtual Networks',
  'siteinfo.eda.nokia.com': 'Site Profiles',
  'support.eda.nokia.com': 'Maintenance',
  'system.eda.nokia.com': 'Platform',
  'timing.eda.nokia.com': 'Timing',
  'topologies.eda.nokia.com': 'Topology',
};

// Resources that use the system_administration panel instead of main
const SYSTEM_ADMIN_RESOURCES: Record<string, Set<string>> = {
  'core.eda.nokia.com': new Set(['namespaces', 'httpproxies', 'udpproxies', 'roles', 'clusterroles']),
  'appstore.eda.nokia.com': new Set(['catalogs', 'registries']),
};

// Resources that have dedicated pages (not /ui/app/... routes)
const DEDICATED_PAGES: Record<string, string> = {
  'workflows': '/ui/main/workflows',
  'alarms': '/ui/main/alarms',
  'transactions': '/ui/main/transactions',
  'topologies': '/ui/main/topologies',
  'physical-topology': '/ui/main/topologies/topologies.eda.nokia.com_v1alpha1_physical',
  'dashboards': '/ui/main/uibuilder',
  'queryapi': '/ui/main/queryapi',
  'apidocs': '/ui/main/apidocs',
  'appstore': '/ui/system_administration/appstore',
  'role-based-access-control': '/ui/system_administration/role-based-access-control',
  'password-policy': '/ui/system_administration/password-policy',
};

function getPanel(group: string, plural: string): string {
  return SYSTEM_ADMIN_RESOURCES[group]?.has(plural) ? 'system_administration' : 'main';
}

function groupToSection(group: string): string | undefined {
  return GROUP_TO_SECTION[group];
}

function humanizeLabel(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();
}

/**
 * Inject a script into the page context BEFORE any page JS runs.
 * Patches XMLHttpRequest.setRequestHeader to capture the first Bearer token
 * the EDA app sends (via its Keycloak/axios stack), then fetches /apps with it.
 *
 * Must be called at document_start to beat the page's own scripts.
 */
function injectAppsFetcher(): void {
  const script = document.createElement('script');
  script.textContent = `(function() {
    // R8-equivalent: check OpenAPI paths for user access to a resource
    function checkAccess(openApiPaths, group, version, plural, namespaced, isWorkflow) {
      var access = 'None';
      // Build regex matching the resource's API path (same as UI's R8)
      var base = isWorkflow
        ? '/workflows/v1/' + group + '/' + version + '/' + plural
        : '/apps/' + group + '/' + version + (namespaced ? '/[^/]+' : '') + '/' + plural;
      var re;
      try { re = new RegExp('^' + base + '(/.+)?$'); } catch(e) { return 'None'; }
      for (var path in openApiPaths) {
        if (!re.test(path)) continue;
        var methods = openApiPaths[path];
        for (var method in methods) {
          var m = method.toLowerCase();
          if (m !== 'get') access = 'ReadWrite';
          else if (access === 'None') access = 'Read';
        }
      }
      return access;
    }

    function fetchAllResources(token) {
      var headers = { 'Authorization': 'Bearer ' + token };

      // Step 1: GET /apps to get group list
      fetch('/apps', { headers: headers })
        .then(function(r) { return r.json(); })
        .then(function(resp) {
          var groups = resp && resp.groups;
          if (!Array.isArray(groups)) return;

          // Step 2: For each group, fetch BOTH the resource list AND the OpenAPI spec
          var promises = groups.map(function(group) {
            var pv = group.preferredVersion || (group.versions && group.versions[0]);
            if (!pv || !group.name) return Promise.resolve(null);
            var ver = pv.version || 'v1';
            var eg = encodeURIComponent(group.name);
            var ev = encodeURIComponent(ver);

            // Fetch resource list (for CRD metadata)
            var resList = fetch('/apps/' + eg + '/' + ev, { headers: headers })
              .then(function(r) { return r.json(); })
              .catch(function() { return null; });

            // Fetch OpenAPI spec (for R8 access check)
            var openApi = fetch('/openapi/v3/apps/' + eg + '/' + ev, { headers: headers })
              .then(function(r) { return r.json(); })
              .catch(function() { return null; });

            return Promise.all([resList, openApi]).then(function(results) {
              var resourceList = results[0];
              var openApiSpec = results[1];
              var resources = resourceList && resourceList.resources;
              var paths = (openApiSpec && openApiSpec.paths) || {};
              if (!Array.isArray(resources)) return [];

              var out = [];
              resources.forEach(function(r) {
                if (r.name.includes('/')) return;
                // Check standard resource access
                var access = checkAccess(paths, group.name, ver, r.name, r.namespaced, false);
                if (access !== 'None') {
                  out.push({
                    plural: r.name,
                    kind: r.kind,
                    label: r.kind,
                    category: '',
                    panel: 'main',
                    group: group.name,
                    version: ver,
                    namespaced: r.namespaced,
                    isWorkflow: false
                  });
                }
                // Also check if this is a workflow CRD (has /workflows/v1/... paths)
                var wfAccess = checkAccess(paths, group.name, ver, r.name, r.namespaced, true);
                if (wfAccess !== 'None') {
                  out.push({
                    plural: r.name,
                    kind: r.kind,
                    label: r.kind,
                    category: '',
                    panel: 'main',
                    group: group.name,
                    version: ver,
                    namespaced: r.namespaced,
                    isWorkflow: true
                  });
                }
              });
              return out;
            });
          });

          Promise.all(promises).then(function(results) {
            var allKinds = [];
            results.forEach(function(kinds) {
              if (kinds) allKinds = allKinds.concat(kinds);
            });
            window.postMessage({ type: '${APPS_RESPONSE_MSG}', data: allKinds }, '*');
          });
        })
        .catch(function() {});
    }

    var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
      if (name === 'Authorization' && typeof value === 'string' && value.startsWith('Bearer ') && !window.__edaExtToken) {
        window.__edaExtToken = value.slice(7);
        XMLHttpRequest.prototype.setRequestHeader = origSetHeader;
        fetchAllResources(window.__edaExtToken);
      }
      return origSetHeader.call(this, name, value);
    };

    window.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'eda-ext-fetch-apps' && window.__edaExtToken) {
        fetchAllResources(window.__edaExtToken);
      }
      if (e.data && e.data.type === '${EQL_REQUEST_MSG}' && window.__edaExtToken) {
        var query = e.data.query;
        var reqId = e.data.reqId;
        var params = new URLSearchParams({ query: query });
        fetch('/core/query/v1/eql?' + params.toString(), {
          headers: {
            'Authorization': 'Bearer ' + window.__edaExtToken
          }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          window.postMessage({ type: '${EQL_RESPONSE_MSG}', reqId: reqId, data: data }, '*');
        })
        .catch(function(err) {
          window.postMessage({ type: '${EQL_RESPONSE_MSG}', reqId: reqId, error: err.message || 'EQL query failed' }, '*');
        });
      }
    });
  })();`;
  (document.documentElement || document.head).prepend(script);
  script.remove();
}

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

function processAppsResponse(data: unknown): void {
  if (!Array.isArray(data)) return;

  const items: NavItem[] = [];
  const seen = new Set(QUICK_ACTIONS.map((p) => p.href));

  // Add dedicated pages
  for (const [name, href] of Object.entries(DEDICATED_PAGES)) {
    if (seen.has(href)) continue;
    seen.add(href);
    const label = humanizeLabel(name);
    const section = href.includes('system_administration') ? 'Administration' : 'Quick Actions';
    items.push({ label, href, section, keywords: `${name} ${label.toLowerCase()}` });
  }

  for (const entry of data as ParsedKind[]) {
    if (!entry.plural || !entry.group || !entry.version) continue;

    if (entry.isWorkflow) {
      // Add "Run: <Kind>" workflow item
      const wfKey = `workflow-run:${entry.group}/${entry.version}/${entry.plural}`;
      if (seen.has(wfKey)) continue;
      seen.add(wfKey);

      const kind = entry.kind || entry.plural;
      const label = `Run: ${humanizeLabel(kind)}`;
      const keywords = `run workflow ${kind.toLowerCase()} ${entry.plural.toLowerCase()} ${entry.group.toLowerCase()} new create`;
      items.push({
        label,
        href: '/ui/main/workflows',
        section: 'Workflows',
        keywords,
        action: 'workflow-run',
        workflowMeta: { group: entry.group, version: entry.version, plural: entry.plural, kind },
      });
      continue;
    }

    const panel = entry.panel || getPanel(entry.group, entry.plural);
    const href = `/ui/app/${panel}/${encodeURIComponent(entry.group)}/${encodeURIComponent(entry.version)}/${encodeURIComponent(entry.plural)}`;

    if (seen.has(href)) continue;
    seen.add(href);

    const label = humanizeLabel(entry.label || entry.kind || entry.plural);
    const section = entry.category || groupToSection(entry.group) || 'Resources';
    const keywords = `${label.toLowerCase()} ${entry.plural.toLowerCase()} ${(entry.kind || '').toLowerCase()} ${entry.group.toLowerCase()}`;

    items.push({ label, href, section, keywords });
  }

  apiItems = items;
  apiFetched = true;
}

// EQL query state
let eqlReqCounter = 0;
let eqlLatestReqId = 0;
let eqlResults: EqlResult[] = [];
let eqlError = '';
let eqlLoading = false;
let eqlRenderCallback: (() => void) | null = null;

function processEqlResponse(data: unknown): EqlResult[] {
  if (!data || typeof data !== 'object') return [];
  const resp = data as Record<string, unknown>;

  // EQL responses have a "data" field with the results array
  const items = Array.isArray(resp.data) ? resp.data : Array.isArray(data) ? data : [];

  return items.map((item: Record<string, unknown>) => {
    const name = (item.name as string) || (item.metadata as Record<string, unknown>)?.name as string || '';
    const namespace = (item.namespace as string) || (item.metadata as Record<string, unknown>)?.namespace as string || '';
    const kind = (item.kind as string) || '';
    const apiVersion = (item.apiVersion as string) || '';

    // Build a path for display
    const parts = [apiVersion, namespace, kind, name].filter(Boolean);
    const path = parts.join('/');

    // Use kind as section
    const section = kind || 'Results';
    const label = name || JSON.stringify(item).slice(0, 80);

    return { label, path, section, fields: item };
  });
}

function setupMessageListener(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;

    if (event.data?.type === APPS_RESPONSE_MSG) {
      processAppsResponse(event.data.data);
    }

    if (event.data?.type === EQL_RESPONSE_MSG) {
      const reqId = event.data.reqId as number;
      if (reqId !== eqlLatestReqId) return; // stale response
      eqlLoading = false;
      if (event.data.error) {
        eqlError = event.data.error as string;
        eqlResults = [];
      } else {
        eqlError = '';
        eqlResults = processEqlResponse(event.data.data);
      }
      if (eqlRenderCallback) eqlRenderCallback();
    }
  });
}

// Fuzzy scoring: higher = better match
function scoreMatch(item: NavItem, query: string): number {
  const label = item.label.toLowerCase();
  const href = item.href.toLowerCase();
  const keywords = item.keywords;

  if (label === query) return 100;
  if (label.startsWith(query)) return 90;

  const words = label.split(/\s+/);
  if (words.some((w) => w.startsWith(query))) return 80;

  if (label.includes(query)) return 70;
  if (keywords.includes(query)) return 60;
  if (href.includes(query)) return 50;

  const queryWords = query.split(/\s+/);
  if (queryWords.length > 1 && queryWords.every((qw) => label.includes(qw) || keywords.includes(qw) || href.includes(qw))) {
    return 40;
  }

  // Subsequence match
  let qi = 0;
  for (let li = 0; li < label.length && qi < query.length; li++) {
    if (label[li] === query[qi]) qi++;
  }
  if (qi === query.length) return 20;

  return -1;
}

const SECTION_ORDER: Record<string, number> = {
  'Quick Actions': -1,
  System: 0,
  Tools: 1,
  Targets: 2,
  Topology: 3,
  'Node Management': 4,
  Configuration: 5,
  Fabrics: 6,
  'AI Fabrics': 7,
  'Virtual Networks': 8,
  'Overlay Routing': 9,
  'Default Routing': 10,
  Protocols: 11,
  Security: 12,
  QoS: 13,
  'Routing Policies': 14,
  Filters: 15,
  'System Interface': 16,
  OAM: 17,
  DHCP: 18,
  Timing: 19,
  Maintenance: 20,
  'Management Router': 21,
  Bootstrap: 22,
  'Site Profiles': 23,
  Components: 24,
  Core: 25,
  Allocations: 26,
  Resources: 27,
  Workflows: 28,
  'App Management': 29,
  Platform: 30,
  Proxies: 31,
  'User Management': 32,
  Administration: 33,
  Page: 99,
};

function getAllItems(): NavItem[] {
  const seen = new Set<string>();
  const items: NavItem[] = [];

  for (const item of [...QUICK_ACTIONS, ...apiItems]) {
    if (!seen.has(item.href)) {
      seen.add(item.href);
      items.push(item);
    }
  }

  items.sort((a, b) => {
    const sa = SECTION_ORDER[a.section] ?? 50;
    const sb = SECTION_ORDER[b.section] ?? 50;
    if (sa !== sb) return sa - sb;
    return a.label.localeCompare(b.label);
  });

  return items;
}

function createSpotlight(): HTMLDivElement {
  const existing = document.getElementById(SPOTLIGHT_ID);
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = SPOTLIGHT_ID;
  overlay.innerHTML = `
    <div class="eda-spotlight-backdrop"></div>
    <div class="eda-spotlight-panel">
      <div class="eda-spotlight-input-row">
        <svg class="eda-spotlight-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input class="eda-spotlight-input" type="text" placeholder="Search EDA... (type . for EQL)" autocomplete="off" spellcheck="false" />
        <kbd class="eda-spotlight-kbd">esc</kbd>
      </div>
      <div class="eda-spotlight-results"></div>
      <div class="eda-spotlight-footer">
        <span class="eda-spotlight-footer-hint"><kbd class="eda-spotlight-footer-key">&uarr;&darr;</kbd> navigate</span>
        <span class="eda-spotlight-footer-hint"><kbd class="eda-spotlight-footer-key">&crarr;</kbd> open</span>
        <span class="eda-spotlight-footer-hint"><kbd class="eda-spotlight-footer-key">.</kbd> EQL</span>
        <span class="eda-spotlight-footer-count"></span>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #${SPOTLIGHT_ID} { position: fixed; inset: 0; z-index: 2147483647; display: flex; justify-content: center; padding-top: 20vh; }
    .eda-spotlight-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); }
    .eda-spotlight-panel {
      position: relative; width: 560px; max-width: 90vw; max-height: 60vh;
      background: #1a222e; border: 1px solid #4a536180; border-radius: 12px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.4); display: flex; flex-direction: column;
      overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #fff;
    }
    .eda-spotlight-input-row {
      display: flex; align-items: center; gap: 8px; padding: 12px 16px;
      border-bottom: 1px solid #4a536180;
    }
    .eda-spotlight-icon { width: 18px; height: 18px; color: #c9ced6; flex-shrink: 0; }
    .eda-spotlight-input {
      flex: 1; background: none; border: none; outline: none;
      font-size: 15px; color: #fff; font-family: inherit;
    }
    .eda-spotlight-input::placeholder { color: #c9ced680; }
    .eda-spotlight-kbd {
      font-size: 10px; color: #c9ced6; border: 1px solid #4a536180;
      border-radius: 4px; padding: 2px 6px; white-space: nowrap; font-family: inherit;
    }
    .eda-spotlight-results { overflow-y: auto; flex: 1; max-height: calc(60vh - 90px); }
    .eda-spotlight-section {
      padding: 6px 16px 2px; font-size: 11px; color: #c9ced650;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500;
    }
    .eda-spotlight-item {
      display: flex; align-items: center; gap: 10px; padding: 8px 16px;
      cursor: pointer; text-decoration: none; color: #fff; border: none;
      background: none; width: 100%; text-align: left; font-family: inherit; font-size: 14px;
    }
    .eda-spotlight-item:hover, .eda-spotlight-item[data-selected="true"] {
      background: #6098ff22;
    }
    .eda-spotlight-item[data-selected="true"] { background: #6098ff33; }
    .eda-spotlight-item-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .eda-spotlight-item-path {
      font-size: 12px; color: #c9ced650; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; max-width: 200px;
    }
    .eda-spotlight-empty {
      padding: 24px 16px; text-align: center; color: #c9ced680; font-size: 13px;
    }
    .eda-spotlight-footer {
      display: flex; gap: 16px; padding: 6px 16px; border-top: 1px solid #4a536180;
      font-size: 11px; color: #c9ced650;
    }
    .eda-spotlight-footer-hint { display: flex; align-items: center; gap: 4px; }
    .eda-spotlight-footer-key {
      font-size: 10px; color: #c9ced6; border: 1px solid #4a536140;
      border-radius: 3px; padding: 0 4px; font-family: inherit; line-height: 1.6;
    }
    .eda-spotlight-footer-count { margin-left: auto; }
    .eda-spotlight-highlight { color: #6098ff; font-weight: 600; }
  `;
  overlay.prepend(style);
  return overlay;
}

let selectedIndex = 0;
let filteredItems: NavItem[] = [];

function highlightMatch(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) return escapeHtml(text);
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return `${escapeHtml(before)}<span class="eda-spotlight-highlight">${escapeHtml(match)}</span>${escapeHtml(after)}`;
}

function renderResults(container: HTMLElement, items: NavItem[], query: string, countEl?: HTMLElement) {
  filteredItems = items;
  selectedIndex = Math.max(0, Math.min(selectedIndex, items.length - 1));

  if (countEl) {
    countEl.textContent = `${items.length} result${items.length !== 1 ? 's' : ''}`;
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="eda-spotlight-empty">No matching pages</div>';
    return;
  }

  let html = '';
  let currentSection = '';

  items.forEach((item, i) => {
    if (item.section !== currentSection) {
      currentSection = item.section;
      html += `<div class="eda-spotlight-section">${escapeHtml(currentSection)}</div>`;
    }
    html += `
      <button class="eda-spotlight-item" data-index="${i}" data-selected="${i === selectedIndex}" data-href="${escapeAttr(item.href)}">
        <span class="eda-spotlight-item-label">${highlightMatch(item.label, query)}</span>
        <span class="eda-spotlight-item-path">${escapeHtml(item.href)}</span>
      </button>`;
  });

  container.innerHTML = html;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function navigate(href: string) {
  try {
    const url = new URL(href, location.origin);
    if (url.origin === location.origin) {
      history.pushState(null, '', url.pathname + url.search + url.hash);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else {
      location.href = href;
    }
  } catch {
    location.href = href;
  }
}

function triggerWorkflowRun(meta: { group: string; version: string; plural: string; kind: string }): void {
  // Navigate to workflows page first
  navigate('/ui/main/workflows');

  // After navigation, find and click the "New Workflow Run" button,
  // then select the correct workflow type from the dialog
  const maxAttempts = 20;
  let attempt = 0;

  function tryClick() {
    attempt++;
    // Look for the "New Workflow Run" button - typically a button containing that text
    const buttons = document.querySelectorAll('button');
    let newRunBtn: HTMLElement | null = null;
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toLowerCase() ?? '';
      if (text.includes('new workflow run') || text.includes('new run') || text.includes('create workflow')) {
        newRunBtn = btn;
        break;
      }
    }

    // Also check for MUI Fab buttons (floating action button with + icon)
    if (!newRunBtn) {
      const fabs = document.querySelectorAll('[class*="Fab"], [class*="fab"], [aria-label*="new"], [aria-label*="create"], [aria-label*="add"]');
      for (const fab of fabs) {
        if (fab instanceof HTMLElement) {
          newRunBtn = fab;
          break;
        }
      }
    }

    if (!newRunBtn) {
      if (attempt < maxAttempts) {
        setTimeout(tryClick, 300);
      }
      return;
    }

    newRunBtn.click();

    // After clicking, wait for the dialog to appear, then select the workflow type
    setTimeout(() => selectWorkflowType(meta, 0), 300);
  }

  setTimeout(tryClick, 500);
}

function selectWorkflowType(meta: { group: string; version: string; plural: string; kind: string }, attempt: number): void {
  if (attempt > 15) return;

  // Look for the workflow type selector in the dialog
  // The dialog typically has a dropdown/select or list of workflow types
  // Try to find a select element or listbox with the workflow kinds
  const dialogs = document.querySelectorAll('[role="dialog"], [role="presentation"], [class*="Modal"], [class*="Dialog"]');
  if (dialogs.length === 0) {
    setTimeout(() => selectWorkflowType(meta, attempt + 1), 300);
    return;
  }

  // Look for a select/dropdown that contains workflow type options
  const selects = document.querySelectorAll('select, [role="listbox"], [role="combobox"], [class*="Select"]');
  for (const sel of selects) {
    // For native select elements
    if (sel instanceof HTMLSelectElement) {
      for (const opt of sel.options) {
        if (opt.text.toLowerCase().includes(meta.kind.toLowerCase()) || opt.value.toLowerCase().includes(meta.plural.toLowerCase())) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
    }
  }

  // For MUI Select components, try clicking the select to open the dropdown,
  // then clicking the matching option
  const muiSelects = document.querySelectorAll('[class*="MuiSelect"], [class*="select"], [role="button"][aria-haspopup]');
  for (const muiSel of muiSelects) {
    if (muiSel instanceof HTMLElement) {
      muiSel.click();
      setTimeout(() => {
        // Look for the option in the opened menu
        const menuItems = document.querySelectorAll('[role="option"], [role="menuitem"], [class*="MenuItem"], li[class*="MuiMenuItem"]');
        for (const item of menuItems) {
          const text = item.textContent?.trim().toLowerCase() ?? '';
          if (text.includes(meta.kind.toLowerCase()) || text.includes(humanizeLabel(meta.kind).toLowerCase())) {
            (item as HTMLElement).click();
            return;
          }
        }
      }, 300);
      return;
    }
  }

  // Retry if dialog elements haven't fully rendered
  setTimeout(() => selectWorkflowType(meta, attempt + 1), 300);
}

function renderEqlResults(container: HTMLElement, items: EqlResult[], countEl?: HTMLElement) {
  selectedIndex = Math.max(0, Math.min(selectedIndex, items.length - 1));

  if (countEl) {
    countEl.textContent = `${items.length} result${items.length !== 1 ? 's' : ''}`;
  }

  if (eqlLoading) {
    container.innerHTML = '<div class="eda-spotlight-empty">Running EQL query...</div>';
    return;
  }

  if (eqlError) {
    container.innerHTML = `<div class="eda-spotlight-empty">${escapeHtml(eqlError)}</div>`;
    return;
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="eda-spotlight-empty">No results — type an EQL query after the dot</div>';
    return;
  }

  let html = '';
  let currentSection = '';

  items.forEach((item, i) => {
    if (item.section !== currentSection) {
      currentSection = item.section;
      html += `<div class="eda-spotlight-section">${escapeHtml(currentSection)}</div>`;
    }
    html += `
      <button class="eda-spotlight-item" data-index="${i}" data-selected="${i === selectedIndex}" data-eql-index="${i}">
        <span class="eda-spotlight-item-label">${escapeHtml(item.label)}</span>
        <span class="eda-spotlight-item-path">${escapeHtml(item.path)}</span>
      </button>`;
  });

  container.innerHTML = html;
}

function sendEqlQuery(query: string): void {
  eqlReqCounter++;
  eqlLatestReqId = eqlReqCounter;
  eqlLoading = true;
  eqlResults = [];
  eqlError = '';
  window.postMessage({ type: EQL_REQUEST_MSG, query, reqId: eqlLatestReqId }, '*');
}

function openSpotlight() {
  // Re-fetch if we haven't got apps yet
  if (!apiFetched) {
    window.postMessage({ type: 'eda-ext-fetch-apps' }, '*');
  }

  const overlay = createSpotlight();
  document.body.appendChild(overlay);

  const input = overlay.querySelector<HTMLInputElement>('.eda-spotlight-input')!;
  const results = overlay.querySelector<HTMLElement>('.eda-spotlight-results')!;
  const backdrop = overlay.querySelector<HTMLElement>('.eda-spotlight-backdrop')!;
  const countEl = overlay.querySelector<HTMLElement>('.eda-spotlight-footer-count')!;

  const navItems = getAllItems();
  selectedIndex = 0;
  let eqlMode = false;
  let eqlDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  renderResults(results, navItems, '', countEl);

  input.focus();

  function renderCurrentEql() {
    renderEqlResults(results, eqlResults, countEl);
  }

  eqlRenderCallback = renderCurrentEql;

  function filter() {
    const raw = input.value;

    // EQL mode: first char is "."
    if (raw.startsWith('.')) {
      eqlMode = true;
      input.placeholder = 'EQL query...';
      const query = raw.trim();

      if (!query) {
        eqlResults = [];
        eqlError = '';
        eqlLoading = false;
        selectedIndex = 0;
        renderEqlResults(results, [], countEl);
        return;
      }

      // Debounce EQL queries (300ms)
      if (eqlDebounceTimer) clearTimeout(eqlDebounceTimer);
      eqlDebounceTimer = setTimeout(() => {
        sendEqlQuery(query);
        renderCurrentEql(); // show loading state
      }, 300);
      return;
    }

    // Normal navigation mode
    if (eqlMode) {
      eqlMode = false;
      input.placeholder = 'Search EDA...';
      eqlResults = [];
      eqlError = '';
      eqlLoading = false;
    }

    const q = raw.toLowerCase().trim();
    if (!q) {
      selectedIndex = 0;
      renderResults(results, navItems, '', countEl);
      return;
    }

    const scored = navItems
      .map((item) => ({ item, score: scoreMatch(item, q) }))
      .filter((s) => s.score >= 0)
      .sort((a, b) => b.score - a.score);

    selectedIndex = 0;
    renderResults(results, scored.map((s) => s.item), q, countEl);
  }

  function close() {
    eqlRenderCallback = null;
    if (eqlDebounceTimer) clearTimeout(eqlDebounceTimer);
    overlay.remove();
  }

  function navigateToEql() {
    const query = input.value.trim();
    close();
    navigate('/ui/main/queryapi');
    // Fill the query into the EDA Query API editor after navigation
    setTimeout(() => {
      const editor = document.getElementById('QueryBuilderInput-eql-Input-Autocomplete') as HTMLInputElement | null;
      if (editor) {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(editor, query);
        else editor.value = query;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        editor.focus();
        setTimeout(() => {
          editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }, 200);
      }
    }, 500);
  }

  function selectCurrent() {
    if (eqlMode) {
      navigateToEql();
      return;
    }
    if (filteredItems.length > 0) {
      const item = filteredItems[selectedIndex];
      close();
      if (item.action === 'workflow-run' && item.workflowMeta) {
        triggerWorkflowRun(item.workflowMeta);
      } else {
        navigate(item.href);
      }
    }
  }

  input.addEventListener('input', filter);

  input.addEventListener('keydown', (e) => {
    const maxIndex = eqlMode ? eqlResults.length - 1 : filteredItems.length - 1;

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, maxIndex);
      if (eqlMode) {
        renderEqlResults(results, eqlResults, countEl);
      } else {
        renderResults(results, filteredItems, input.value.toLowerCase().trim(), countEl);
      }
      results.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      if (eqlMode) {
        renderEqlResults(results, eqlResults, countEl);
      } else {
        renderResults(results, filteredItems, input.value.toLowerCase().trim(), countEl);
      }
      results.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectCurrent();
    }
  });

  results.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.eda-spotlight-item');
    if (!btn) return;

    if (eqlMode) {
      navigateToEql();
      return;
    }

    const idx = parseInt(btn.dataset.index ?? '0', 10);
    const item = filteredItems[idx];
    if (item) {
      close();
      if (item.action === 'workflow-run' && item.workflowMeta) {
        triggerWorkflowRun(item.workflowMeta);
      } else {
        navigate(item.href);
      }
    }
  });

  backdrop.addEventListener('click', close);
}

function isSpotlightOpen(): boolean {
  return !!document.getElementById(SPOTLIGHT_ID);
}

/**
 * Must be called at document_start (before page scripts load)
 * to intercept the auth token from XHR requests.
 */
export function injectSpotlightInterceptor(): void {
  injectAppsFetcher();
  setupMessageListener();
}

export function initSpotlight(): void {

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      if (isSpotlightOpen()) {
        document.getElementById(SPOTLIGHT_ID)?.remove();
      } else {
        openSpotlight();
      }
    }
  }, true);
}
