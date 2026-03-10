import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded';
import KeyboardCommandKeyRoundedIcon from '@mui/icons-material/KeyboardCommandKeyRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { AutoLoginDialog } from './components/AutoLoginDialog';
import { DeleteDialog } from './components/DeleteDialog';
import { SecretDialog } from './components/SecretDialog';
import { TlsErrorDialog } from './components/TlsErrorDialog';
import { api } from './core/api';
import {
  DEFAULT_THEME_MODE,
  EDA_FONT_FAMILY_STORAGE_KEY,
  EDA_THEME_MODE_STORAGE_KEY,
  normalizeStoredFontFamily,
  normalizeStoredThemeMode,
  type ThemeMode,
} from './core/theme-mode';
import type { ConnectionStatus, TargetProfile } from './core/types';
import {
  createHotkeyFromKeyboardEvent,
  DEFAULT_OMNISEARCH_HOTKEY,
  formatOmnisearchHotkey,
  getOmnisearchHotkey,
  normalizeOmnisearchHotkey,
  setOmnisearchHotkey,
  OMNISEARCH_HOTKEY_STORAGE_KEY,
  type OmnisearchHotkey,
} from './core/settings';
import { createAppTheme } from './theme';

const TARGET_DRAFT_STORAGE_KEY = 'settings-target-draft';

function sameHotkey(left: OmnisearchHotkey, right: OmnisearchHotkey): boolean {
  return (
    left.code === right.code
    && left.ctrl === right.ctrl
    && left.meta === right.meta
    && left.alt === right.alt
    && left.shift === right.shift
    && left.usePrimaryModifier === right.usePrimaryModifier
  );
}

interface SetupProfileFile {
  version?: number;
  exportedAt?: string;
  activeTargetId?: string | null;
  targets?: unknown;
  settings?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeProfileUrl(raw: string): string {
  const stripped = raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return stripped ? `https://${stripped}` : '';
}

function parseImportedTarget(entry: unknown): TargetProfile | null {
  if (typeof entry === 'string') {
    const edaUrl = normalizeProfileUrl(entry);
    if (!edaUrl) return null;
    return {
      id: edaUrl,
      edaUrl,
      username: '',
      password: '',
      clientSecret: '',
    };
  }

  if (!isRecord(entry)) return null;

  const rawEdaUrl = typeof entry.edaUrl === 'string'
    ? entry.edaUrl
    : (typeof entry.id === 'string' ? entry.id : '');
  const edaUrl = normalizeProfileUrl(rawEdaUrl);
  if (!edaUrl) return null;

  return {
    id: edaUrl,
    edaUrl,
    username: typeof entry.username === 'string' ? entry.username : '',
    password: '',
    clientSecret: '',
  };
}

function SettingsApp() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(DEFAULT_THEME_MODE);
  const [fontFamily, setFontFamily] = useState<string | null>(null);
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
  const [profileBusy, setProfileBusy] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [secretDialogOpen, setSecretDialogOpen] = useState(false);
  const [autoLoginDialogOpen, setAutoLoginDialogOpen] = useState(false);
  const [tlsDialogOpen, setTlsDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportJson, setExportJson] = useState('');
  const [notice, setNotice] = useState<{ severity: 'success' | 'error'; message: string } | null>(null);

