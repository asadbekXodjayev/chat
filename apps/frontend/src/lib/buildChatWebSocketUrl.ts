import { API_BASE_URL } from './apiClient';
import { getAccessToken, getClientToken, getLanguage } from './session';

// §9.1 — one factory builds the WS URL. wss: if API is https:, else ws:. A trailing /v1 on the
// base path is stripped before appending /v1/chat/ws. Auth + context ride as query params
// (browsers can't set WS headers, §7.2).
export function buildChatWebSocketUrl(): string | null {
  const token = getAccessToken();
  if (!token) return null;

  const u = new URL(API_BASE_URL);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';

  let basePath = u.pathname.replace(/\/$/, '');
  if (basePath.endsWith('/v1')) basePath = basePath.slice(0, -3);
  u.pathname = `${basePath}/v1/chat/ws`;

  u.searchParams.set('token', token);
  u.searchParams.set('device_type', 'web');
  u.searchParams.set('language', getLanguage());
  u.searchParams.set('client_token', getClientToken());
  return u.toString();
}
