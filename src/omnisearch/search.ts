import type { NavItem } from './types';

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

export function scoreMatch(item: NavItem, query: string): number {
  const label = item.label.toLowerCase();
  const href = item.href.toLowerCase();
  const keywords = item.keywords.toLowerCase();

  if (label === query) return 100;
  if (label.startsWith(query)) return 90;

  const words = label.split(/\s+/);
  if (words.some((word) => word.startsWith(query))) return 80;

  if (label.includes(query)) return 70;
  if (keywords.includes(query)) return 60;
  if (href.includes(query)) return 50;

  const queryWords = query.split(/\s+/);
  if (queryWords.length > 1 && queryWords.every((queryWord) => label.includes(queryWord) || keywords.includes(queryWord) || href.includes(queryWord))) {
    return 40;
  }

  // Fuzzy subsequence: characters must appear in order with limited gaps
  let queryIndex = 0;
  let lastMatchIndex = -1;
  let maxGap = 0;
  for (let labelIndex = 0; labelIndex < label.length && queryIndex < query.length; labelIndex += 1) {
    if (label[labelIndex] === query[queryIndex]) {
      if (lastMatchIndex >= 0) maxGap = Math.max(maxGap, labelIndex - lastMatchIndex - 1);
      lastMatchIndex = labelIndex;
      queryIndex += 1;
    }
  }
  if (queryIndex === query.length && maxGap <= 3) return 20;

  return -1;
}

export function dedupeAndSortItems(items: NavItem[]): NavItem[] {
  const seen = new Set<string>();
  const out: NavItem[] = [];

  for (const item of items) {
    const key = item.action === 'workflow-run' && item.workflowMeta
      ? `workflow:${item.workflowMeta.group}/${item.workflowMeta.version}/${item.workflowMeta.plural}`
      : `${item.href}::${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  out.sort((a, b) => {
    const sectionA = SECTION_ORDER[a.section] ?? 50;
    const sectionB = SECTION_ORDER[b.section] ?? 50;
    if (sectionA !== sectionB) return sectionA - sectionB;
    return a.label.localeCompare(b.label);
  });

  return out;
}
