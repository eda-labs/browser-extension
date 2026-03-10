import { api } from './api';

export const OMNISEARCH_HOTKEY_STORAGE_KEY = 'omnisearchHotkey';
export const AUTO_SIZE_ALL_COLUMNS_STORAGE_KEY = 'autoSizeAllColumns';

export interface OmnisearchHotkey {
  code: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  usePrimaryModifier: boolean;
}

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

const CODE_LABELS: Record<string, string> = {
  Space: 'Space',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: '\'',
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  ArrowUp: 'Arrow Up',
  ArrowDown: 'Arrow Down',
  ArrowLeft: 'Arrow Left',
  ArrowRight: 'Arrow Right',
};

export const DEFAULT_OMNISEARCH_HOTKEY: OmnisearchHotkey = {
  code: 'KeyK',
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
  usePrimaryModifier: true,
};

type HotkeyEvent = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

export function normalizeAutoSizeAllColumns(value: unknown): boolean {
  return toBoolean(value);
}

export function hasHotkeyModifier(hotkey: OmnisearchHotkey): boolean {
  return hotkey.usePrimaryModifier || hotkey.ctrl || hotkey.meta || hotkey.alt || hotkey.shift;
}

export function normalizeOmnisearchHotkey(value: unknown): OmnisearchHotkey {
  if (!isRecord(value)) {
    return DEFAULT_OMNISEARCH_HOTKEY;
  }

  const code = typeof value.code === 'string' && value.code.length > 0
    ? value.code
    : DEFAULT_OMNISEARCH_HOTKEY.code;
  const ctrl = toBoolean(value.ctrl);
  const meta = toBoolean(value.meta);
  const alt = toBoolean(value.alt);
  const shift = toBoolean(value.shift);
  const usePrimaryModifier = toBoolean(value.usePrimaryModifier);

  if (usePrimaryModifier) {
    return {
      code,
      ctrl: false,
      meta: false,
      alt,
      shift,
      usePrimaryModifier: true,
    };
  }

  const candidate: OmnisearchHotkey = {
    code,
    ctrl,
    meta,
    alt,
    shift,
    usePrimaryModifier: false,
  };

  return hasHotkeyModifier(candidate) ? candidate : DEFAULT_OMNISEARCH_HOTKEY;
}

export function keyLabelFromCode(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad') && code.length > 6) return `Num ${code.slice(6)}`;
  if (/^F\d{1,2}$/u.test(code)) return code;
  return code.replace(/^Arrow/u, 'Arrow ').replace(/([a-z])([A-Z])/gu, '$1 $2').trim() || code;
}

export function formatOmnisearchHotkey(hotkey: OmnisearchHotkey): string {
  const parts: string[] = [];

  if (hotkey.usePrimaryModifier) {
    parts.push('Ctrl/Cmd');
  } else {
    if (hotkey.ctrl) parts.push('Ctrl');
    if (hotkey.meta) parts.push('Cmd');
  }
  if (hotkey.alt) parts.push('Alt');
  if (hotkey.shift) parts.push('Shift');
  parts.push(keyLabelFromCode(hotkey.code));

  return parts.join(' + ');
}

export function createHotkeyFromKeyboardEvent(event: HotkeyEvent): OmnisearchHotkey | null {
  if (!event.code || event.code === 'Unidentified' || MODIFIER_CODES.has(event.code)) {
    return null;
  }

  const candidate: OmnisearchHotkey = {
    code: event.code,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
    usePrimaryModifier: false,
  };

  if (!hasHotkeyModifier(candidate)) {
    return null;
  }

  return candidate;
}

export function matchesOmnisearchHotkey(event: HotkeyEvent, hotkey: OmnisearchHotkey): boolean {
  if (event.code !== hotkey.code) return false;

  if (hotkey.usePrimaryModifier) {
    if (!(event.ctrlKey || event.metaKey)) return false;
    if (event.altKey !== hotkey.alt) return false;
    if (event.shiftKey !== hotkey.shift) return false;
    return true;
  }

  return (
    event.ctrlKey === hotkey.ctrl
    && event.metaKey === hotkey.meta
    && event.altKey === hotkey.alt
    && event.shiftKey === hotkey.shift
  );
}

export async function getOmnisearchHotkey(): Promise<OmnisearchHotkey> {
  const stored = await api.storage.local.get([OMNISEARCH_HOTKEY_STORAGE_KEY]);
  return normalizeOmnisearchHotkey(stored[OMNISEARCH_HOTKEY_STORAGE_KEY]);
}

export async function setOmnisearchHotkey(hotkey: OmnisearchHotkey): Promise<void> {
  await api.storage.local.set({
    [OMNISEARCH_HOTKEY_STORAGE_KEY]: normalizeOmnisearchHotkey(hotkey),
  });
}
