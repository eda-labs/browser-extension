import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded';
import KeyboardCommandKeyRoundedIcon from '@mui/icons-material/KeyboardCommandKeyRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Paper,
  Stack,
  Switch,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AutoLoginDialog } from './components/AutoLoginDialog';
import { DeleteDialog } from './components/DeleteDialog';
import { SecretDialog } from './components/SecretDialog';
import { TlsErrorDialog } from './components/TlsErrorDialog';
import { api } from './core/api';
import type { ConnectionStatus, TargetProfile } from './core/types';
import {
  createHotkeyFromKeyboardEvent,
  DEFAULT_SPOTLIGHT_HOTKEY,
  formatSpotlightHotkey,
  getSpotlightHotkey,
  normalizeSpotlightHotkey,
  setSpotlightHotkey,
  SPOTLIGHT_HOTKEY_STORAGE_KEY,
  type SpotlightHotkey,
} from './core/settings';
import theme from './theme';

const TARGET_DRAFT_STORAGE_KEY = 'settings-target-draft';

function sameHotkey(left: SpotlightHotkey, right: SpotlightHotkey): boolean {
  return (
    left.code === right.code
    && left.ctrl === right.ctrl
    && left.meta === right.meta
    && left.alt === right.alt
    && left.shift === right.shift
    && left.usePrimaryModifier === right.usePrimaryModifier
  );
}

