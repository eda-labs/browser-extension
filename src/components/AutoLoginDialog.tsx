import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from '@mui/material';

interface AutoLoginDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function AutoLoginDialog({ open, onClose, onConfirm }: AutoLoginDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Enable Auto-Login</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          Enabling this feature is dangerous as attackers can extract credentials via spoofed EDA UIs.
        </Typography>
        <br />
        <Typography variant="body2">
          <b><u>Think twice before enabling!</u></b>
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="error"
          onClick={onConfirm}
        >
          Enable
        </Button>
      </DialogActions>
    </Dialog>
  );
}
