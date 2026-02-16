import { useEffect, useState } from 'react';
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
  Chip,
  LinearProgress,
  InputAdornment,
  IconButton,
  CircularProgress,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import theme from './theme';
import { api } from './core/api';
import { type ConnectionStatus, type TargetProfile } from './core/types';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

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
  const [autoLogin, setAutoLogin] = useState(false);
  const [autoLoginDialogOpen, setAutoLoginDialogOpen] = useState(false);
  const selectedIsActive = selectedTargetId != null && selectedTargetId === activeTargetId;
  const locked = selectedIsActive && (status === 'connected' || status === 'connecting');
  const formFilled = editEdaUrl && editUsername && password && clientSecret;


  useEffect(() => {
    (async () => {
      const stored = await api.storage.local.get(['targets', 'connectionStatus', 'activeTargetId', 'autoLogin']);
      const loadedTargets = (stored.targets as TargetProfile[] | undefined) ?? [];
      const loadedStatus = (stored.connectionStatus as ConnectionStatus | undefined) ?? 'disconnected';
      const loadedActiveId = (stored.activeTargetId as string | undefined) ?? null;

      setTargets(loadedTargets);
      setStatus(loadedStatus);
      setActiveTargetId(loadedActiveId);
      setAutoLogin(!!stored.autoLogin);

      if (loadedActiveId && loadedTargets.some((t) => t.id === loadedActiveId)) {
        selectTarget(loadedTargets, loadedActiveId);
      } else if (loadedTargets.length > 0) {
        selectTarget(loadedTargets, loadedTargets[0].id);
      }
    })();

    const onChange = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => {
      if (changes.connectionStatus) {
        setStatus((changes.connectionStatus.newValue as ConnectionStatus) ?? 'disconnected');
      }
      if (changes.activeTargetId) {
        setActiveTargetId((changes.activeTargetId.newValue as string) ?? null);
      }
      if (changes.targets) {
        setTargets((changes.targets.newValue as TargetProfile[]) ?? []);
      }
    };
    api.storage.onChanged.addListener(onChange);
    return () => api.storage.onChanged.removeListener(onChange);
  }, []);

  function selectTarget(list: TargetProfile[], id: string) {
    const target = list.find((t) => t.id === id);
    if (!target) return;
    setSelectedTargetId(id);
    setIsNewTarget(false);
    setEditEdaUrl(target.edaUrl.replace(/^https?:\/\//i, ''));
    setEditUsername(target.username);
    setPassword(target.password);
    setClientSecret(target.clientSecret);
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
    const edaUrl = 'https://' + editEdaUrl.replace(/\/+$/, '');
    const id = edaUrl;
    const target: TargetProfile = {
      id,
      edaUrl,
      username: editUsername,
      password,
      clientSecret,
    };

    const stored = await api.storage.local.get(['targets']);
    const existing = (stored.targets as TargetProfile[] | undefined) ?? [];
    const oldIdx = selectedTargetId ? existing.findIndex((t) => t.id === selectedTargetId) : -1;
    const newIdx = existing.findIndex((t) => t.id === id);
    if (oldIdx >= 0) {
      existing[oldIdx] = target;
    } else if (newIdx >= 0) {
      existing[newIdx] = target;
    } else {
      existing.push(target);
    }
    await api.storage.local.set({ targets: existing });

    setTargets(existing);
    setSelectedTargetId(id);
    setIsNewTarget(false);

    return target;
  }

  async function handleDeleteTarget() {
    if (!selectedTargetId) return;
    setDeleteDialogOpen(false);

    if (selectedTargetId === activeTargetId) {
      await api.runtime.sendMessage({ type: 'eda-disconnect' });
    }

    const stored = await api.storage.local.get(['targets']);
    const existing = (stored.targets as TargetProfile[] | undefined) ?? [];
    const updatedTargets = existing.filter((t) => t.id !== selectedTargetId);
    await api.storage.local.set({ targets: updatedTargets });

    setTargets(updatedTargets);
    if (updatedTargets.length > 0) {
      selectTarget(updatedTargets, updatedTargets[0].id);
    } else {
      handleNewTarget();
    }
  }

  async function handleConnect() {
    setError('');
    const target = await handleSaveTarget();
    setSelectedTargetId(target.id);
    setActiveTargetId(target.id);
    setStatus('connecting');

    try {
      const result = await api.runtime.sendMessage({
        type: 'eda-connect',
        targetId: target.id,
        edaUrl: target.edaUrl,
        username: target.username,
        password,
        clientSecret: target.clientSecret,
      });
      if (result && result.ok) {
        setStatus('connected');
      } else {
        setStatus('error');
        setActiveTargetId(null);
        const err = (result?.error as string) || 'Connection failed';
        if (err === 'TLS_CERT_ERROR') {
          setError('TLS certificate not trusted. Open the EDA URL in a tab and accept the certificate first.');
          window.open('https://' + editEdaUrl, '_blank');
        } else {
          setError(err);
        }
      }
    } catch (err) {
      setStatus('error');
      setActiveTargetId(null);
      setError(err instanceof Error ? err.message : 'Connection failed');
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
      edaUrl: 'https://' + editEdaUrl.replace(/\/+$/, ''),
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
      const err = (result.error as string) || 'Failed to fetch client secret';
      if (err === 'TLS_CERT_ERROR') {
        setSecretError('TLS certificate not trusted. Open the EDA URL in a tab and accept the certificate first.');
        window.open('https://' + editEdaUrl, '_blank');
      } else {
        setSecretError(err);
      }
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ width: 340, bgcolor: 'background.default', display: 'grid', gridTemplateColumns: '1fr' }}>
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
            placeholder="eda.example.com"
            fullWidth
            value={editEdaUrl}
            onChange={(e) => setEditEdaUrl(e.target.value.replace(/^https?:\/\//i, ''))}
            disabled={locked}
            size="small"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start" sx={{ mr: 0 }}>
                    <Typography sx={{ color: 'text.secondary', fontSize: 'inherit', whiteSpace: 'nowrap' }}>https://&nbsp;</Typography>
                  </InputAdornment>
                ),
                endAdornment: editEdaUrl ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      edge="end"
                      onClick={() => window.open('https://' + editEdaUrl, '_blank')}
                      title="Open in new tab"
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              },
            }}
          />
          <FormControlLabel
            sx={{ pl: '2px'}}
            control={
              <Checkbox
                size="small"
                checked={autoLogin}
                onChange={(e) => {
                  if (e.target.checked) {
                    setAutoLoginDialogOpen(true);
                  } else {
                    setAutoLogin(false);
                    void api.storage.local.set({ autoLogin: false });
                  }
                }}
              />
            }
            label={
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Auto-login to EDA UI (dangerous)
              </Typography>
            }
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
            type="password"
            placeholder="EDA User Password"
            fullWidth
            value={locked ? '' : password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={locked}
            size="small"
            sx={{ '& input::-ms-reveal, & input::-webkit-credentials-auto-fill-button': { display: 'none' } }}
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
            type="password"
            placeholder="Paste or fetch below"
            fullWidth
            value={locked ? '' : clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={locked}
            size="small"
            sx={{ '& input::-ms-reveal, & input::-webkit-credentials-auto-fill-button': { display: 'none' } }}
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
            {!locked && (
              <Button variant="outlined" onClick={() => void handleSaveTarget()} disabled={!editEdaUrl} size="small">
                Save
              </Button>
            )}
            {selectedTargetId && !isNewTarget && !locked ? (
              <Button
                variant="outlined"
                color="error"
                onClick={() => setDeleteDialogOpen(true)}
                size="small"
              >
                Delete
              </Button>
            ) : !locked ? <span /> : null}
            {!locked ? <span /> : <span style={{ gridColumn: '1 / -1' }} />}
            {locked ? (
              <Button
                variant="contained"
                color="error"
                onClick={() => void handleDisconnect()}
                size="small"
                sx={{ gridColumn: '-2 / -1' }}
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
                Connect
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
            sx={{ '& input::-ms-reveal, & input::-webkit-credentials-auto-fill-button': { display: 'none' } }}
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
            {fetchingSecret ? <CircularProgress size={20} color="inherit" /> : 'Fetch'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={autoLoginDialogOpen} onClose={() => setAutoLoginDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Enable Auto-Login</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Enabling this feature is dangerous as attackers can extract credentials via spoofed EDA UIs.
          </Typography>
          <br/>
          <Typography variant="body2">
            <b><u>Think twice before enabling!</u></b>
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAutoLoginDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              setAutoLogin(true);
              void api.storage.local.set({ autoLogin: true });
              setAutoLoginDialogOpen(false);
            }}
          >
            Enable
          </Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<PopupApp />);
