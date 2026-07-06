import { randomUUID } from 'node:crypto';
import { query } from '../db/pool';
import {
  buildTokenPair,
  sha256,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type TokenPair,
} from '../lib/auth';
import { env } from '../config/env';
import { UserService } from './users';

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Rotating, revocable refresh sessions (§3.5). One row per session family; the current refresh id
 * (jti) is stored hashed. On rotate we overwrite the jti — replaying a stale refresh token then
 * finds no (family, jti, live) row and the whole family is revoked (theft detection).
 */
export const SessionService = {
  /** Issue a fresh access+refresh pair backed by a new session row. */
  async issue(userId: string, role: string, meta: SessionMeta = {}): Promise<TokenPair> {
    const familyId = randomUUID();
    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + env.refreshTokenTtlSeconds * 1000);
    await query(
      `INSERT INTO auth_sessions (user_id, jti, family_id, user_agent, ip, expires_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5::text::inet, $6, now())`,
      [userId, sha256(jti), familyId, meta.userAgent ?? null, ipOrNull(meta.ip), expiresAt],
    );
    return buildTokenPair(signAccessToken(userId, role), signRefreshToken(userId, jti, familyId));
  },

  /**
   * Verify + rotate. Returns a fresh pair (role re-read from DB) or null on any failure.
   * A replayed/rotated refresh token revokes the entire family.
   */
  async rotate(refreshToken: string, meta: SessionMeta = {}): Promise<TokenPair | null> {
    const claims = verifyRefreshToken(refreshToken);
    if (!claims) return null;

    const found = await query<{ id: string }>(
      `SELECT id FROM auth_sessions
        WHERE family_id = $1 AND jti = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [claims.fam, sha256(claims.jti)],
    );
    if (!found.rows[0]) {
      // Unknown/stale/revoked jti for this family → revoke the whole family (defense-in-depth).
      await query('UPDATE auth_sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [
        claims.fam,
      ]);
      return null;
    }

    // Role re-read from the DB so a demotion takes effect on the next refresh (fixes stale-role).
    const user = await UserService.getById(claims.sub);
    if (!user) return null;

    const newJti = randomUUID();
    await query(
      `UPDATE auth_sessions
          SET jti = $1, last_used_at = now(), user_agent = COALESCE($3, user_agent), ip = COALESCE($4::text::inet, ip)
        WHERE id = $2`,
      [sha256(newJti), found.rows[0].id, meta.userAgent ?? null, ipOrNull(meta.ip)],
    );
    return buildTokenPair(signAccessToken(user.id, user.role), signRefreshToken(user.id, newJti, claims.fam));
  },

  /** Revoke the session behind a refresh token (logout). */
  async revoke(refreshToken: string): Promise<void> {
    const claims = verifyRefreshToken(refreshToken);
    if (!claims) return;
    await query('UPDATE auth_sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [
      claims.fam,
    ]);
  },

  /** Revoke every live session for a user (logout-all / forced re-login). */
  async revokeAllForUser(userId: string): Promise<void> {
    await query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  },
};

function ipOrNull(ip?: string | null): string | null {
  if (!ip) return null;
  // Strip an IPv6-mapped IPv4 prefix; reject anything that clearly is not an address.
  const cleaned = ip.replace(/^::ffff:/, '').trim();
  return cleaned.length > 0 && cleaned.length <= 45 ? cleaned : null;
}
