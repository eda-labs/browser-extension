import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, CssBaseline, Box, Divider, Button, Alert, Typography } from '@mui/material';
import theme from './theme';
import { api } from './core/api';
import type { ConnectionStatus, TargetProfile } from './core/types';
import { PopupHeader } from './components/PopupHeader';
import { TargetSelector } from './components/TargetSelector';

function PopupApp() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState('');
  const [targets, setTargets] = useState<TargetProfile[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const stored = await api.storage.local.get(['targets', 'connectionStatus', 'activeTargetId']);
      const loadedTargets = (stored.targets as TargetProfile[] | undefined) ?? [];
      const loadedStatus = (stored.connectionStatus as ConnectionStatus | undefined) ?? 'disconnected';
      const loadedActiveId = (stored.activeTargetId as string | undefined) ?? null;

      setTargets(loadedTargets);
      setStatus(loadedStatus);
      setActiveTargetId(loadedActiveId);

      if (loadedActiveId && loadedTargets.some((target) => target.id === loadedActiveId)) {
        setSelectedTargetId(loadedActiveId);
      } else {
        setSelectedTargetId(loadedTargets[0]?.id ?? null);
      }
    })();

    const onChange = (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return;
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

  useEffect(() => {
    if (selectedTargetId && targets.some((target) => target.id === selectedTargetId)) {
      return;
    }
    if (activeTargetId && targets.some((target) => target.id === activeTargetId)) {
      setSelectedTargetId(activeTargetId);
      return;
    }
    setSelectedTargetId(targets[0]?.id ?? null);
  }, [targets, selectedTargetId, activeTargetId]);

  const selectedTarget = useMemo(
    () => targets.find((target) => target.id === selectedTargetId) ?? null,
    [targets, selectedTargetId],
  );
  const selectedIsActive = selectedTargetId != null && selectedTargetId === activeTargetId;
  const showDisconnect = selectedIsActive && (status === 'connected' || status === 'connecting');
  const hasCompleteCredentials = Boolean(
    selectedTarget
    && selectedTarget.edaUrl
    && selectedTarget.username
    && selectedTarget.password
    && selectedTarget.clientSecret,
  );

  async function handleOpenSettings(): Promise<void> {
    try {
      if (api.runtime.openOptionsPage) {
        await api.runtime.openOptionsPage();
      } else {
        await api.tabs.create({
          url: api.runtime.getURL('options.html'),
          active: true,
        });
      }
      window.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open settings');
    }
  }

  async function handleConnect(): Promise<void> {
    setError('');
    if (!selectedTarget) {
      setError('Select a target first.');
      return;
    }
    if (!hasCompleteCredentials) {
      setError('Target is incomplete. Open settings to configure URL, credentials, and client secret.');
      return;
    }

    setStatus('connecting');

    try {
      const result = await api.runtime.sendMessage({
        type: 'eda-connect',
        targetId: selectedTarget.id,
        edaUrl: selectedTarget.edaUrl,
        username: selectedTarget.username,
        password: selectedTarget.password,
        clientSecret: selectedTarget.clientSecret,
      });

      if (result && result.ok) {
        setStatus('connected');
        setActiveTargetId(selectedTarget.id);
      } else {
        setStatus('error');
        setActiveTargetId(null);
        setError((result?.error as string) || 'Connection failed');
      }
    } catch (err) {
      setStatus('error');
      setActiveTargetId(null);
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }

  async function handleDisconnect(): Promise<void> {
    await api.runtime.sendMessage({ type: 'eda-disconnect' });
    setStatus('disconnected');
    setActiveTargetId(null);
    setError('');
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ width: 340, bgcolor: 'background.default', display: 'grid', gridTemplateColumns: '1fr' }}>
        <PopupHeader status={status} onOpenSettings={() => void handleOpenSettings()} />

        <TargetSelector
          targets={targets}
          selectedTargetId={selectedTargetId}
          activeTargetId={activeTargetId}
          status={status}
          onSelect={(id) => {
            setSelectedTargetId(id);
            setError('');
          }}
        />

        <Box sx={{ px: 2, pb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {selectedTarget
              ? `User: ${selectedTarget.username || 'not set'}`
              : 'No target selected'}
          </Typography>
        </Box>

        <Divider />

        <Box sx={{ px: 2, py: 2, display: 'grid', gap: 1.5 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {targets.length === 0 ? (
            <Alert
              severity="info"
              action={(
                <Button color="inherit" size="small" onClick={() => void handleOpenSettings()}>
                  Open
                </Button>
              )}
            >
              No targets configured yet.
            </Alert>
          ) : showDisconnect ? (
            <Button
              variant="contained"
              color="error"
              size="small"
              onClick={() => void handleDisconnect()}
              disabled={status === 'connecting'}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="contained"
              size="small"
              onClick={() => void handleConnect()}
              disabled={!selectedTarget || !hasCompleteCredentials || status === 'connecting'}
            >
              Connect
            </Button>
          )}

          <Button variant="text" size="small" onClick={() => void handleOpenSettings()}>
            Manage Targets
          </Button>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Popup root element not found');
}
const root = createRoot(rootElement);
root.render(<PopupApp />);
