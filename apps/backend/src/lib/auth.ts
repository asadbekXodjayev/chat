import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessTokenClaims {
  sub: string; // user id
  role: string;
  typ: 'access' | 'refresh';
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: string;
  refresh_expires_in: number;
  refresh_expires_at: string;
}

export function signTokenPair(userId: string, role: string): TokenPair {
  const now = Math.floor(Date.now() / 1000);
  const access = jwt.sign({ sub: userId, role, typ: 'access' } satisfies AccessTokenClaims, env.jwtSecret, {
    expiresIn: env.accessTokenTtlSeconds,
  });
  const refresh = jwt.sign({ sub: userId, role, typ: 'refresh' } satisfies AccessTokenClaims, env.jwtSecret, {
    expiresIn: env.refreshTokenTtlSeconds,
  });
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: env.accessTokenTtlSeconds,
    expires_at: new Date((now + env.accessTokenTtlSeconds) * 1000).toISOString(),
    refresh_expires_in: env.refreshTokenTtlSeconds,
    refresh_expires_at: new Date((now + env.refreshTokenTtlSeconds) * 1000).toISOString(),
  };
}

export function verifyToken(token: string): AccessTokenClaims | null {
  try {
    return jwt.verify(token, env.jwtSecret) as AccessTokenClaims;
  } catch {
    return null;
  }
}

// §7.1 / Q1 — accept BOTH X-User-Token and Authorization: Bearer; prefer X-User-Token.
export function extractToken(headers: Record<string, unknown>, queryToken?: string): string | null {
  const xUserToken = headers['x-user-token'];
  if (typeof xUserToken === 'string' && xUserToken) return xUserToken;
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  if (queryToken) return queryToken; // WS handshake (§7.2)
  return null;
}
