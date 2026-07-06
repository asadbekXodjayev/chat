import type { ChatParticipant, ChatUserFinderItem } from '@chat/contract';
import { query } from '../db/pool';

export interface UserRow {
  id: string;
  phone: string;
  name: string | null;
  role: string;
  has_photo: boolean;
  photo_url: string | null;
}

export const UserService = {
  async getById(id: string): Promise<UserRow | null> {
    const r = await query<UserRow>('SELECT id, phone, name, role, has_photo, photo_url FROM users WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  },

  /** Dev/login helper: get-or-create a user by phone. */
  async getOrCreateByPhone(phone: string, name?: string | null): Promise<UserRow> {
    const existing = await query<UserRow>('SELECT id, phone, name, role, has_photo, photo_url FROM users WHERE phone = $1', [phone]);
    if (existing.rows[0]) return existing.rows[0];
    const inserted = await query<UserRow>(
      'INSERT INTO users (phone, name) VALUES ($1, $2) RETURNING id, phone, name, role, has_photo, photo_url',
      [phone, name ?? null],
    );
    return inserted.rows[0]!;
  },

  // §8.1 #1 — global people search by phone (min 3 chars enforced at route).
  async finder(phone: string, limit: number): Promise<ChatUserFinderItem[]> {
    const r = await query<UserRow>(
      `SELECT id, phone, name, role, has_photo, photo_url FROM users
       WHERE phone ILIKE $1 ORDER BY phone LIMIT $2`,
      [`%${phone}%`, Math.min(Math.max(limit, 1), 50)],
    );
    return r.rows.map((u) => ({
      role: u.role,
      id: u.id,
      phone: u.phone,
      name: u.name,
      has_photo: u.has_photo,
      photo: u.photo_url,
      photo_url: u.photo_url,
    }));
  },

  toParticipant(u: UserRow): ChatParticipant {
    return { id: u.id, name: u.name, phone: u.phone, role: u.role };
  },
};
