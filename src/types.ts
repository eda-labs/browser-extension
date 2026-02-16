// Minimal type declarations for the browser extension APIs we use.

export interface BrowserAPI {
  runtime: {
    sendMessage: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
    onMessage: {
      addListener: (
        callback: (
          message: Record<string, unknown>,
          sender: unknown,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sendResponse: (response: any) => void,
        ) => boolean | void,
      ) => void;
    };
  };
  storage: {
    local: {
      get: (keys: string[]) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (keys: string[]) => Promise<void>;
    };
    onChanged: {
      addListener: (
        callback: (
          changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
          areaName: string,
        ) => void,
      ) => void;
      removeListener: (
        callback: (
          changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
          areaName: string,
        ) => void,
      ) => void;
    };
  };
}

declare const browser: BrowserAPI | undefined;
declare const chrome: BrowserAPI;

export const api: BrowserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Message types

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface TargetProfile {
  id: string;
  edaUrl: string;
  username: string;
  clientSecret: string;
}

export interface EdaState {
  status: ConnectionStatus;
  edaUrl: string;
  accessToken: string | null;
  refreshToken: string | null;
  clientSecret: string | null;
  accessTokenExpiresAt: number;
  refreshTimerId: ReturnType<typeof setTimeout> | null;
  activeTargetId: string | null;
}

export interface StoredConfig {
  edaUrl?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
}

export interface ConnectResult {
  ok: boolean;
  error?: string;
}

export interface ProxyResponse {
  ok: boolean;
  status: number;
  body: string;
}
