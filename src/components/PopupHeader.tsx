import { Box, Typography, LinearProgress, Divider } from '@mui/material';
import { type ConnectionStatus } from '../core/types';
import { StatusChip } from './StatusChip';

export function PopupHeader({ status }: { status: ConnectionStatus }) {
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
        <StatusChip status={status} />
      </Box>
      <Divider />
    </>
  );
}
