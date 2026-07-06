import { HEADERS, type ApiResponse } from '@chat/contract';
import {
  clearSession,
  getAccessToken,
  getClientToken,
  getLanguage,
  getRefreshToken,
  updateToken,
  type TokenPair,
} from './session';

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8080';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly description: string,
  ) {
    super(description);
    this.name = 'ApiError';
  }
}

/** Called when refresh fails / auth is definitively gone so the app can bounce to login. */
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: () => void): void {
  onUnauthorized = cb;
}

function contextHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    [HEADERS.clientToken]: getClientToken(),
    [HEADERS.deviceType]: 'web',
    [HEADERS.language]: getLanguage(),
  };
  const token = getAccessToken();
  if (token) h[HEADERS.userToken] = token;
  return h;
}

// §7.3 — single-flight refresh: concurrent 401s queue behind ONE refresh (refresh token rotates).
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  const res = await fetch(`${API_BASE_URL}/v1/user/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...contextHeaders() },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) return false;
  const env = (await res.json()) as ApiResponse<{ token: TokenPair }>;
  if (!env.data?.token) return false;
  updateToken(env.data.token);
  return true;
}

async function ensureRefreshed(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** multipart FormData — do not JSON-encode or set Content-Type. */
  form?: FormData;
  signal?: AbortSignal;
}

async function rawFetch(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...contextHeaders(), ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form; // browser sets multipart boundary
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  return fetch(`${API_BASE_URL}${path}`, { method: opts.method ?? 'GET', headers, body, signal: opts.signal });
}

/** Envelope-aware request. Returns `data`, transparently refreshing+retrying once on 401 (§7.3). */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await rawFetch(path, opts);

  if (res.status === 401) {
    const refreshed = await ensureRefreshed();
    if (refreshed) {
      res = await rawFetch(path, opts); // retry once with the new token
    }
    if (res.status === 401) {
      clearSession();
      onUnauthorized?.();
      throw new ApiError(401, 'Session expired');
    }
  }

  let env: ApiResponse<T> | null = null;
  try {
    env = (await res.json()) as ApiResponse<T>;
  } catch {
    env = null;
  }

  if (!res.ok) {
    // NFR-2: transient 5xx/offline must NOT log out; only definitive 401 clears the session (above).
    throw new ApiError(res.status, env?.description ?? `HTTP ${res.status}`);
  }
  return (env?.data as T) ?? (null as T);
}

/** Authenticated blob fetch for media (§12.9 / §14.4). */
export async function apiFetchBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  let res = await rawFetch(path, { signal });
  if (res.status === 401 && (await ensureRefreshed())) res = await rawFetch(path, { signal });
  if (!res.ok) throw new ApiError(res.status, `media ${res.status}`);
  return res.blob();
}
