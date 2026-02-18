import { Box, Button, IconButton, Alert, Tooltip } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';

interface ActionButtonsProps {
  error: string;
  locked: boolean;
  canSave: boolean;
  canDelete: boolean;
  canConnect: boolean;
  connecting: boolean;
  onSave: () => void;
  onDelete: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function ActionButtons({
  error,
  locked,
  canSave,
  canDelete,
  canConnect,
  connecting,
  onSave,
  onDelete,
  onConnect,
  onDisconnect,
}: ActionButtonsProps) {
  return (
    <>
      <Box sx={{ pt: 1.5 }} />
      <Box sx={{ px: 2, pt: 1.5, pb: 2, display: 'grid', gap: 1.5 }}>
        {error && <Alert severity="error">{error}</Alert>}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {!locked && (
            <>
              <Tooltip title="Save">
                <span>
                  <IconButton onClick={onSave} disabled={!canSave} size="small">
                    <SaveIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Delete">
                <span>
                  <IconButton onClick={onDelete} disabled={!canDelete} size="small" color="error">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
          <Box sx={{ flex: 1 }} />
          {locked ? (
            <Button
              variant="contained"
              color="error"
              onClick={onDisconnect}
              size="small"
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={onConnect}
              disabled={!canConnect || connecting}
              size="small"
            >
              Connect
            </Button>
          )}
        </Box>
      </Box>
    </>
  );
}
