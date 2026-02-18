import { Box, FormControl, InputLabel, Select, MenuItem, Button, Typography } from '@mui/material';
import { type ConnectionStatus, type TargetProfile } from '../core/types';

interface TargetSelectorProps {
  targets: TargetProfile[];
  selectedTargetId: string | null;
  activeTargetId: string | null;
  status: ConnectionStatus;
  isNewTarget: boolean;
  onSelect: (id: string) => void;
  onNewTarget: () => void;
}

export function TargetSelector({
  targets,
  selectedTargetId,
  activeTargetId,
  status,
  isNewTarget,
  onSelect,
  onNewTarget,
}: TargetSelectorProps) {
  return (
    <Box sx={{ px: 2, pt: 1.5, display: 'grid', gap: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <FormControl size="small" sx={{ flex: 1 }}>
          <InputLabel shrink>Target</InputLabel>
          <Select
            label="Target"
            value={isNewTarget ? '' : (selectedTargetId ?? '')}
            onChange={(e) => {
              const id = e.target.value as string;
              if (id) onSelect(id);
            }}
            displayEmpty
            notched
            renderValue={(val) => {
              if (!val) return <Typography sx={{ color: 'text.secondary', fontSize: 'inherit' }}>Select a target...</Typography>;
              const t = targets.find((t) => t.id === val);
              return t ? t.edaUrl : '';
            }}
          >
            {targets.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.edaUrl}
                {t.id === activeTargetId && status === 'connected' ? ' (active)' : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="contained"
          onClick={onNewTarget}
          title="New target"
          sx={{ minWidth: 0, px: 2, fontSize: 20, height: 40 }}
        >
          +
        </Button>
      </Box>
    </Box>
  );
}
