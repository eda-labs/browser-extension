import { api, type Port } from './api';

const keepalivePorts = new Set<Port>();

export function initKeepalive(): void {
  api.runtime.onConnect.addListener((port) => {
    if (port.name !== 'eda-keepalive') return;
    keepalivePorts.add(port);
    port.onDisconnect.addListener(() => {
      keepalivePorts.delete(port);
    });
  });
}

export function stopKeepalive(): void {
  for (const port of keepalivePorts) {
    port.disconnect();
  }
  keepalivePorts.clear();
}
