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

const ITEM_TYPE_BASE_ADJUSTMENT = {
  action: 16,
  page: 12,
  resource: 18,
  instance: -24,
  workflow: 14,
} as const;

const ITEM_TYPE_SORT_ORDER = {
  resource: 0,
  action: 1,
  workflow: 2,
  page: 3,
  instance: 4,
} as const;

export function navItemTypeSortOrder(item: NavItem): number {
  if (!item.itemType) return 1;
  return ITEM_TYPE_SORT_ORDER[item.itemType] ?? 1;
}

function itemTypeScoreAdjustment(item: NavItem, query: string): number {
  const type = item.itemType;
  if (!type) return 0;

  if (type === 'instance') {
    const looksSpecific =
      query.length >= 14 ||
      /[/:._-]/.test(query) ||
      query.trim().split(/\s+/).length > 1;
    return looksSpecific ? -8 : ITEM_TYPE_BASE_ADJUSTMENT.instance;
  }

  return ITEM_TYPE_BASE_ADJUSTMENT[type] ?? 0;
}

export function scoreMatch(item: NavItem, query: string): number {
  const label = item.label.toLowerCase();
  const href = item.href.toLowerCase();
  const keywords = item.keywords.toLowerCase();
  let rawScore = -1;

  if (label === query) rawScore = 100;
  else if (label.startsWith(query)) rawScore = 90;

  const words = label.split(/\s+/);
  if (rawScore < 0 && words.some((word) => word.startsWith(query))) rawScore = 80;

  if (rawScore < 0 && label.includes(query)) rawScore = 70;
  if (rawScore < 0 && keywords.includes(query)) rawScore = 60;
  if (rawScore < 0 && href.includes(query)) rawScore = 50;

  const queryWords = query.split(/\s+/);
  if (
    rawScore < 0 &&
    queryWords.length > 1 &&
    queryWords.every((queryWord) => label.includes(queryWord) || keywords.includes(queryWord) || href.includes(queryWord))
  ) {
    rawScore = 40;
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
  if (rawScore < 0 && queryIndex === query.length && maxGap <= 3) rawScore = 20;

  if (rawScore < 0) return -1;
  return rawScore + itemTypeScoreAdjustment(item, query);
}

export function dedupeAndSortItems(items: NavItem[]): NavItem[] {
  const seen = new Set<string>();
  const out: NavItem[] = [];

  for (const item of items) {
    const key = `${item.href}::${item.label}`;
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
