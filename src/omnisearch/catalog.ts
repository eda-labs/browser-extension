import type { NavItem, ParsedKind } from './types';

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

const SYSTEM_ADMIN_RESOURCES: Record<string, Set<string>> = {
  'core.eda.nokia.com': new Set(['namespaces', 'httpproxies', 'udpproxies', 'roles', 'clusterroles']),
  'appstore.eda.nokia.com': new Set(['catalogs', 'registries']),
};

const DEDICATED_PAGES: Record<string, string> = {
  workflows: '/ui/main/workflows',
  alarms: '/ui/main/alarms',
  transactions: '/ui/main/transactions',
  topologies: '/ui/main/topologies',
  'physical-topology': '/ui/main/topologies/topologies.eda.nokia.com_v1alpha1_physical',
  dashboards: '/ui/main/uibuilder',
  queryapi: '/ui/main/queryapi',
  apidocs: '/ui/main/apidocs',
  appstore: '/ui/system_administration/appstore',
  'role-based-access-control': '/ui/system_administration/role-based-access-control',
  'password-policy': '/ui/system_administration/password-policy',
};

function getPanel(group: string, plural: string): string {
  return SYSTEM_ADMIN_RESOURCES[group]?.has(plural) ? 'system_administration' : 'main';
}

function groupToSection(group: string): string | undefined {
  return GROUP_TO_SECTION[group];
}

export function humanizeLabel(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();
}

export function processAppsPayload(data: unknown, quickActions: NavItem[]): NavItem[] | null {
  if (!Array.isArray(data)) return null;

  const items: NavItem[] = [];
  const seen = new Set(quickActions.map((item) => item.href));

  for (const [name, href] of Object.entries(DEDICATED_PAGES)) {
    if (seen.has(href)) continue;
    seen.add(href);
    const label = humanizeLabel(name);
    const section = href.includes('system_administration') ? 'Administration' : 'Quick Actions';
    items.push({ label, href, section, keywords: `${name} ${label.toLowerCase()}` });
  }

  for (const entry of data as ParsedKind[]) {
    if (!entry.plural || !entry.group || !entry.version) continue;
    const panel = entry.panel || getPanel(entry.group, entry.plural);
    const href = `/ui/app/${panel}/${encodeURIComponent(entry.group)}/${encodeURIComponent(entry.version)}/${encodeURIComponent(entry.plural)}`;

    if (entry.isInstance) {
      const instanceName = (entry.instanceName || entry.label || '').trim();
      if (!instanceName) continue;
      const instanceNamespace = (entry.instanceNamespace || '').trim();
      const instanceKey = `instance:${entry.group}/${entry.version}/${entry.plural}/${instanceNamespace}/${instanceName}`;
      if (seen.has(instanceKey)) continue;
      seen.add(instanceKey);

      const kindLabel = humanizeLabel(entry.kind || entry.plural);
      const label = instanceNamespace
        ? `${kindLabel}: ${instanceName} (${instanceNamespace})`
        : `${kindLabel}: ${instanceName}`;
      const section = entry.category || groupToSection(entry.group) || 'Resources';
      const keywords = [
        instanceName.toLowerCase(),
        instanceNamespace.toLowerCase(),
        kindLabel.toLowerCase(),
        entry.plural.toLowerCase(),
        entry.group.toLowerCase(),
        (entry.instanceSearchText || '').toLowerCase(),
        'resource',
        'instance',
      ].join(' ');

      items.push({ label, href, section, keywords });
      continue;
    }

    const resourceKey = `resource:${href}`;
    if (seen.has(resourceKey)) continue;
    seen.add(resourceKey);

    const label = humanizeLabel(entry.label || entry.kind || entry.plural);
    const section = entry.category || groupToSection(entry.group) || 'Resources';
    const keywords = `${label.toLowerCase()} ${entry.plural.toLowerCase()} ${(entry.kind || '').toLowerCase()} ${entry.group.toLowerCase()}`;

    items.push({ label, href, section, keywords });
  }

  return items;
}
