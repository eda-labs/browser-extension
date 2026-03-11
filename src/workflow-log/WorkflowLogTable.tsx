import React from 'react';
import { Box, createTheme, ThemeProvider } from '@mui/material';
import { DataGrid, type GridColDef, GridToolbarQuickFilter } from '@mui/x-data-grid';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';

let _cache: ReturnType<typeof createCache> | null = null;
function getCache() {
  if (!_cache) _cache = createCache({ key: 'eda-wflog', prepend: true });
  return _cache;
}

export interface LogEntry {
  id: number;
  ts: string;
  time: string;
  level: string;
  logger: string;
  msg: string;
  caller: string;
  details: string;
}

export interface ThemeVars {
  bgDefault: string;
  bgPaper: string;
  textPrimary: string;
  textSecondary: string;
  textDisabled: string;
  borderColor: string;
  primaryMain: string;
  errorMain: string;
  actionHover: string;
  hoverOpacity: string;
  selectedOpacity: string;
  spacing: string;
  fontFamily: string;
}

export function parseLogLines(lines: string[]): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const text of lines) {
    if (!text.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const { level, ts, msg, logger, caller, logNum, GoID, ...extra } = parsed;
      void logNum;
      void GoID;
      const tsStr = String(ts || '');
      const tsMatch = tsStr.match(/T(\d{2}:\d{2}:\d{2}\.\d{3})/);
      const extraParts: string[] = [];
      for (const [k, v] of Object.entries(extra)) {
        extraParts.push(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
      }
      entries.push({
        id: entries.length,
        ts: tsStr,
        time: tsMatch ? tsMatch[1] : tsStr,
        level: String(level || '').toUpperCase(),
        logger: String(logger || ''),
        msg: String(msg || ''),
        caller: String(caller || ''),
        details: extraParts.join('  '),
      });
    } catch {
      // skip non-JSON lines
    }
  }
  return entries;
}

const LEVEL_COLORS: Record<string, string> = {
  INFO: '#4caf50',
  WARN: '#ff9800',
  WARNING: '#ff9800',
  ERROR: '#f44336',
  DEBUG: '#9e9e9e',
};

const columns: GridColDef<LogEntry>[] = [
  { field: 'time', headerName: 'Time', width: 130 },
  {
    field: 'level',
    headerName: 'Level',
    width: 70,
    renderCell: (params) => (
      <Box sx={{ fontWeight: 600, color: LEVEL_COLORS[params.value as string] || 'inherit' }}>
        {params.value}
      </Box>
    ),
  },
  { field: 'logger', headerName: 'Logger', width: 220 },
  { field: 'msg', headerName: 'Message', flex: 1, minWidth: 200 },
  { field: 'caller', headerName: 'Caller', width: 180 },
  { field: 'details', headerName: 'Details', width: 300 },
];

function buildTheme(t: ThemeVars) {
  return createTheme({
    palette: {
      mode: 'dark',
      background: { default: t.bgDefault, paper: t.bgPaper },
      text: { primary: t.textPrimary, secondary: t.textSecondary, disabled: t.textDisabled },
      primary: { main: t.primaryMain },
      error: { main: t.errorMain },
      action: {
        hover: t.actionHover,
        hoverOpacity: parseFloat(t.hoverOpacity) || 0.08,
        selectedOpacity: parseFloat(t.selectedOpacity) || 0.16,
      },
      divider: t.borderColor,
    },
    typography: { fontFamily: t.fontFamily },
    spacing: parseFloat(t.spacing) || 8,
  } as any);
}

interface Props {
  rows: LogEntry[];
  themeVars: ThemeVars;
}

export function WorkflowLogTable({ rows, themeVars: t }: Props) {
  if (rows.length === 0) return null;

  const theme = React.useMemo(() => buildTheme(t), [t]);

  return (
    <CacheProvider value={getCache()}>
      <ThemeProvider theme={theme}>
        <Box sx={{ width: '100%', height: '100%' }}>
          <DataGrid
            rows={rows}
            columns={columns}
            density="compact"
            disableRowSelectionOnClick
            hideFooter={rows.length <= 100}
            initialState={{
              sorting: { sortModel: [{ field: 'time', sort: 'asc' }] },
            }}
            slots={{
              toolbar: () => (
                <Box sx={{ p: '4px 8px', borderBottom: `1px solid ${t.borderColor}` }}>
                  <GridToolbarQuickFilter debounceMs={200} />
                </Box>
              ),
            }}
            sx={{
              border: 'none',
              borderRadius: 0,
              backgroundColor: 'transparent',
              '--unstable_DataGrid-radius': '0px',
              '& .MuiDataGrid-cell': { p: 0, px: '10px', borderColor: t.borderColor },
              '& .MuiDataGrid-row': { borderColor: t.borderColor },
              '& .MuiDataGrid-columnHeader': { borderColor: t.borderColor },
              '& .MuiDataGrid-columnHeaders': { borderColor: t.borderColor, backgroundColor: 'transparent' },
              '& .MuiDataGrid-footerContainer': { borderColor: t.borderColor },
              '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 500 },
            } as Record<string, unknown>}
          />
        </Box>
      </ThemeProvider>
    </CacheProvider>
  );
}
