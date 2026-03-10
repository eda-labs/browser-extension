import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  createTheme,
  ThemeProvider,
  useTheme,
  Box,
  InputBase,
  Typography,
  Paper,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  ButtonBase,
} from '@mui/material';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import SearchIcon from '@mui/icons-material/Search';
import KeyboardReturnIcon from '@mui/icons-material/KeyboardReturn';
import type { ThemeMode } from '../core/theme-mode';
import type { EqlAutocompleteItem, EqlResult, NavItem } from './types';
import { flattenResultFields, pickTableColumns, processEqlResponse, processEqlAutocompleteResponse } from './eql';
import { navItemTypeSortOrder, scoreMatch } from './search';
import { navigate } from './navigation';
import {
  EQL_AUTOCOMPLETE_REQUEST_MSG,
  EQL_AUTOCOMPLETE_RESPONSE_MSG,
  EQL_REQUEST_MSG,
  EQL_RESPONSE_MSG,
  OMNISEARCH_BRIDGE_CHANNEL,
} from './constants';

// ── Constants ──

const PAGE_TARGET_ORIGIN = window.location.origin === 'null' ? '*' : window.location.origin;
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const EQL_DISPLAY_LIMIT = 40;
const AUTOCOMPLETE_DEBOUNCE_MS = 150;

let _emotionCache: ReturnType<typeof createCache> | null = null;
function getEmotionCache() {
  if (!_emotionCache) _emotionCache = createCache({ key: 'eda-omni', prepend: true });
  return _emotionCache;
}

// ── MUI theme augmentation ──

interface CustomPalette {
  textStrong: string;
  textMuted: string;
  textSubtle: string;
  accentWeak: string;
  accentStrong: string;
  completionBg: string;
  tableBg: string;
  tableHeadBg: string;
  tableDivider: string;
  kbdBorder: string;
  footerKbdBorder: string;
  shadow: string;
  backdropBg: string;
}

declare module '@mui/material/styles' {
  interface Palette {
    custom: CustomPalette;
  }
  interface PaletteOptions {
    custom?: CustomPalette;
  }
}

const DARK_CUSTOM: CustomPalette = {
  textStrong: '#dde5f2',
  textMuted: '#c9ced680',
  textSubtle: '#c9ced650',
  accentWeak: '#6098ff22',
  accentStrong: '#6098ff33',
  completionBg: '#111824',
  tableBg: '#111824',
  tableHeadBg: '#1d2633',
  tableDivider: '#4a536140',
  kbdBorder: '#4a536180',
  footerKbdBorder: '#4a536140',
  shadow: '0 16px 48px rgba(0,0,0,0.4)',
  backdropBg: 'rgba(0,0,0,0.5)',
};

const LIGHT_CUSTOM: CustomPalette = {
  textStrong: '#1f2f45',
  textMuted: '#42526a99',
  textSubtle: '#42526a80',
  accentWeak: '#2f72ff14',
  accentStrong: '#2f72ff24',
  completionBg: '#ffffff',
  tableBg: '#f7f9fc',
  tableHeadBg: '#eef2f8',
  tableDivider: '#d6dce8',
  kbdBorder: '#d6dce8',
  footerKbdBorder: '#d6dce8',
  shadow: '0 16px 48px rgba(15,23,42,0.18)',
  backdropBg: 'rgba(15,23,42,0.28)',
};

// ── Theme ──

function createOmnisearchTheme(mode: ThemeMode, fontFamily: string | null) {
  const isDark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: { main: isDark ? '#6098ff' : '#2f72ff' },
      background: { default: isDark ? '#1a222e' : '#ffffff', paper: isDark ? '#1a222e' : '#ffffff' },
      text: { primary: isDark ? '#ffffff' : '#152033', secondary: isDark ? '#c9ced6' : '#42526a' },
      divider: isDark ? '#4a536180' : '#d6dce8',
      custom: isDark ? DARK_CUSTOM : LIGHT_CUSTOM,
    },
    typography: {
      fontFamily: fontFamily || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
  });
}

