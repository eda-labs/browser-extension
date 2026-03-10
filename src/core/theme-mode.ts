export type ThemeMode = 'light' | 'dark';

export const EDA_THEME_MODE_STORAGE_KEY = 'edaThemeMode';
export const EDA_FONT_FAMILY_STORAGE_KEY = 'edaFontFamily';
export const DEFAULT_THEME_MODE: ThemeMode = 'dark';

const MODE_CANDIDATE_ATTRIBUTES = [
  'data-mui-color-scheme',
  'data-color-scheme',
  'data-theme',
  'theme',
] as const;

function asThemeMode(value: unknown): ThemeMode | null {
  return value === 'light' || value === 'dark' ? value : null;
}

function pickThemeModeFromText(value: string | null | undefined): ThemeMode | null {
  if (!value) return null;
  const direct = asThemeMode(value.trim().toLowerCase());
  if (direct) return direct;

  const normalized = value.toLowerCase();
  if (normalized.includes('darkmode')) return 'dark';
  if (normalized.includes('lightmode')) return 'light';
  if (/(^|[^a-z])dark([^a-z]|$)/u.test(normalized)) return 'dark';
  if (/(^|[^a-z])light([^a-z]|$)/u.test(normalized)) return 'light';
  return null;
}

function pickThemeModeFromColorScheme(value: string | null | undefined): ThemeMode | null {
  if (!value) return null;
  const tokens = value
    .toLowerCase()
    .split(/\s+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  if (tokens[0] === 'dark') return 'dark';
  if (tokens[0] === 'light') return 'light';
  if (tokens.includes('dark') && !tokens.includes('light')) return 'dark';
  if (tokens.includes('light') && !tokens.includes('dark')) return 'light';
  return null;
}

interface ParsedColor {
  red: number;
  green: number;
  blue: number;
}

const CSS_FONT_INJECTION_TOKENS = /[;\n\r{}]/u;
const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'emoji',
  'math',
  'fangsong',
]);

function clampChannel(channel: number): number {
  return Math.max(0, Math.min(255, channel));
}

function parseColorChannel(value: string): number | null {
  if (value.endsWith('%')) {
    const parsedPercent = Number.parseFloat(value.slice(0, -1));
    if (Number.isNaN(parsedPercent)) return null;
    return clampChannel((parsedPercent / 100) * 255);
  }
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return null;
  return clampChannel(parsed);
}

function parseRgbColor(value: string): ParsedColor | null {
  if (!value || value === 'transparent') return null;
  const match = value.match(/^rgba?\((.+)\)$/iu);
  if (!match) return null;

  const rawChannels = match[1].split(',').map((entry) => entry.trim());
  if (rawChannels.length < 3) return null;

  const red = parseColorChannel(rawChannels[0]);
  const green = parseColorChannel(rawChannels[1]);
  const blue = parseColorChannel(rawChannels[2]);
  if (red == null || green == null || blue == null) return null;

  const alpha = rawChannels.length > 3 ? Number.parseFloat(rawChannels[3]) : 1;
  if (Number.isNaN(alpha) || alpha <= 0) return null;

  return {
    red,
    green,
    blue,
  };
}

function linearizeSrgb(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function getRelativeLuminance(color: ParsedColor): number {
  const red = linearizeSrgb(color.red);
  const green = linearizeSrgb(color.green);
  const blue = linearizeSrgb(color.blue);
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function sanitizeFontFamily(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > 220) return null;
  if (CSS_FONT_INJECTION_TOKENS.test(normalized)) return null;
  return normalized;
}

function firstFontToken(fontFamily: string): string {
  const first = fontFamily.split(',')[0]?.trim() ?? '';
  return first.replace(/^['"]|['"]$/gu, '').trim().toLowerCase();
}

function scoreFontFamily(fontFamily: string): number {
  const normalized = fontFamily.toLowerCase();
  if (normalized.includes('nokia') && normalized.includes('pure')) return 5;
  if (normalized.includes('nokia')) return 4;
  if (normalized.includes('pure')) return 3;

  const firstToken = firstFontToken(fontFamily);
  if (!firstToken || GENERIC_FONT_FAMILIES.has(firstToken)) return 1;
  return 2;
}

export function normalizeStoredThemeMode(
  value: unknown,
  fallback: ThemeMode = DEFAULT_THEME_MODE,
): ThemeMode {
  return asThemeMode(value) ?? fallback;
}

export function normalizeStoredFontFamily(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return sanitizeFontFamily(value);
}

export function detectThemeModeFromDocument(doc: Document = document): ThemeMode {
  const root = doc.documentElement;
  const body = doc.body;
  const modeSources = [root, body].filter((entry): entry is HTMLElement => entry != null);

  for (const source of modeSources) {
    for (const attributeName of MODE_CANDIDATE_ATTRIBUTES) {
      const mode = pickThemeModeFromText(source.getAttribute(attributeName));
      if (mode) return mode;
    }
  }

  for (const source of modeSources) {
    const className = typeof source.className === 'string' ? source.className : '';
    const mode = pickThemeModeFromText(className);
    if (mode) return mode;
  }

  const defaultView = doc.defaultView;
  if (defaultView) {
    for (const source of modeSources) {
      const computed = defaultView.getComputedStyle(source);
      const mode = pickThemeModeFromColorScheme(computed.colorScheme);
      if (mode) return mode;
    }

    for (const source of modeSources) {
      const computed = defaultView.getComputedStyle(source);
      const color = parseRgbColor(computed.backgroundColor);
      if (!color) continue;
      return getRelativeLuminance(color) >= 0.35 ? 'light' : 'dark';
    }
  }

  return DEFAULT_THEME_MODE;
}

export function detectPreferredFontFamilyFromDocument(doc: Document = document): string | null {
  const modeSources = [doc.body, doc.documentElement].filter((entry): entry is HTMLElement => entry != null);
  if (modeSources.length === 0 || !doc.defaultView) return null;

  let bestCandidate: string | null = null;
  let bestScore = 0;

  for (const source of modeSources) {
    const computed = doc.defaultView.getComputedStyle(source);
    const candidate = sanitizeFontFamily(computed.fontFamily);
    if (!candidate) continue;
    const score = scoreFontFamily(candidate);
    if (score > bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  return bestCandidate;
}