  const [storedHotkey, setStoredHotkey] = useState<OmnisearchHotkey>(DEFAULT_OMNISEARCH_HOTKEY);
  const [draftHotkey, setDraftHotkey] = useState<OmnisearchHotkey>(DEFAULT_OMNISEARCH_HOTKEY);
  const [hotkeySaving, setHotkeySaving] = useState(false);
  const [captureMode, setCaptureMode] = useState(false);

  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);
  const theme = useMemo(() => createAppTheme(themeMode, fontFamily), [themeMode, fontFamily]);

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
    setNotice(null);
    setNotice(null);
  }

  function handleNewTarget(): void {
    setSelectedTargetId(null);
    setIsNewTarget(true);
    setEditEdaUrl('');
    setEditUsername('');
    setPassword('');
    setClientSecret('');
    setNotice(null);
    setNotice(null);
  }

  useEffect(() => {
    void (async () => {
      try {
        const [loadedHotkey, stored] = await Promise.all([
          getOmnisearchHotkey(),
          api.storage.local.get([
            'targets',
            'connectionStatus',
            'activeTargetId',
            'autoLogin',
            EDA_FONT_FAMILY_STORAGE_KEY,
            EDA_THEME_MODE_STORAGE_KEY,
          ]),
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
        setFontFamily(normalizeStoredFontFamily(stored[EDA_FONT_FAMILY_STORAGE_KEY]));
        setThemeMode(normalizeStoredThemeMode(stored[EDA_THEME_MODE_STORAGE_KEY]));

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

      const changedHotkey = changes[OMNISEARCH_HOTKEY_STORAGE_KEY];
      if (changedHotkey) {
        const nextHotkey = normalizeOmnisearchHotkey(changedHotkey.newValue);
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

      if (changes[EDA_FONT_FAMILY_STORAGE_KEY]) {
        setFontFamily(normalizeStoredFontFamily(changes[EDA_FONT_FAMILY_STORAGE_KEY].newValue));
      }

      if (changes[EDA_THEME_MODE_STORAGE_KEY]) {
        setThemeMode(normalizeStoredThemeMode(changes[EDA_THEME_MODE_STORAGE_KEY].newValue));
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
        setNotice({ severity: 'success', message: 'Hotkey capture canceled.' });
        return;
      }

      const captured = createHotkeyFromKeyboardEvent(event);
      if (!captured) {
        setNotice({ severity: 'error', message: 'Use one modifier key plus one regular key.' });
        return;
      }

      setDraftHotkey(captured);
      setCaptureMode(false);
      setNotice(null);
      setNotice({ severity: 'success', message: `Captured ${formatOmnisearchHotkey(captured)}. Click Save to apply.` });
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [captureMode]);

  async function handleSaveTarget(): Promise<void> {
    setTargetSaving(true);
    setNotice(null);
    setNotice(null);

    if (!editEdaUrl) {
      setTargetSaving(false);
      setNotice({ severity: 'error', message: 'EDA URL is required.' });
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
      setNotice({ severity: 'success', message: 'Target saved.' });
    } catch (err) {
      setNotice({ severity: 'error', message: err instanceof Error ? err.message : 'Could not save target' });
    } finally {
      setTargetSaving(false);
    }
  }

  async function handleDeleteTarget(): Promise<void> {
    if (!selectedTargetId) return;
    setDeleteDialogOpen(false);
    setNotice(null);
    setNotice(null);

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
      setNotice({ severity: 'success', message: 'Target deleted.' });
    } catch (err) {
      setNotice({ severity: 'error', message: err instanceof Error ? err.message : 'Could not delete target' });
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
    setNotice(null);
    setNotice(null);
    try {
      const normalized = normalizeOmnisearchHotkey(draftHotkey);
      await setOmnisearchHotkey(normalized);
      setStoredHotkey(normalized);
      setDraftHotkey(normalized);
      setNotice({ severity: 'success', message: `Saved ${formatOmnisearchHotkey(normalized)}.` });
    } catch (err) {
      setNotice({ severity: 'error', message: err instanceof Error ? err.message : 'Could not save settings' });
    } finally {
      setHotkeySaving(false);
    }
  }

  function resetDraftToDefault(): void {
    setCaptureMode(false);
    setDraftHotkey(DEFAULT_OMNISEARCH_HOTKEY);
    setNotice(null);
    setNotice({ severity: 'success', message: 'Reset to default shortcut. Click Save to apply.' });
  }

  function discardHotkeyChanges(): void {
    setCaptureMode(false);
    setDraftHotkey(storedHotkey);
    setNotice(null);
    setNotice({ severity: 'success', message: 'Discarded local changes.' });
  }

  function handleExportProfile(): void {
    setNotice(null);
    setNotice(null);

    try {
      const profile = {
        version: 1,
        exportedAt: new Date().toISOString(),
        activeTargetId,
        targets: targets.map((target) => ({
          id: target.id,
          edaUrl: normalizeProfileUrl(target.edaUrl),
          username: target.username,
        })),
        settings: {
          autoLogin,
          omnisearchHotkey: storedHotkey,
        },
      };

      setExportJson(JSON.stringify(profile, null, 2));
      setExportDialogOpen(true);
    } catch (err) {
      setNotice({ severity: 'error', message: err instanceof Error ? err.message : 'Could not export setup profile' });
    }
  }

  function handleExportDownload(): void {
    try {
      const blob = new Blob([exportJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const date = JSON.parse(exportJson)?.exportedAt?.slice(0, 10) ?? 'unknown';
      link.download = `eda-setup-profile-${date}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportDialogOpen(false);
      setNotice({ severity: 'success', message: 'Setup profile exported.' });
    } catch (err) {
      setNotice({ severity: 'error', message: err instanceof Error ? err.message : 'Could not download setup profile' });
    }
  }

  async function handleImportProfile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (status === 'connected' || status === 'connecting') {
      setNotice({ severity: 'error', message: 'Disconnect in the popup before importing a setup profile.' });
      setNotice(null);
      return;
    }

    setNotice(null);
    setNotice(null);
    setProfileBusy(true);

    try {
      const text = await file.text();
      const parsedValue = JSON.parse(text) as unknown;
      if (!isRecord(parsedValue)) {
        throw new Error('Invalid setup profile format.');
      }
      const parsed = parsedValue as SetupProfileFile;

      const rawTargets = Array.isArray(parsed.targets) ? parsed.targets : [];
      const importedTargets = rawTargets
        .map(parseImportedTarget)
        .filter((target): target is TargetProfile => target !== null);

      if (importedTargets.length === 0) {
        throw new Error('No valid targets found in setup profile.');
      }

      const stored = await api.storage.local.get(['targets']);
      const existingTargets = (stored.targets as TargetProfile[] | undefined) ?? [];
      const mergedTargets = [...existingTargets];

      let addedCount = 0;
      let updatedCount = 0;

      for (const importedTarget of importedTargets) {
        const index = mergedTargets.findIndex((candidate) => candidate.id === importedTarget.id);
        if (index >= 0) {
          const previous = mergedTargets[index];
          mergedTargets[index] = {
            ...previous,
            edaUrl: importedTarget.edaUrl,
            username: importedTarget.username,
          };
          updatedCount += 1;
        } else {
          mergedTargets.push(importedTarget);
          addedCount += 1;
        }
      }

      const patch: Record<string, unknown> = { targets: mergedTargets };

      const importedSettings = isRecord(parsed.settings) ? parsed.settings : null;
      if (importedSettings && typeof importedSettings.autoLogin === 'boolean') {
        patch.autoLogin = importedSettings.autoLogin;
        setAutoLogin(importedSettings.autoLogin);
      }
      if (importedSettings && 'omnisearchHotkey' in importedSettings) {
        const importedHotkey = normalizeOmnisearchHotkey(importedSettings.omnisearchHotkey);
        patch[OMNISEARCH_HOTKEY_STORAGE_KEY] = importedHotkey;
        setStoredHotkey(importedHotkey);
        setDraftHotkey(importedHotkey);
      }

      const importedActiveTargetId = typeof parsed.activeTargetId === 'string'
        ? normalizeProfileUrl(parsed.activeTargetId)
        : null;
      if (importedActiveTargetId && mergedTargets.some((target) => target.id === importedActiveTargetId)) {
        patch.activeTargetId = importedActiveTargetId;
        setActiveTargetId(importedActiveTargetId);
      }

      await api.storage.local.set(patch);
      setTargets(mergedTargets);

      const ignoredCount = rawTargets.length - importedTargets.length;
      const ignoredText = ignoredCount > 0 ? `, ${ignoredCount} skipped` : '';
      setNotice({ severity: 'success', message: `Imported: ${addedCount} added, ${updatedCount} updated${ignoredText}. Secrets were not imported.` });
    } catch (err) {
      setNotice({ severity: 'error', message: err instanceof Error ? err.message : 'Could not import setup profile' });
    } finally {
      setProfileBusy(false);
    }
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
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={1} alignItems="center">
                  <SettingsSuggestRoundedIcon color="primary" fontSize="small" />
                  <Typography variant="h6" sx={{ fontSize: 18, fontWeight: 700 }}>
                    Extension Settings
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <IconButton
                    size="small"
                    title="Export Profile"
                    onClick={handleExportProfile}
                    disabled={profileBusy || loading}
                  >
                    <FileDownloadRoundedIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    title="Import Profile"
                    component="label"
                    disabled={profileBusy || loading}
                  >
                    <FileUploadRoundedIcon fontSize="small" />
                    <input
                      hidden
                      type="file"
                      accept="application/json,.json"
                      onChange={(event) => {
                        void handleImportProfile(event);
                      }}
                    />
                  </IconButton>
                </Stack>
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
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Target Setup
                  </Typography>

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
                      variant="contained"
                      onClick={handleNewTarget}
                      sx={{ minWidth: 0, px: 1 }}
                    >
                      <AddRoundedIcon fontSize="small" />
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

                  <Stack direction="row" spacing={1} justifyContent="space-between">
                    <IconButton
                      size="small"
                      color="error"
                      title="Delete Target"
                      onClick={() => setDeleteDialogOpen(true)}
                      disabled={!canDeleteTarget || targetSaving}
                    >
                      <DeleteOutlineRoundedIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      title={targetSaving ? 'Saving...' : 'Save Target'}
                      onClick={() => void handleSaveTarget()}
                      disabled={!canSaveTarget || locked || targetSaving}
                    >
                      <SaveRoundedIcon fontSize="small" />
                    </IconButton>
                  </Stack>

                  {loading && (
                    <Alert severity="info">Loading saved target settings...</Alert>
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
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <KeyboardCommandKeyRoundedIcon color="info" fontSize="small" />
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Omnisearch Shortcut
                      </Typography>
                    </Stack>
                    <Chip
                      size="small"
                      label={hotkeyDirty ? 'Unsaved' : 'Saved'}
                      color={hotkeyDirty ? 'warning' : 'success'}
                      variant={hotkeyDirty ? 'filled' : 'outlined'}
                    />
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
                      {formatOmnisearchHotkey(draftHotkey)}
                    </Typography>
                  </Box>

                  <Stack spacing={1}>
                    <Button
                      variant={captureMode ? 'contained' : 'outlined'}
                      color={captureMode ? 'warning' : 'primary'}
                      size="small"
                      onClick={() => {
                        setNotice(null);
                        setNotice(null);
                        setCaptureMode((previous) => !previous);
                      }}
                    >
                      {captureMode ? 'Listening... press keys' : 'Capture Hotkey'}
                    </Button>

                    <Stack direction="row" spacing={1} justifyContent="space-between">
                      <IconButton
                        size="small"
                        color="error"
                        title="Discard Changes"
                        onClick={discardHotkeyChanges}
                        disabled={!hotkeyDirty || loading}
                      >
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton>
                      <Stack direction="row" spacing={1}>
                        <IconButton
                          size="small"
                          title="Reset to Default"
                          onClick={resetDraftToDefault}
                          disabled={loading}
                        >
                          <RestartAltRoundedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          title={hotkeySaving ? 'Saving...' : 'Save Shortcut'}
                          onClick={() => void saveHotkey()}
                          disabled={!hotkeyDirty || loading || hotkeySaving || captureMode}
                        >
                          <SaveRoundedIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>
                  </Stack>

                  {captureMode && (
                    <Alert severity="info">
                      Press shortcut keys now. Press Escape to cancel.
                    </Alert>
                  )}
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
          setNotice({ severity: 'success', message: 'Client secret fetched.' });
          setNotice(null);
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

      <Dialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Export Setup Profile</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Passwords and client secrets are excluded.
          </Typography>
          <Box
            component="pre"
            sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
              fontSize: '0.75rem',
              overflow: 'auto',
              maxHeight: 300,
              m: 0,
            }}
          >
            {exportJson}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExportDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleExportDownload}>
            Download
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={notice !== null}
        onClose={() => setNotice(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{notice?.severity === 'error' ? 'Error' : 'Notice'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{notice?.message}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNotice(null)}>OK</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Settings root element not found');
}

const root = createRoot(rootElement);
root.render(<SettingsApp />);
