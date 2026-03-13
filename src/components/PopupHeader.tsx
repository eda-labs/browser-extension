import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import { Box, Typography, LinearProgress, Divider, IconButton, Tooltip } from '@mui/material';
import type { ConnectionStatus } from '../core/types';
import { StatusChip } from './StatusChip';

interface PopupHeaderProps {
  status: ConnectionStatus;
  onOpenSettings: () => void;
}

export function PopupHeader({ status, onOpenSettings }: PopupHeaderProps) {
  return (
    <>
      {status === 'connecting' && <LinearProgress sx={{ height: 3 }} />}
      <Box sx={{ px: 2, pt: 2, pb: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <a href="https://eda.dev" target="_blank" rel="noopener noreferrer" style={{ display: 'flex' }}>
            <img src="icons/icon-128.png" width={16} height={16} alt="" />
          </a>
          <Typography variant="h6" sx={{ fontSize: 15, fontWeight: 600 }}>
            EDA Connection
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <StatusChip status={status} />
          <Tooltip title="Open settings">
            <IconButton
              size="small"
              color="default"
              aria-label="Open extension settings"
              onClick={onOpenSettings}
            >
              <SettingsRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      <Divider />
    </>
  );
}