// ── Sub-components ──

function Kbd({ children, footer }: { children: React.ReactNode; footer?: boolean }) {
  const c = useTheme().palette.custom;
  return (
    <Box
      component="span"
      sx={{
        fontSize: 10,
        color: 'text.secondary',
        border: '1px solid',
        borderColor: footer ? c.footerKbdBorder : c.kbdBorder,
        borderRadius: footer ? '3px' : '4px',
        px: footer ? '4px' : '6px',
        py: footer ? 0 : '2px',
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        lineHeight: footer ? 1.6 : undefined,
      }}
    >
      {children}
    </Box>
  );
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <Box component="span" sx={{ color: 'primary.main', fontWeight: 600 }}>
        {text.slice(idx, idx + query.length)}
      </Box>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Props ──

export interface NavState {
  items: NavItem[];
  loading: boolean;
  error: string;
  bridgeReady: boolean;
  loadingStartedAt: number;
  loadingPhase: 'none' | 'apps' | 'resources';
  loadedAt: number;
  lastLoadDurationMs: number;
}

export interface OmnisearchOverlayProps {
  mode: ThemeMode;
  fontFamily: string | null;
  getNavState: () => NavState;
  onClose: () => void;
  subscribeNavUpdate: (cb: () => void) => () => void;
}

// ── Main Component ──

export function OmnisearchOverlay({ mode, fontFamily, getNavState, onClose, subscribeNavUpdate }: OmnisearchOverlayProps) {
  const theme = useMemo(() => createOmnisearchTheme(mode, fontFamily), [mode, fontFamily]);
  const colors = theme.palette.custom;

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // EQL state
  const [eqlResults, setEqlResults] = useState<EqlResult[]>([]);
  const [eqlLoading, setEqlLoading] = useState(false);
  const [eqlError, setEqlError] = useState('');
  const [completions, setCompletions] = useState<EqlAutocompleteItem[]>([]);
  const [completionsLoading, setCompletionsLoading] = useState(false);
  const [completionsError, setCompletionsError] = useState('');

  // Nav state versioning
  const [navVersion, setNavVersion] = useState(0);
  const [loadingClockMs, setLoadingClockMs] = useState(() => Date.now());

  const inputRef = useRef<HTMLInputElement>(null);
  const completionsRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const eqlReqIdRef = useRef(0);
  const autocompleteReqIdRef = useRef(0);
  const debounceTimerRef = useRef(0);
  const queryRef = useRef('');

  // Derived state
  const eqlMode = query.startsWith('.');
  const placeholder = eqlMode ? 'EQL query...' : 'Search EDA... (type . for EQL)';

  // Keep queryRef in sync for message handler
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  // Auto-focus
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Subscribe to nav state changes
  useEffect(() => subscribeNavUpdate(() => setNavVersion((v) => v + 1)), [subscribeNavUpdate]);

  useEffect(() => {
    const state = getNavState();
    if (!state.loading) return;
    const timer = window.setInterval(() => {
      setLoadingClockMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [getNavState, navVersion]);

  // EQL message listener
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (window.location.origin !== 'null' && event.origin !== window.location.origin) return;
      if (!event.data || typeof event.data !== 'object') return;
      const data = event.data as Record<string, unknown>;
      if (data.channel !== OMNISEARCH_BRIDGE_CHANNEL) return;

      if (data.type === EQL_RESPONSE_MSG) {
        if ((data.reqId as number) !== eqlReqIdRef.current) return;
        setEqlLoading(false);
        if (data.error) {
          setEqlError(data.error as string);
          setEqlResults([]);
        } else {
          setEqlError('');
          setEqlResults(processEqlResponse(data.data));
        }
        return;
      }

      if (data.type === EQL_AUTOCOMPLETE_RESPONSE_MSG) {
        if ((data.reqId as number) !== autocompleteReqIdRef.current) return;
        setCompletionsLoading(false);
        if (data.error) {
          setCompletionsError(data.error as string);
          setCompletions([]);
        } else {
          setCompletionsError('');
          setCompletions(processEqlAutocompleteResponse(data.data, queryRef.current).slice(0, 10));
          setSelectedIndex(0);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Send EQL queries when query changes
  useEffect(() => {
    if (!eqlMode || query.length <= 1) return;

    eqlReqIdRef.current++;
    setEqlLoading(true);
    setEqlResults([]);
    setEqlError('');
    window.postMessage(
      { type: EQL_REQUEST_MSG, channel: OMNISEARCH_BRIDGE_CHANNEL, query, reqId: eqlReqIdRef.current },
      PAGE_TARGET_ORIGIN,
    );

    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      autocompleteReqIdRef.current++;
      setCompletionsLoading(true);
      setCompletionsError('');
      setCompletions([]);
      window.postMessage(
        {
          type: EQL_AUTOCOMPLETE_REQUEST_MSG,
          channel: OMNISEARCH_BRIDGE_CHANNEL,
          query,
          reqId: autocompleteReqIdRef.current,
          completionLimit: 10,
        },
        PAGE_TARGET_ORIGIN,
      );
    }, AUTOCOMPLETE_DEBOUNCE_MS);

    return () => clearTimeout(debounceTimerRef.current);
  }, [query, eqlMode]);

  // Clean up when exiting EQL mode
  const prevEqlModeRef = useRef(false);
  useEffect(() => {
    if (prevEqlModeRef.current && !eqlMode) {
      setEqlResults([]);
      setEqlError('');
      setEqlLoading(false);
      setCompletions([]);
      setCompletionsLoading(false);
      setCompletionsError('');
      clearTimeout(debounceTimerRef.current);
    }
    prevEqlModeRef.current = eqlMode;
  }, [eqlMode]);

  // Reset selectedIndex on query change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const container = eqlMode ? completionsRef.current : resultsRef.current;
    if (!container) return;
    const selected = container.querySelector('[data-selected="true"]') as HTMLElement;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, eqlMode]);

  // Filtered nav items - rank by match quality, then sort within sections
  const filteredItems = useMemo(() => {
    if (eqlMode) return [];
    const { items } = getNavState();
    const q = query.toLowerCase().trim();
    if (!q) return items;

    const scored = items
      .map((item) => ({ item, score: scoreMatch(item, q) }))
      .filter((s) => s.score >= 0);

    const sectionMeta = new Map<string, { entries: typeof scored; bestScore: number; firstHitIndex: number }>();
    scored.forEach((entry, index) => {
      const key = entry.item.section;
      const meta = sectionMeta.get(key);
      if (meta) {
        meta.entries.push(entry);
        if (entry.score > meta.bestScore) meta.bestScore = entry.score;
        return;
      }
      sectionMeta.set(key, {
        entries: [entry],
        bestScore: entry.score,
        firstHitIndex: index,
      });
    });

    const orderedSections = Array.from(sectionMeta.values()).sort((a, b) => {
      if (a.bestScore !== b.bestScore) return b.bestScore - a.bestScore;
      return a.firstHitIndex - b.firstHitIndex;
    });

    const result: NavItem[] = [];
    for (const section of orderedSections) {
      section.entries.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        const typeOrder = navItemTypeSortOrder(a.item) - navItemTypeSortOrder(b.item);
        if (typeOrder !== 0) return typeOrder;
        return a.item.label.localeCompare(b.item.label);
      });
      for (const entry of section.entries) result.push(entry.item);
    }
    return result;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, eqlMode, navVersion]);

  // Close completions dropdown
  const closeCompletions = useCallback(() => {
    setCompletions([]);
    clearTimeout(debounceTimerRef.current);
  }, []);

  // Apply autocomplete suggestion
  const applyCompletion = useCallback(
    (index?: number) => {
      const suggestion = completions[index ?? selectedIndex];
      if (!suggestion) return;
      setQuery(suggestion.value);
      setSelectedIndex(0);
      inputRef.current?.focus();
    },
    [completions, selectedIndex],
  );

  // Navigate to EQL query editor
  const navigateToEql = useCallback(() => {
    const q = query.trim();
    onClose();
    navigate('/ui/main/queryapi');
    setTimeout(() => {
      const editor = document.getElementById('QueryBuilderInput-eql-Input-Autocomplete') as HTMLInputElement | null;
      if (editor) {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(editor, q);
        else editor.value = q;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        editor.focus();
        setTimeout(() => {
          editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }, 200);
      }
    }, 500);
  }, [query, onClose]);

  // Handle nav item click
  const handleNavItemClick = useCallback(
    (item: NavItem) => {
      onClose();
      navigate(item.href);
    },
    [onClose],
  );

  // Nav empty message
  function getEmptyMessage(): string {
    const { loading, loadingPhase, error, bridgeReady, items, loadingStartedAt } = getNavState();
    const elapsedSeconds = loadingStartedAt > 0
      ? Math.max(0, Math.floor((loadingClockMs - loadingStartedAt) / 1000))
      : 0;
    if (!bridgeReady) return 'Initializing EDA search bridge...';
    if (loading && items.length === 0) {
      return loadingPhase === 'resources'
        ? `Loading resource instances... ${elapsedSeconds}s`
        : `Loading app catalog... ${elapsedSeconds}s`;
    }
    if (loading) {
      return loadingPhase === 'resources'
        ? `Loading resource instances... ${elapsedSeconds}s`
        : `Loading app catalog... ${elapsedSeconds}s`;
    }
    if (error && items.length === 0) return `Could not load pages: ${error}`;
    const q = query.toLowerCase().trim();
    if (!q && items.length === 0) return 'No pages discovered yet';
    return 'No matching pages';
  }

  // Keyboard handler
  function handleKeyDown(e: React.KeyboardEvent) {
    const maxIndex = eqlMode ? completions.length - 1 : filteredItems.length - 1;

    if (e.key === 'Backspace' && eqlMode && query === '.') {
      e.preventDefault();
      setQuery('');
      setSelectedIndex(0);
      return;
    }

    if (e.key === 'Tab' && eqlMode && completions.length > 0) {
      e.preventDefault();
      applyCompletion();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (eqlMode && completions.length > 0) {
        closeCompletions();
      } else {
        onClose();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (maxIndex < 0) return;
      setSelectedIndex((i) => Math.min(i + 1, maxIndex));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (maxIndex < 0) return;
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (eqlMode && completions.length > 0) {
        applyCompletion();
      } else if (eqlMode) {
        navigateToEql();
      } else if (filteredItems.length > 0) {
        const item = filteredItems[Math.max(0, Math.min(selectedIndex, filteredItems.length - 1))];
        handleNavItemClick(item);
      }
    }
  }

  // Close completions on click outside
  function handlePanelClick(e: React.MouseEvent) {
    if (completions.length > 0 && completionsRef.current && !completionsRef.current.contains(e.target as Node)) {
      closeCompletions();
    }
  }

  // Footer count text
  const footerCount = useMemo(() => {
    void navVersion;
    if (eqlMode) {
      const displayed = Math.min(eqlResults.length, EQL_DISPLAY_LIMIT);
      if (eqlResults.length > displayed) return `Showing ${displayed} of ${eqlResults.length} EQL results`;
      if (eqlResults.length > 0) return `${eqlResults.length} EQL result${eqlResults.length !== 1 ? 's' : ''}`;
      return '';
    }
    const navState = getNavState();
    const base = `${filteredItems.length} result${filteredItems.length !== 1 ? 's' : ''}`;
    if (navState.loading && navState.loadingStartedAt > 0) {
      const elapsedSeconds = Math.max(0, Math.floor((loadingClockMs - navState.loadingStartedAt) / 1000));
      return `${base} | loading ${elapsedSeconds}s`;
    }
    if (navState.loadedAt > 0 && navState.lastLoadDurationMs > 0) {
      const loadedSeconds = Math.max(1, Math.round(navState.lastLoadDurationMs / 1000));
      return `${base} | loaded in ${loadedSeconds}s`;
    }
    return base;
  }, [eqlMode, eqlResults.length, filteredItems.length, loadingClockMs, navVersion, getNavState]);

  const loadingBannerText = useMemo(() => {
    void navVersion;
    if (eqlMode) return '';
    const navState = getNavState();
    if (navState.loading && navState.loadingStartedAt > 0) {
      const elapsedSeconds = Math.max(0, Math.floor((loadingClockMs - navState.loadingStartedAt) / 1000));
      if (navState.loadingPhase === 'resources') {
        return `Loading resource instances... ${elapsedSeconds}s`;
      }
      return `Loading app catalog... ${elapsedSeconds}s`;
    }
    return '';
  }, [eqlMode, loadingClockMs, navVersion, getNavState]);

  // Completions dropdown visibility
  const completionsOpen =
    eqlMode &&
    query.length > 1 &&
    (completions.length > 0 || (completionsLoading && completions.length === 0) || completionsError !== '');

  const clampedIndex = eqlMode
    ? Math.max(0, Math.min(selectedIndex, completions.length - 1))
    : Math.max(0, Math.min(selectedIndex, filteredItems.length - 1));

  // ── Render completions ──

  function renderCompletions() {
    if (completionsLoading && !completions.length) {
      return (
        <Typography sx={{ p: '8px 10px', fontSize: 11, color: colors.textMuted }}>Loading suggestions...</Typography>
      );
    }
    if (completionsError) {
      return (
        <Typography sx={{ p: '8px 10px', fontSize: 11, color: colors.textMuted }}>{completionsError}</Typography>
      );
    }
    return completions.map((item, index) => {
      const prefix =
        item.suffix && item.value.endsWith(item.suffix) ? item.value.slice(0, -item.suffix.length) : '';
      const suffixPart = prefix ? item.suffix : item.value;
      const isSelected = index === clampedIndex;

      return (
        <ButtonBase
          key={item.value}
          data-selected={isSelected || undefined}
          onClick={() => applyCompletion(index)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            p: '7px 10px',
            color: colors.textStrong,
            textAlign: 'left',
            fontFamily: MONO_FONT,
            fontSize: 12,
            lineHeight: 1.4,
            bgcolor: isSelected ? colors.accentStrong : 'transparent',
            '&:hover': { bgcolor: colors.accentStrong },
            '&:first-of-type': { borderRadius: '8px 8px 0 0' },
            '&:last-of-type': { borderRadius: '0 0 8px 8px' },
            '&:only-of-type': { borderRadius: '8px' },
          }}
        >
          <Box sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {prefix && (
              <Box component="span" sx={{ color: colors.textMuted }}>
                {prefix}
              </Box>
            )}
            {suffixPart}
          </Box>
          {isSelected && (
            <Box
              sx={{
                flexShrink: 0,
                ml: 1,
                fontSize: 11,
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                color: colors.textMuted,
                border: '1px solid',
                borderColor: colors.kbdBorder,
                borderRadius: '4px',
                px: '6px',
                py: '1px',
                lineHeight: 1.2,
                display: 'flex',
                alignItems: 'center',
                gap: 0.25,
              }}
            >
              <KeyboardReturnIcon sx={{ fontSize: 14 }} /> Enter
            </Box>
          )}
        </ButtonBase>
      );
    });
  }

  // ── Render nav results ──

  function renderNavResults() {
    if (filteredItems.length === 0) {
      return (
        <Typography sx={{ p: '24px 16px', textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
          {getEmptyMessage()}
        </Typography>
      );
    }

    const q = query.toLowerCase().trim();
    const elements: React.ReactNode[] = [];
    let currentSection = '';

    filteredItems.forEach((item, index) => {
      if (item.section !== currentSection) {
        currentSection = item.section;
        elements.push(
          <Typography
            key={`section-${currentSection}`}
            sx={{
              px: 2,
              pt: 0.75,
              pb: 0.25,
              fontSize: 11,
              color: colors.textSubtle,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              fontWeight: 500,
            }}
          >
            {currentSection}
          </Typography>,
        );
      }

      const isSelected = index === clampedIndex;
      elements.push(
        <ButtonBase
          key={`${item.href}::${item.label}`}
          data-selected={isSelected || undefined}
          onClick={() => handleNavItemClick(item)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            px: 2,
            py: 1,
            width: '100%',
            textAlign: 'left',
            fontSize: 14,
            cursor: 'pointer',
            color: 'text.primary',
            bgcolor: isSelected ? colors.accentStrong : 'transparent',
            '&:hover': { bgcolor: colors.accentWeak },
          }}
        >
          <Box sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <HighlightMatch text={item.label} query={q} />
          </Box>
          <Typography
            component="span"
            sx={{
              fontSize: 12,
              color: colors.textSubtle,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 200,
            }}
          >
            {item.href}
          </Typography>
        </ButtonBase>,
      );
    });

    return elements;
  }

  // ── Render EQL results ──

  const sectionSx = {
    px: 2,
    pt: 0.75,
    pb: 0.25,
    fontSize: 11,
    color: colors.textSubtle,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    fontWeight: 500,
  };

  const emptySx = {
    p: '24px 16px',
    textAlign: 'center' as const,
    color: colors.textMuted,
    fontSize: 13,
  };

  const thSx = {
    position: 'sticky' as const,
    top: 0,
    zIndex: 1,
    bgcolor: colors.tableHeadBg,
    color: 'text.secondary',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
    fontSize: 10,
    fontWeight: 600,
    p: '6px 8px',
    borderBottom: `1px solid ${colors.tableDivider}`,
    whiteSpace: 'nowrap' as const,
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const tdSx = {
    p: '6px 8px',
    borderBottom: `1px solid ${colors.tableDivider}`,
    whiteSpace: 'nowrap' as const,
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: colors.textStrong,
  };

  function renderEqlResults() {
    if (query.length <= 1) {
      return <Typography sx={emptySx}>Start typing an EQL query after the dot</Typography>;
    }

    if (eqlLoading && !eqlResults.length) {
      return (
        <>
          <Typography sx={sectionSx}>EQL Results</Typography>
          <Typography sx={emptySx}>Running EQL query...</Typography>
        </>
      );
    }

    if (eqlError) {
      return (
        <>
          <Typography sx={sectionSx}>EQL Results</Typography>
          <Typography sx={emptySx}>{eqlError}</Typography>
        </>
      );
    }

    if (!eqlResults.length) {
      return (
        <>
          <Typography sx={sectionSx}>EQL Results</Typography>
          <Typography sx={emptySx}>No EQL results</Typography>
        </>
      );
    }

    const displayedItems = eqlResults.slice(0, EQL_DISPLAY_LIMIT);
    const flattenedRows = displayedItems.map((e) => flattenResultFields(e.fields));
    const columns = pickTableColumns(flattenedRows);

    return (
      <>
        <Typography sx={sectionSx}>EQL Results</Typography>
        <Box
          sx={{
            m: '4px 12px 12px',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'auto',
            maxHeight: 280,
            bgcolor: colors.tableBg,
          }}
        >
          <Table size="small" sx={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={thSx}>resource</TableCell>
                {columns.map((col) => (
                  <TableCell key={col} sx={thSx}>
                    {col}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {displayedItems.map((item, index) => {
                const row = flattenedRows[index];
                return (
                  <TableRow
                    key={item.path}
                    onClick={navigateToEql}
                    sx={{ cursor: 'pointer', '&:hover': { bgcolor: colors.accentWeak } }}
                  >
                    <TableCell sx={{ ...tdSx, maxWidth: 360, fontFamily: MONO_FONT }} title={item.path}>
                      {item.path}
                    </TableCell>
                    {columns.map((col) => {
                      const val = row.get(col) ?? '';
                      return (
                        <TableCell key={col} sx={tdSx} title={val}>
                          {val}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      </>
    );
  }

  // ── Main render ──

  return (
    <CacheProvider value={getEmotionCache()}>
      <ThemeProvider theme={theme}>
          {/* Overlay container */}
          <Box
            sx={{
              position: 'fixed',
              inset: 0,
              zIndex: 2147483647,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-start',
              p: '14vh 20px 12vh',
              colorScheme: mode,
            }}
            onClick={onClose}
          >
            {/* Backdrop */}
            <Box sx={{ position: 'fixed', inset: 0, bgcolor: colors.backdropBg }} />

            {/* Panel */}
            <Paper
              elevation={0}
              onClick={(e) => {
                e.stopPropagation();
                handlePanelClick(e);
              }}
              sx={{
                position: 'relative',
                width: 560,
                maxWidth: '90vw',
                minHeight: '60vh',
                maxHeight: '60vh',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 3,
                boxShadow: colors.shadow,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* Input row */}
              <Box
                sx={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 2,
                  py: 1.5,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <SearchIcon sx={{ width: 18, height: 18, color: 'text.secondary', flexShrink: 0 }} />
                <InputBase
                  inputRef={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  fullWidth
                  sx={{ fontSize: 15 }}
                />
                <Kbd>esc</Kbd>

                {/* Completions dropdown */}
                {completionsOpen && (
                  <Paper
                    ref={completionsRef}
                    elevation={0}
                    sx={{
                      position: 'absolute',
                      left: 42,
                      right: 16,
                      top: 'calc(100% - 4px)',
                      zIndex: 10,
                      bgcolor: colors.completionBg,
                      boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
                      overflowY: 'auto',
                      maxHeight: 'calc(60vh - 90px)',
                      borderRadius: 2,
                    }}
                  >
                    {renderCompletions()}
                  </Paper>
                )}
              </Box>

              {loadingBannerText && (
                <Box
                  sx={{
                    px: 2,
                    py: 0.75,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    fontSize: 11,
                    color: colors.textMuted,
                    bgcolor: colors.accentWeak,
                  }}
                >
                  {loadingBannerText}
                </Box>
              )}

              {/* Results */}
              <Box ref={resultsRef} sx={{ overflowY: 'auto', flex: 1, maxHeight: 'calc(60vh - 90px)' }}>
                {eqlMode ? renderEqlResults() : renderNavResults()}
              </Box>

              {/* Footer */}
              <Box
                sx={{
                  display: 'flex',
                  gap: 2,
                  px: 2,
                  py: 0.75,
                  borderTop: '1px solid',
                  borderColor: 'divider',
                  fontSize: 11,
                  color: colors.textSubtle,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Kbd footer>
                    {'↑↓'}
                  </Kbd>{' '}
                  navigate
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Kbd footer>{'↵'}</Kbd> open
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Kbd footer>.</Kbd> EQL
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Kbd footer>tab</Kbd> / <Kbd footer>{'↵'}</Kbd> complete
                </Box>
                <Typography variant="caption" sx={{ ml: 'auto', fontSize: 'inherit', color: 'inherit' }}>
                  {footerCount}
                </Typography>
              </Box>
            </Paper>
          </Box>
      </ThemeProvider>
    </CacheProvider>
  );
}
