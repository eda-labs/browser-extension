import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ThemeProvider,
  CssBaseline,
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  Divider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  InputAdornment,
  IconButton,
  Chip,
} from '@mui/material';
import theme from './theme';
import { api, type ConnectionStatus, type TargetProfile } from './types';

function VisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {visible ? (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      )}
    </svg>
  );
}

const statusColors: Record<ConnectionStatus, string> = {
  disconnected: '#8994a3',
  connecting: '#FFAC0A',
  connected: '#00A87E',
  error: '#FF6363',
};

const statusLabels: Record<ConnectionStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  connected: 'Connected',
  error: 'Error',
};

function PopupApp() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState('');
  const [targets, setTargets] = useState<TargetProfile[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const [isNewTarget, setIsNewTarget] = useState(false);
  const [editEdaUrl, setEditEdaUrl] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [secretDialogOpen, setSecretDialogOpen] = useState(false);
  const [kcUsername, setKcUsername] = useState('');
  const [kcPassword, setKcPassword] = useState('');
  const [fetchingSecret, setFetchingSecret] = useState(false);
  const [secretError, setSecretError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const selectedIsActive = selectedTargetId != null && selectedTargetId === activeTargetId;
  const locked = selectedIsActive && (status === 'connected' || status === 'connecting');
  const formFilled = editEdaUrl && editUsername && password && clientSecret;

  useEffect(() => {
    (async () => {
      const result = await api.runtime.sendMessage({ type: 'eda-get-targets' });
      const loadedTargets = (result.targets as TargetProfile[]) ?? [];
      const loadedActiveId = (result.activeTargetId as string | null) ?? null;

      setTargets(loadedTargets);
      setActiveTargetId(loadedActiveId);

      const st = await api.runtime.sendMessage({ type: 'eda-get-status' });
      setStatus(st.status as ConnectionStatus);

      if (loadedActiveId && loadedTargets.some((t) => t.id === loadedActiveId)) {
        selectTarget(loadedTargets, loadedActiveId);
      } else if (loadedTargets.length > 0) {
        selectTarget(loadedTargets, loadedTargets[0].id);
      }
    })();
  }, []);

  function selectTarget(list: TargetProfile[], id: string) {
    const target = list.find((t) => t.id === id);
    if (!target) return;
    setSelectedTargetId(id);
    setIsNewTarget(false);
    setEditEdaUrl(target.edaUrl);
    setEditUsername(target.username);
    setClientSecret(target.clientSecret);
    setPassword('');
    setError('');
  }

  function handleNewTarget() {
    setSelectedTargetId(null);
    setIsNewTarget(true);
    setEditEdaUrl('');
    setEditUsername('');
    setClientSecret('');
    setPassword('');
    setError('');
  }

  async function handleSaveTarget(): Promise<TargetProfile> {
    const id = isNewTarget ? crypto.randomUUID() : selectedTargetId!;
    const target: TargetProfile = {
      id,
      edaUrl: editEdaUrl.replace(/\/+$/, ''),
      username: editUsername,
      clientSecret,
    };

    await api.runtime.sendMessage({ type: 'eda-save-target', target });

    const result = await api.runtime.sendMessage({ type: 'eda-get-targets' });
    const updatedTargets = (result.targets as TargetProfile[]) ?? [];
    setTargets(updatedTargets);
    setSelectedTargetId(id);
    setIsNewTarget(false);

    return target;
  }

  async function handleDeleteTarget() {
    if (!selectedTargetId) return;
    setDeleteDialogOpen(false);

    await api.runtime.sendMessage({ type: 'eda-delete-target', targetId: selectedTargetId });

    const result = await api.runtime.sendMessage({ type: 'eda-get-targets' });
    const updatedTargets = (result.targets as TargetProfile[]) ?? [];
    const newActiveId = (result.activeTargetId as string | null) ?? null;
    setTargets(updatedTargets);
    setActiveTargetId(newActiveId);

    if (selectedTargetId === activeTargetId) {
      setStatus('disconnected');
    }

    if (updatedTargets.length > 0) {
      selectTarget(updatedTargets, updatedTargets[0].id);
    } else {
      handleNewTarget();
    }
  }

  async function handleConnect() {
    setError('');
    const target = await handleSaveTarget();

    setStatus('connecting');
    const result = await api.runtime.sendMessage({
      type: 'eda-connect',
      targetId: target.id,
      edaUrl: target.edaUrl,
      username: target.username,
      password,
      clientSecret: target.clientSecret,
    });

    if (result.ok) {
      setStatus('connected');
      setActiveTargetId(target.id);
    } else {
      setStatus('error');
      setActiveTargetId(null);
      setError((result.error as string) || 'Connection failed');
    }
  }

  async function handleDisconnect() {
    await api.runtime.sendMessage({ type: 'eda-disconnect' });
    setStatus('disconnected');
    setActiveTargetId(null);
  }

  async function handleFetchSecret() {
    setFetchingSecret(true);
    setSecretError('');
    const result = await api.runtime.sendMessage({
      type: 'eda-fetch-client-secret',
      edaUrl: editEdaUrl.replace(/\/+$/, ''),
      username: kcUsername,
      password: kcPassword,
    });
    setFetchingSecret(false);
    if (result.ok) {
      setClientSecret(result.clientSecret as string);
      setSecretDialogOpen(false);
      setKcUsername('');
      setKcPassword('');
    } else {
      setSecretError((result.error as string) || 'Failed to fetch client secret');
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ width: 340, bgcolor: 'background.default', display: 'grid', gridTemplateColumns: '1fr' }}>
        <Box sx={{ px: 2, pt: 2, pb: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" sx={{ fontSize: 15, fontWeight: 600 }}>
            EDA Connection
          </Typography>
          <Chip
            size="small"
            label={statusLabels[status]}
            sx={{
              bgcolor: statusColors[status] + '22',
              color: statusColors[status],
              fontWeight: 600,
              fontSize: 11,
              height: 24,
              '& .MuiChip-label': { px: 1 },
            }}
          />
        </Box>

        <Divider />

        <Box sx={{ px: 2, pt: 1.5, display: 'grid', gap: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel shrink>Target</InputLabel>
              <Select
                label="Target"
                value={isNewTarget ? '' : (selectedTargetId ?? '')}
                onChange={(e) => {
                  const id = e.target.value as string;
                  if (id) selectTarget(targets, id);
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
              onClick={handleNewTarget}
              title="New target"
              sx={{ minWidth: 0, px: 2, fontSize: 20, height: 40 }}
            >
              +
            </Button>
          </Box>
        </Box>

        <Box sx={{ px: 2, pt: 1.5, display: 'grid', gap: 1.5 }}>
          <TextField
            label="EDA URL"
            placeholder="https://eda.example.com"
            fullWidth
            value={editEdaUrl}
            onChange={(e) => setEditEdaUrl(e.target.value)}
            disabled={locked}
            size="small"
          />
        </Box>

        <Box sx={{ pt: 1.5 }} />
        <Divider />
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', px: 2, py: 1 }}>
          EDA User
        </Typography>
        <Divider />
        <Box sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'grid', gap: 1.5 }}>
          <TextField
            label="Username"
            placeholder="EDA Username"
            fullWidth
            value={editUsername}
            onChange={(e) => setEditUsername(e.target.value)}
            disabled={locked}
            size="small"
          />
          <TextField
            label="Password"
            type={showPassword ? 'text' : 'password'}
            placeholder="EDA User Password"
            fullWidth
            value={locked ? '' : password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={locked}
            size="small"
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowPassword(!showPassword)} edge="end">
                      <VisibilityIcon visible={showPassword} />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        <Box sx={{ pt: 1.5 }} />
        <Divider />
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', px: 2, py: 1 }}>
          Client Secret
        </Typography>
        <Divider />
        <Box sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'grid', gap: 1.5 }}>
          <TextField
            label="Client Secret"
            type={showSecret ? 'text' : 'password'}
            placeholder="Paste or fetch below"
            fullWidth
            value={locked ? '' : clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={locked}
            size="small"
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowSecret(!showSecret)} edge="end">
                      <VisibilityIcon visible={showSecret} />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Button
            variant="outlined"
            size="small"
            onClick={() => { setSecretError(''); setSecretDialogOpen(true); }}
            disabled={locked || !editEdaUrl}
          >
            Fetch
          </Button>
        </Box>

        <Box sx={{ pt: 1.5 }} />
        <Divider />
        <Box sx={{ px: 2, pt: 1.5, pb: 2, display: 'grid', gap: 1.5 }}>
          {error && (
            <Alert severity="error">{error}</Alert>
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr auto', gap: 1 }}>
            <Button
              variant="outlined"
              onClick={() => void handleSaveTarget()}
              disabled={!editEdaUrl || locked}
              size="small"
            >
              Save
            </Button>
            {selectedTargetId && !isNewTarget ? (
              <Button
                variant="outlined"
                color="error"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={locked}
                size="small"
              >
                Delete
              </Button>
            ) : <span />}
            <span />
            {selectedIsActive && status === 'connected' ? (
              <Button
                variant="contained"
                color="error"
                onClick={() => void handleDisconnect()}
                size="small"
              >
                Disconnect
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={() => void handleConnect()}
                disabled={!formFilled || status === 'connecting'}
                size="small"
              >
                {status === 'connecting' ? 'Connecting...' : 'Connect'}
              </Button>
            )}
          </Box>
        </Box>
      </Box>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Target</DialogTitle>
        <DialogContent>
          <Typography>
            Delete &quot;{editEdaUrl}&quot;? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button color="error" onClick={() => void handleDeleteTarget()}>Delete</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={secretDialogOpen} onClose={() => setSecretDialogOpen(false)} fullWidth maxWidth="xs">
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
            disabled={fetchingSecret}
            size="small"
          />
          <TextField
            label="Password"
            type="password"
            placeholder="password"
            fullWidth
            value={kcPassword}
            onChange={(e) => setKcPassword(e.target.value)}
            disabled={fetchingSecret}
            size="small"
          />
          {secretError && (
            <Alert severity="error">{secretError}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSecretDialogOpen(false)} disabled={fetchingSecret}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleFetchSecret()}
            disabled={!kcUsername || !kcPassword || fetchingSecret}
          >
            {fetchingSecret ? 'Fetching...' : 'Fetch'}
          </Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<PopupApp />);
