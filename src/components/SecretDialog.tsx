import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { api } from '../core/api';
import { getErrorMessage } from '../core/utils';

interface SecretDialogProps {
  open: boolean;
  onClose: () => void;
  edaUrl: string;
  onSecretFetched: (secret: string) => void;
  onTlsError: () => void;
}

export function SecretDialog({ open, onClose, edaUrl, onSecretFetched, onTlsError }: SecretDialogProps) {
  const [kcUsername, setKcUsername] = useState('');
  const [kcPassword, setKcPassword] = useState('');
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  async function handleFetch() {
    setFetching(true);
    setError('');
    try {
      const result = await api.runtime.sendMessage({
        type: 'eda-fetch-client-secret',
        edaUrl,
        username: kcUsername,
        password: kcPassword,
      });
      if (result.ok) {
        onSecretFetched(result.clientSecret as string);
        setKcUsername('');
        setKcPassword('');
      } else {
        const err = (result.error as string) || 'Failed to fetch client secret';
        if (err === 'TLS_CERT_ERROR') {
          onClose();
          onTlsError();
        } else {
          setError(err);
        }
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setFetching(false);
    }
  }

  function handleClose() {
    if (!fetching) {
      setError('');
      onClose();
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>Get Client Secret</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5, pt: '8px !important' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Enter Keycloak credentials to fetch the client secret.
        </Typography>
        <TextField
          label="Username"
          placeholder="username"
          fullWidth
          value={kcUsername}
          onChange={(e) => setKcUsername(e.target.value)}
          disabled={fetching}
          size="small"
        />
        <TextField
          label="Password"
          type="password"
          placeholder="password"
          fullWidth
          value={kcPassword}
          onChange={(e) => setKcPassword(e.target.value)}
          disabled={fetching}
          size="small"
          sx={{ '& input::-ms-reveal, & input::-webkit-credentials-auto-fill-button': { display: 'none' } }}
        />
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={fetching}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void handleFetch()}
          disabled={!kcUsername || !kcPassword || fetching}
        >
          {fetching ? <CircularProgress size={20} color="inherit" /> : 'Fetch'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
