import { api } from './core/api';
import { postCurrentStatus, handlePageMessage, handleStorageChange } from './core/handlers';

window.addEventListener('message', (event: MessageEvent) => void handlePageMessage(event));

// Announce presence on load
void postCurrentStatus();

// React to status changes via storage
api.storage.onChanged.addListener((changes) => void handleStorageChange(changes));
