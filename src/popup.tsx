import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, CssBaseline, Box, Divider } from '@mui/material';
import theme from './theme';
import { api } from './core/api';
import { type ConnectionStatus, type TargetProfile } from './core/types';
import { PopupHeader } from './components/PopupHeader';
import { TargetSelector } from './components/TargetSelector';
import { EdaUrlField } from './components/EdaUrlField';
import { CredentialsSection } from './components/CredentialsSection';
import { ClientSecretSection } from './components/ClientSecretSection';
import { ActionButtons } from './components/ActionButtons';
import { TlsErrorDialog } from './components/TlsErrorDialog';
import { SecretDialog } from './components/SecretDialog';
import { DeleteDialog } from './components/DeleteDialog';
import { AutoLoginDialog } from './components/AutoLoginDialog';

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
  const [autoLogin, setAutoLogin] = useState(false);
  const [autoLoginDialogOpen, setAutoLoginDialogOpen] = useState(false);
  const [tlsDialogOpen, setTlsDialogOpen] = useState(false);
  const loaded = useRef(false);
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

      const draft = localStorage.getItem('draft');
      if (draft) {
        const d = JSON.parse(draft) as Record<string, string | boolean | null>;
        setSelectedTargetId((d.selectedTargetId as string | null) ?? null);
        setIsNewTarget(!!d.isNewTarget);
        setEditEdaUrl((d.edaUrl as string) ?? '');
        setEditUsername((d.username as string) ?? '');
        setPassword((d.password as string) ?? '');
        setClientSecret((d.clientSecret as string) ?? '');
      } else if (loadedActiveId && loadedTargets.some((t) => t.id === loadedActiveId)) {
        selectTarget(loadedTargets, loadedActiveId);
      } else if (loadedTargets.length > 0) {
        selectTarget(loadedTargets, loadedTargets[0].id);
      }
      loaded.current = true;
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

  useEffect(() => {
    if (!loaded.current) return;
    localStorage.setItem('draft', JSON.stringify({
      selectedTargetId, isNewTarget, edaUrl: editEdaUrl,
      username: editUsername, password, clientSecret,
    }));
  }, [selectedTargetId, isNewTarget, editEdaUrl, editUsername, password, clientSecret]);

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
    const target: TargetProfile = { id, edaUrl, username: editUsername, password, clientSecret };

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

  async function openTransportTabInBackground(): Promise<void> {
    if (!editEdaUrl) return;
    const edaUrl = 'https://' + editEdaUrl.replace(/\/+$/, '');
    try {
      await api.runtime.sendMessage({ type: 'eda-open-transport-tab', edaUrl });
    } catch {
      // Best effort only
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
          void openTransportTabInBackground();
          setTlsDialogOpen(true);
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

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ width: 340, bgcolor: 'background.default', display: 'grid', gridTemplateColumns: '1fr' }}>
        <PopupHeader status={status} />
        <TargetSelector
          targets={targets}
          selectedTargetId={selectedTargetId}
          activeTargetId={activeTargetId}
          status={status}
          isNewTarget={isNewTarget}
          onSelect={(id) => selectTarget(targets, id)}
          onNewTarget={handleNewTarget}
        />
        <EdaUrlField
          value={editEdaUrl}
          onChange={setEditEdaUrl}
          disabled={locked}
          autoLogin={autoLogin}
          onAutoLoginChange={(checked) => {
            if (checked) {
              setAutoLoginDialogOpen(true);
            } else {
              setAutoLogin(false);
              void api.storage.local.set({ autoLogin: false });
            }
          }}
        />
        <CredentialsSection
          username={editUsername}
          password={password}
          onUsernameChange={setEditUsername}
          onPasswordChange={setPassword}
          disabled={locked}
          locked={locked}
        />
        <ClientSecretSection
          clientSecret={clientSecret}
          onClientSecretChange={setClientSecret}
          disabled={locked}
          locked={locked}
          edaUrl={editEdaUrl}
          onFetchClick={() => { setSecretDialogOpen(true); }}
        />
        <Divider />
        <ActionButtons
          error={error}
          locked={locked}
          canSave={!!editEdaUrl}
          canDelete={!!selectedTargetId && !isNewTarget}
          canConnect={!!formFilled}
          connecting={status === 'connecting'}
          onSave={() => void handleSaveTarget()}
          onDelete={() => setDeleteDialogOpen(true)}
          onConnect={() => void handleConnect()}
          onDisconnect={() => void handleDisconnect()}
        />
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

const root = createRoot(document.getElementById('root')!);
root.render(<PopupApp />);
