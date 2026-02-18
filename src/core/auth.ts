import { doFetchWithTlsFallback } from './fetch';
import { type TokenResponse } from './types';

function parseJson<T>(text: string, errorMessage: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(errorMessage);
  }
}

export function decodeJwtExp(jwt: string): number {
  const parts = jwt.split('.');
  if (parts.length !== 3) return 0;
  const payload: { exp?: number } = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  return (payload.exp ?? 0) * 1000;
}

export async function fetchToken(edaUrl: string, realmPath: string, params: Record<string, string>): Promise<TokenResponse> {
  const url = edaUrl.replace(/\/+$/, '') +
    '/core/httpproxy/v1/keycloak/realms/' + realmPath + '/protocol/openid-connect/token';
  const response = await doFetchWithTlsFallback(
    edaUrl,
    url,
    'POST',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    new URLSearchParams(params).toString(),
  );

  if (!response.ok) {
    throw new Error('Token request failed (' + response.status + '): ' + response.body);
  }

  return parseJson<TokenResponse>(response.body, 'Invalid token response payload');
}

async function fetchKeycloakToken(edaUrl: string, username: string, password: string): Promise<string> {
  const data = await fetchToken(edaUrl, 'master', {
    grant_type: 'password',
    client_id: 'admin-cli',
    username,
    password,
  });
  return data.access_token;
}

export async function fetchClientSecret(edaUrl: string, username: string, password: string): Promise<string> {
  const base = edaUrl.replace(/\/+$/, '') + '/core/httpproxy/v1/keycloak';
  const kcToken = await fetchKeycloakToken(edaUrl, username, password);
  const authHeader = { Authorization: 'Bearer ' + kcToken };

  const clientsResponse = await doFetchWithTlsFallback(
    edaUrl,
    base + '/admin/realms/eda/clients?clientId=eda',
    'GET',
    authHeader,
    undefined,
  );
  if (!clientsResponse.ok) {
    throw new Error('Failed to list Keycloak clients (' + clientsResponse.status + '): ' + clientsResponse.body);
  }
  const clients = parseJson<Array<{ id: string }>>(
    clientsResponse.body,
    'Invalid Keycloak client list response',
  );
  if (!clients.length) {
    throw new Error('Keycloak client "eda" not found – check privileges');
  }
  const clientUuid = clients[0].id;

  const secretResponse = await doFetchWithTlsFallback(
    edaUrl,
    base + '/admin/realms/eda/clients/' + clientUuid + '/client-secret',
    'GET',
    authHeader,
    undefined,
  );
  if (!secretResponse.ok) {
    throw new Error('Failed to fetch client secret (' + secretResponse.status + '): ' + secretResponse.body);
  }
  const secretData = parseJson<{ value: string }>(
    secretResponse.body,
    'Invalid Keycloak secret response',
  );
  return secretData.value;
}
