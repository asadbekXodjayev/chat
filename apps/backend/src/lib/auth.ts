import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { env } from '../config/env';

export interface AccessTokenClaims {
  sub: string; // user id
  role: string;
  typ: 'access';
}

export interface RefreshTokenClaims {
  sub: string; // user id
  jti: string; // session/rotation id (stored hashed in auth_sessions)
  fam: string; // rotation family id
  typ: 'refresh';
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: string;
  refresh_expires_in: number;
  refresh_expires_at: string;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function signAccessToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role, typ: 'access' } satisfies AccessTokenClaims, env.authAccessSecret, {
    expiresIn: env.accessTokenTtlSeconds,
  });
}

export function signRefreshToken(userId: string, jti: string, familyId: string): string {
  return jwt.sign({ sub: userId, jti, fam: familyId, typ: 'refresh' } satisfies RefreshTokenClaims, env.authRefreshSecret, {
    expiresIn: env.refreshTokenTtlSeconds,
  });
}

/** Build the wire TokenPair from an already-issued access token + refresh token. */
export function buildTokenPair(accessToken: string, refreshToken: string): TokenPair {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: env.accessTokenTtlSeconds,
    expires_at: new Date((now + env.accessTokenTtlSeconds) * 1000).toISOString(),
    refresh_expires_in: env.refreshTokenTtlSeconds,
    refresh_expires_at: new Date((now + env.refreshTokenTtlSeconds) * 1000).toISOString(),
  };
}

export function verifyAccessToken(token: string): AccessTokenClaims | null {
  try {
    const claims = jwt.verify(token, env.authAccessSecret) as AccessTokenClaims;
    return claims.typ === 'access' ? claims : null;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshTokenClaims | null {
  try {
    const claims = jwt.verify(token, env.authRefreshSecret) as RefreshTokenClaims;
    return claims.typ === 'refresh' ? claims : null;
  } catch {
    return null;
  }
}

/** Back-compat alias — the authGuard / WS gateway only ever verify ACCESS tokens. */
export const verifyToken = verifyAccessToken;

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
