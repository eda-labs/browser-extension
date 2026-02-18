import { Chip, useTheme } from '@mui/material';
import { type ConnectionStatus } from '../core/types';

const statusLabels: Record<ConnectionStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  connected: 'Connected',
  error: 'Error',
};

const statusPaletteKey: Record<ConnectionStatus, 'text' | 'warning' | 'success' | 'error'> = {
  disconnected: 'text',
  connecting: 'warning',
  connected: 'success',
  error: 'error',
};

export function StatusChip({ status }: { status: ConnectionStatus }) {
  const theme = useTheme();
  const key = statusPaletteKey[status];
  const color = key === 'text' ? theme.palette.text.secondary : theme.palette[key].main;

  return (
    <Chip
      size="small"
      label={statusLabels[status]}
      sx={{
        bgcolor: color + '22',
        color,
        fontWeight: 600,
        fontSize: 11,
        height: 24,
        '& .MuiChip-label': { px: 1 },
      }}
    />
  );
}
