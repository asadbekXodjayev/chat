import type { ChatParticipant, ChatUserFinderItem, PublicUserProfile } from '@chat/contract';
import { query, tx } from '../db/pool';
import { ApiError } from '../lib/envelope';

export interface UserRow {
  id: string;
  phone: string;
  name: string | null;
  username: string | null;
  bio: string | null;
  role: string;
  has_photo: boolean;
  photo_url: string | null;
  last_seen_at: string | null;
  created_at: string | null;
}

const COLS = 'id, phone, name, username, bio, role, has_photo, photo_url, last_seen_at, created_at';
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

export const UserService = {
  async getById(id: string): Promise<UserRow | null> {
    const r = await query<UserRow>(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  },

  async getByPhone(phone: string): Promise<UserRow | null> {
    const r = await query<UserRow>(`SELECT ${COLS} FROM users WHERE phone = $1`, [phone]);
    return r.rows[0] ?? null;
  },

  /** Get-or-create by phone (upsert, race-safe). Never sets admin — role stays 'user' by default. */
  async getOrCreateByPhone(phone: string, name?: string | null): Promise<UserRow> {
    const r = await query<UserRow>(
      `INSERT INTO users (phone, name) VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE SET updated_at = now()
       RETURNING ${COLS}`,
      [phone, name ?? null],
    );
    return r.rows[0]!;
  },

  /** A user needs the register step until they have both a display name and a @username. */
  needsRegistration(u: UserRow): boolean {
    return !u.name || !u.username;
  },

  async usernameAvailable(username: string, excludeUserId?: string): Promise<boolean> {
    if (!USERNAME_RE.test(username)) return false;
    const r = await query<{ owner_id: string }>(
      `SELECT owner_id FROM usernames WHERE username = $1 AND owner_type = 'user'`,
      [username],
    );
    const owner = r.rows[0]?.owner_id;
    return !owner || owner === excludeUserId;
  },

  /**
   * Set profile fields. Username uniqueness is enforced through the shared `usernames` registry
   * (so it stays globally unique across users and, later, public groups/channels).
   */
  async setProfile(
    userId: string,
    patch: { name?: string | null; username?: string | null; bio?: string | null },
  ): Promise<UserRow> {
    if (patch.username != null && patch.username !== '' && !USERNAME_RE.test(patch.username)) {
      throw new ApiError(400, 'username_invalid');
    }
    return tx(async (c) => {
      if (patch.username != null && patch.username !== '') {
        // Claim the handle in the registry; PK/unique conflict ⇒ taken (unless already ours).
        const existing = await c.query<{ owner_id: string }>(
          `SELECT owner_id FROM usernames WHERE username = $1`,
          [patch.username],
        );
        if (existing.rows[0] && existing.rows[0].owner_id !== userId) {
          throw new ApiError(409, 'username_taken');
        }
        // Drop any previous handle owned by this user, then claim the new one.
        await c.query(`DELETE FROM usernames WHERE owner_type = 'user' AND owner_id = $1`, [userId]);
        await c.query(
          `INSERT INTO usernames (username, owner_type, owner_id) VALUES ($1, 'user', $2)`,
          [patch.username, userId],
        );
      }
      const r = await c.query<UserRow>(
        `UPDATE users SET
            name     = COALESCE($2, name),
            username = COALESCE($3, username),
            bio      = COALESCE($4, bio),
            updated_at = now()
          WHERE id = $1
        RETURNING ${COLS}`,
        [userId, patch.name ?? null, patch.username ?? null, patch.bio ?? null],
      );
      if (!r.rows[0]) throw new ApiError(404, 'user_not_identified');
      return r.rows[0];
    });
  },

  /** Seed / ensure the admin account for ADMIN_PHONE (ops-only, called at boot — never via API). */
  async ensureAdmin(phone: string): Promise<void> {
    if (!phone) return;
    await query(
      `INSERT INTO users (phone, name, role) VALUES ($1, 'Admin', 'admin')
         ON CONFLICT (phone) DO UPDATE SET role = 'admin'`,
      [phone],
    );
  },

  // §8.1 #1 — people search. Hardened: match a full/strong-prefix E.164 (≥6 digits), strip `role`.
  async finder(phoneRaw: string, limit: number): Promise<ChatUserFinderItem[]> {
    const digits = phoneRaw.replace(/\D/g, '');
    if (digits.length < 6) return [];
    const r = await query<UserRow>(
      `SELECT ${COLS} FROM users
        WHERE regexp_replace(phone, '\\D', '', 'g') LIKE $1
        ORDER BY phone LIMIT $2`,
      [`${digits}%`, Math.min(Math.max(limit, 1), 20)],
    );
    return r.rows.map((u) => ({
      id: u.id,
      phone: u.phone,
      name: u.name,
      username: u.username,
      has_photo: u.has_photo,
      photo: u.photo_url,
      photo_url: u.photo_url,
    }));
  },

  toParticipant(u: UserRow): ChatParticipant {
    return {
      id: u.id,
      name: u.name,
      phone: u.phone,
      role: u.role,
      username: u.username,
      has_photo: u.has_photo,
      photo_url: u.photo_url,
    };
  },

  toPublicProfile(u: UserRow): PublicUserProfile {
    return {
      id: u.id,
      name: u.name,
      username: u.username,
      bio: u.bio,
      has_photo: u.has_photo,
      photo_url: u.photo_url,
      last_seen: u.last_seen_at ? new Date(u.last_seen_at).getTime() : null,
    };
  },

  toSelfProfile(u: UserRow): PublicUserProfile & { phone: string; role: string } {
    return { ...UserService.toPublicProfile(u), phone: u.phone, role: u.role };
  },
};
