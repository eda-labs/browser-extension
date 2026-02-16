export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface TargetProfile {
  id: string;
  edaUrl: string;
  username: string;
  password: string;
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
  username: string | null;
  password: string | null;
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