function SettingsApp() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [targets, setTargets] = useState<TargetProfile[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const [isNewTarget, setIsNewTarget] = useState(false);
  const [editEdaUrl, setEditEdaUrl] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [autoLogin, setAutoLogin] = useState(false);
  const [targetSaving, setTargetSaving] = useState(false);
  const [targetError, setTargetError] = useState('');
  const [targetMessage, setTargetMessage] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [secretDialogOpen, setSecretDialogOpen] = useState(false);
  const [autoLoginDialogOpen, setAutoLoginDialogOpen] = useState(false);
  const [tlsDialogOpen, setTlsDialogOpen] = useState(false);

  const [storedHotkey, setStoredHotkey] = useState<SpotlightHotkey>(DEFAULT_SPOTLIGHT_HOTKEY);
  const [draftHotkey, setDraftHotkey] = useState<SpotlightHotkey>(DEFAULT_SPOTLIGHT_HOTKEY);
  const [hotkeySaving, setHotkeySaving] = useState(false);
  const [captureMode, setCaptureMode] = useState(false);
  const [hotkeyMessage, setHotkeyMessage] = useState('');
  const [hotkeyError, setHotkeyError] = useState('');

  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);

  const hotkeyDirty = !sameHotkey(storedHotkey, draftHotkey);
  const selectedIsActive = selectedTargetId != null && selectedTargetId === activeTargetId;
  const locked = selectedIsActive && (status === 'connected' || status === 'connecting');
  const canSaveTarget = Boolean(editEdaUrl);
  const canDeleteTarget = Boolean(selectedTargetId && !isNewTarget);

  function selectTarget(list: TargetProfile[], id: string): void {
    const target = list.find((candidate) => candidate.id === id);
    if (!target) return;
    setSelectedTargetId(id);
    setIsNewTarget(false);
    setEditEdaUrl(target.edaUrl.replace(/^https?:\/\//i, ''));
    setEditUsername(target.username);
    setPassword(target.password ?? '');
    setClientSecret(target.clientSecret ?? '');
    setTargetError('');
    setTargetMessage('');
  }

  function handleNewTarget(): void {
    setSelectedTargetId(null);
    setIsNewTarget(true);
    setEditEdaUrl('');
    setEditUsername('');
    setPassword('');
    setClientSecret('');
    setTargetError('');
    setTargetMessage('');
  }

  useEffect(() => {
    void (async () => {
      try {
        const [loadedHotkey, stored] = await Promise.all([
          getSpotlightHotkey(),
          api.storage.local.get(['targets', 'connectionStatus', 'activeTargetId', 'autoLogin']),
        ]);

        const loadedTargets = (stored.targets as TargetProfile[] | undefined) ?? [];
        const loadedStatus = (stored.connectionStatus as ConnectionStatus | undefined) ?? 'disconnected';
        const loadedActiveId = (stored.activeTargetId as string | undefined) ?? null;

        setStoredHotkey(loadedHotkey);
        setDraftHotkey(loadedHotkey);
        setTargets(loadedTargets);
        setStatus(loadedStatus);
        setActiveTargetId(loadedActiveId);
        setAutoLogin(!!stored.autoLogin);

        let appliedDraft = false;
        const draftRaw = localStorage.getItem(TARGET_DRAFT_STORAGE_KEY);
        if (draftRaw) {
          try {
            const draft = JSON.parse(draftRaw) as Record<string, string | boolean | null>;
            const draftSelectedTargetId = (draft.selectedTargetId as string | null) ?? null;
            const draftIsNewTarget = !!draft.isNewTarget;
            if (draftIsNewTarget || !draftSelectedTargetId) {
              appliedDraft = true;
              setSelectedTargetId(null);
              setIsNewTarget(true);
              setEditEdaUrl((draft.edaUrl as string) ?? '');
              setEditUsername((draft.username as string) ?? '');
              setPassword('');
              setClientSecret('');
            } else if (loadedTargets.some((target) => target.id === draftSelectedTargetId)) {
              appliedDraft = true;
              selectTarget(loadedTargets, draftSelectedTargetId);
            }
          } catch {
            localStorage.removeItem(TARGET_DRAFT_STORAGE_KEY);
          }
        }

        if (!appliedDraft) {
          if (loadedActiveId && loadedTargets.some((target) => target.id === loadedActiveId)) {
            selectTarget(loadedTargets, loadedActiveId);
          } else if (loadedTargets.length > 0) {
            selectTarget(loadedTargets, loadedTargets[0].id);
          } else {
            handleNewTarget();
          }
        }
      } finally {
        loaded.current = true;
        setLoading(false);
      }
    })();

    const onStorageChange = (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;

      const changedHotkey = changes[SPOTLIGHT_HOTKEY_STORAGE_KEY];
      if (changedHotkey) {
        const nextHotkey = normalizeSpotlightHotkey(changedHotkey.newValue);
        setStoredHotkey(nextHotkey);
        setDraftHotkey(nextHotkey);
      }

      if (changes.connectionStatus) {
        setStatus((changes.connectionStatus.newValue as ConnectionStatus) ?? 'disconnected');
      }

      if (changes.activeTargetId) {
        setActiveTargetId((changes.activeTargetId.newValue as string | null) ?? null);
      }

      if (changes.targets) {
        setTargets((changes.targets.newValue as TargetProfile[]) ?? []);
      }

      if (changes.autoLogin) {
        setAutoLogin(!!changes.autoLogin.newValue);
      }
    };

    api.storage.onChanged.addListener(onStorageChange);
    return () => {
      api.storage.onChanged.removeListener(onStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    localStorage.setItem(TARGET_DRAFT_STORAGE_KEY, JSON.stringify({
      selectedTargetId,
      isNewTarget,
      edaUrl: editEdaUrl,
      username: editUsername,
    }));
  }, [selectedTargetId, isNewTarget, editEdaUrl, editUsername]);

  useEffect(() => {
    if (isNewTarget) return;
    if (selectedTargetId && targets.some((target) => target.id === selectedTargetId)) return;
    if (activeTargetId && targets.some((target) => target.id === activeTargetId)) {
      selectTarget(targets, activeTargetId);
      return;
    }
    if (targets.length > 0) {
      selectTarget(targets, targets[0].id);
      return;
    }
    handleNewTarget();
  }, [targets, selectedTargetId, activeTargetId, isNewTarget]);

  useEffect(() => {
    if (!captureMode) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === 'Escape') {
        setCaptureMode(false);
        setHotkeyMessage('Hotkey capture canceled.');
        return;
      }

      const captured = createHotkeyFromKeyboardEvent(event);
      if (!captured) {
        setHotkeyError('Use one modifier key plus one regular key.');
        return;
      }

      setDraftHotkey(captured);
      setCaptureMode(false);
      setHotkeyError('');
      setHotkeyMessage(`Captured ${formatSpotlightHotkey(captured)}. Click Save to apply.`);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [captureMode]);

  async function handleSaveTarget(): Promise<void> {
    setTargetSaving(true);
    setTargetError('');
    setTargetMessage('');

    if (!editEdaUrl) {
      setTargetSaving(false);
      setTargetError('EDA URL is required.');
      return;
    }

    try {
      const edaUrl = 'https://' + editEdaUrl.replace(/\/+$/, '');
      const id = edaUrl;
      const target: TargetProfile = { id, edaUrl, username: editUsername, password, clientSecret };

      const stored = await api.storage.local.get(['targets']);
      const existing = (stored.targets as TargetProfile[] | undefined) ?? [];
      const oldIndex = selectedTargetId ? existing.findIndex((candidate) => candidate.id === selectedTargetId) : -1;
      const newIndex = existing.findIndex((candidate) => candidate.id === id);

      if (oldIndex >= 0) {
        existing[oldIndex] = target;
      } else if (newIndex >= 0) {
        existing[newIndex] = target;
      } else {
        existing.push(target);
      }

      await api.storage.local.set({ targets: existing });
      setTargets(existing);
      setSelectedTargetId(id);
      setIsNewTarget(false);
      setTargetMessage('Target saved.');
    } catch (err) {
      setTargetError(err instanceof Error ? err.message : 'Could not save target');
    } finally {
      setTargetSaving(false);
    }
  }

  async function handleDeleteTarget(): Promise<void> {
    if (!selectedTargetId) return;
    setDeleteDialogOpen(false);
    setTargetError('');
    setTargetMessage('');

    try {
      if (selectedTargetId === activeTargetId) {
        await api.runtime.sendMessage({ type: 'eda-disconnect' });
      }

      const stored = await api.storage.local.get(['targets']);
      const existing = (stored.targets as TargetProfile[] | undefined) ?? [];
      const updatedTargets = existing.filter((target) => target.id !== selectedTargetId);
      await api.storage.local.set({ targets: updatedTargets });
      setTargets(updatedTargets);

      if (updatedTargets.length > 0) {
        selectTarget(updatedTargets, updatedTargets[0].id);
      } else {
        handleNewTarget();
      }
      setTargetMessage('Target deleted.');
    } catch (err) {
      setTargetError(err instanceof Error ? err.message : 'Could not delete target');
    }
  }

  async function openTransportTabInBackground(): Promise<void> {
    if (!editEdaUrl) return;
    const edaUrl = 'https://' + editEdaUrl.replace(/\/+$/, '');
    try {
      await api.runtime.sendMessage({ type: 'eda-open-transport-tab', edaUrl });
    } catch {
      // Best effort only.
    }
  }

  async function saveHotkey(): Promise<void> {
    setHotkeySaving(true);
    setHotkeyError('');
    setHotkeyMessage('');
    try {
      const normalized = normalizeSpotlightHotkey(draftHotkey);
      await setSpotlightHotkey(normalized);
      setStoredHotkey(normalized);
      setDraftHotkey(normalized);
      setHotkeyMessage(`Saved ${formatSpotlightHotkey(normalized)}.`);
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Could not save settings');
    } finally {
      setHotkeySaving(false);
    }
  }

  function resetDraftToDefault(): void {
    setCaptureMode(false);
    setDraftHotkey(DEFAULT_SPOTLIGHT_HOTKEY);
    setHotkeyError('');
    setHotkeyMessage('Reset to default shortcut. Click Save to apply.');
  }

  function discardHotkeyChanges(): void {
    setCaptureMode(false);
    setDraftHotkey(storedHotkey);
    setHotkeyError('');
    setHotkeyMessage('Discarded local changes.');
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', py: { xs: 2, md: 3 }, bgcolor: 'background.default' }}>
        <Container maxWidth="lg" sx={{ px: { xs: 1.5, sm: 2.5 } }}>
          <Stack spacing={2}>
            <Paper
              elevation={1}
              sx={{
                px: 2,
                py: 1.5,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <SettingsSuggestRoundedIcon color="primary" fontSize="small" />
                <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 700 }}>
                  Extension Settings
                </Typography>
              </Stack>
            </Paper>

            <Box
              sx={{
                display: 'grid',
                gap: 2,
                alignItems: 'start',
                gridTemplateColumns: {
                  xs: '1fr',
                  lg: 'minmax(0, 2fr) minmax(320px, 1fr)',
                },
              }}
            >
              <Paper
                elevation={1}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                <Stack spacing={1.5}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Target Setup
                    </Typography>
                    <Stack direction="row" spacing={0.75}>
                      {isNewTarget && <Chip size="small" label="New Target" variant="outlined" />}
                      {selectedIsActive && status === 'connected' && <Chip size="small" label="Connected" color="success" />}
                    </Stack>
                  </Stack>

                  <Typography variant="caption" color="text.secondary">
                    Configure target profiles used in the popup.
                  </Typography>

                  {locked && (
                    <Alert severity="info" sx={{ py: 0 }}>
                      Active target is connected. Disconnect in the popup to edit it.
                    </Alert>
                  )}

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <FormControl size="small" fullWidth>
                      <InputLabel shrink>Target</InputLabel>
                      <Select
                        label="Target"
                        value={isNewTarget ? '' : (selectedTargetId ?? '')}
                        onChange={(event) => {
                          const id = event.target.value as string;
                          if (id) selectTarget(targets, id);
                        }}
                        displayEmpty
                        notched
                        renderValue={(value) => {
                          if (!value) {
                            return <Typography sx={{ color: 'text.secondary', fontSize: 'inherit' }}>Select a target...</Typography>;
                          }
                          const target = targets.find((candidate) => candidate.id === value);
                          return target ? target.edaUrl : '';
                        }}
                      >
                        {targets.map((target) => (
                          <MenuItem key={target.id} value={target.id}>
                            {target.edaUrl}
                            {target.id === activeTargetId && status === 'connected' ? ' (active)' : ''}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button
                      variant="outlined"
                      startIcon={<AddRoundedIcon />}
                      onClick={handleNewTarget}
                      sx={{ minWidth: { xs: '100%', sm: 120 } }}
                    >
                      New
                    </Button>
                  </Stack>

                  <Box
                    sx={{
                      display: 'grid',
                      gap: 1,
                      gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                    }}
                  >
                    <TextField
                      label="EDA URL"
                      placeholder="eda.example.com"
                      value={editEdaUrl}
                      onChange={(event) => setEditEdaUrl(event.target.value.replace(/^https?:\/\//i, ''))}
                      disabled={locked}
                      size="small"
                      sx={{ gridColumn: '1 / -1' }}
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start" sx={{ mr: 0 }}>
                              <Typography sx={{ color: 'text.secondary', fontSize: 'inherit' }}>https://&nbsp;</Typography>
                            </InputAdornment>
                          ),
                          endAdornment: editEdaUrl ? (
                            <InputAdornment position="end">
                              <Tooltip title="Open URL">
                                <IconButton
                                  size="small"
                                  edge="end"
                                  onClick={() => window.open('https://' + editEdaUrl.replace(/\/+$/, ''), '_blank')}
                                >
                                  <LaunchRoundedIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </InputAdornment>
                          ) : null,
                        },
                      }}
                    />

                    <TextField
                      label="Username"
                      placeholder="EDA Username"
                      value={editUsername}
                      onChange={(event) => setEditUsername(event.target.value)}
                      disabled={locked}
                      size="small"
                    />

                    <TextField
                      label="Password"
                      type="password"
                      placeholder="EDA User Password"
                      value={locked ? '' : password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={locked}
                      size="small"
                      sx={{ '& input::-ms-reveal, & input::-webkit-credentials-auto-fill-button': { display: 'none' } }}
                    />
                  </Box>

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField
                      label="Client Secret"
                      type="password"
                      placeholder="Paste or fetch from Keycloak"
                      value={locked ? '' : clientSecret}
                      onChange={(event) => setClientSecret(event.target.value)}
                      disabled={locked}
                      size="small"
                      fullWidth
                      sx={{ '& input::-ms-reveal, & input::-webkit-credentials-auto-fill-button': { display: 'none' } }}
                    />
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => setSecretDialogOpen(true)}
                      disabled={locked || !editEdaUrl}
                      sx={{ minWidth: { xs: '100%', sm: 100 } }}
                    >
                      Fetch
                    </Button>
                  </Stack>

                  <FormControlLabel
                    sx={{ ml: 0.25 }}
                    control={(
                      <Switch
                        size="small"
                        checked={autoLogin}
                        disabled={locked}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setAutoLoginDialogOpen(true);
                          } else {
                            setAutoLogin(false);
                            void api.storage.local.set({ autoLogin: false });
                          }
                        }}
                      />
                    )}
                    label={(
                      <Typography variant="caption" color="text.secondary">
                        Auto-login to EDA UI (dangerous)
                      </Typography>
                    )}
                  />

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="flex-end">
                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={<DeleteOutlineRoundedIcon />}
                      onClick={() => setDeleteDialogOpen(true)}
                      disabled={!canDeleteTarget || targetSaving}
                    >
                      Delete
                    </Button>
                    <Button
                      variant="contained"
                      startIcon={<SaveRoundedIcon />}
                      onClick={() => void handleSaveTarget()}
                      disabled={!canSaveTarget || locked || targetSaving}
                    >
                      {targetSaving ? 'Saving...' : 'Save Target'}
                    </Button>
                  </Stack>

                  {(targetError || targetMessage || loading) && (
                    <Stack spacing={1}>
                      {targetError && <Alert severity="error">{targetError}</Alert>}
                      {targetMessage && <Alert severity="success">{targetMessage}</Alert>}
                      {loading && <Alert severity="info">Loading saved target settings...</Alert>}
                    </Stack>
                  )}
                </Stack>
              </Paper>

              <Paper
                elevation={1}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                <Stack spacing={1.5}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <KeyboardCommandKeyRoundedIcon color="info" fontSize="small" />
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Spotlight Shortcut
                    </Typography>
                  </Stack>

                  <Box
                    sx={{
                      px: 1.25,
                      py: 1,
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                      bgcolor: 'background.default',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600, letterSpacing: 0.2 }}>
                      {formatSpotlightHotkey(draftHotkey)}
                    </Typography>
                    <Chip
                      size="small"
                      label={hotkeyDirty ? 'Unsaved' : 'Saved'}
                      color={hotkeyDirty ? 'warning' : 'success'}
                      variant={hotkeyDirty ? 'filled' : 'outlined'}
                    />
                  </Box>

                  <Stack spacing={1}>
                    <Button
                      variant={captureMode ? 'contained' : 'outlined'}
                      color={captureMode ? 'warning' : 'primary'}
                      size="small"
                      onClick={() => {
                        setHotkeyError('');
                        setHotkeyMessage('');
                        setCaptureMode((previous) => !previous);
                      }}
                    >
                      {captureMode ? 'Listening... press keys' : 'Capture Hotkey'}
                    </Button>

                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<RestartAltRoundedIcon />}
                        onClick={resetDraftToDefault}
                        disabled={loading}
                        fullWidth
                      >
                        Reset
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={discardHotkeyChanges}
                        disabled={!hotkeyDirty || loading}
                        fullWidth
                      >
                        Discard
                      </Button>
                    </Stack>

                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<SaveRoundedIcon />}
                      onClick={() => void saveHotkey()}
                      disabled={!hotkeyDirty || loading || hotkeySaving || captureMode}
                    >
                      {hotkeySaving ? 'Saving...' : 'Save Shortcut'}
                    </Button>
                  </Stack>

                  {captureMode && (
                    <Alert severity="info">
                      Press shortcut keys now. Press Escape to cancel.
                    </Alert>
                  )}
                  {hotkeyError && <Alert severity="error">{hotkeyError}</Alert>}
                  {hotkeyMessage && <Alert severity="success">{hotkeyMessage}</Alert>}
                </Stack>
              </Paper>
            </Box>
          </Stack>
        </Container>
      </Box>

      <DeleteDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={() => void handleDeleteTarget()}
        targetName={editEdaUrl}
      />

      <SecretDialog
        open={secretDialogOpen}
        onClose={() => setSecretDialogOpen(false)}
        edaUrl={'https://' + editEdaUrl.replace(/\/+$/, '')}
        onSecretFetched={(secret) => {
          setClientSecret(secret);
          setSecretDialogOpen(false);
          setTargetMessage('Client secret fetched.');
          setTargetError('');
        }}
        onTlsError={() => {
          void openTransportTabInBackground();
          setTlsDialogOpen(true);
        }}
      />

      <TlsErrorDialog
        open={tlsDialogOpen}
        onClose={() => setTlsDialogOpen(false)}
      />

      <AutoLoginDialog
        open={autoLoginDialogOpen}
        onClose={() => setAutoLoginDialogOpen(false)}
        onConfirm={() => {
          setAutoLogin(true);
          void api.storage.local.set({ autoLogin: true });
          setAutoLoginDialogOpen(false);
        }}
      />
    </ThemeProvider>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Settings root element not found');
}

const root = createRoot(rootElement);
root.render(<SettingsApp />);
