import type { ChatParticipant } from '@chat/contract';

// Token object shape from the server (§7.3).
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: string;
  refresh_expires_in: number;
  refresh_expires_at: string;
}

interface Session {
  user: ChatParticipant;
  token: TokenPair;
}

const KEY = 'chat.session';
const CLIENT_TOKEN_KEY = 'chat.clientToken';

let cached: Session | null = readInitial();

function readInitial(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  return cached;
}
export function getUser(): ChatParticipant | null {
  return cached?.user ?? null;
}
export function getAccessToken(): string | null {
  return cached?.token.access_token ?? null;
}
export function getRefreshToken(): string | null {
  return cached?.token.refresh_token ?? null;
}

export function setSession(user: ChatParticipant, token: TokenPair): void {
  cached = { user, token };
  localStorage.setItem(KEY, JSON.stringify(cached));
}

export function updateToken(token: TokenPair): void {
  if (!cached) return;
  cached = { ...cached, token };
  localStorage.setItem(KEY, JSON.stringify(cached));
}

export function clearSession(): void {
  cached = null;
  localStorage.removeItem(KEY);
}

/** Stable per-browser client fingerprint for X-Client-Token (§7.1). */
export function getClientToken(): string {
  let t = localStorage.getItem(CLIENT_TOKEN_KEY);
  if (!t) {
    t = crypto.randomUUID();
    localStorage.setItem(CLIENT_TOKEN_KEY, t);
  }
  return t;
}

export function getLanguage(): string {
  return (navigator.language || 'en').split('-')[0] ?? 'en';
}
