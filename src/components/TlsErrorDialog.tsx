import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from '@mui/material';

interface TlsErrorDialogProps {
  open: boolean;
  onClose: () => void;
}

export function TlsErrorDialog({ open, onClose }: TlsErrorDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>TLS Certificate Error</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5, pt: '8px !important' }}>
        <Typography variant="body2">
          The TLS certificate is not trusted by extension requests.
        </Typography>
        <Typography variant="body2">
          An EDA page has been opened in a background tab. Accept the certificate there, keep that tab open and then retry.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>OK</Button>
      </DialogActions>
    </Dialog>
  );
}
