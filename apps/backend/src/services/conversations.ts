import type { ChatConversation, ConversationMember, MemberRole } from '@chat/contract';
import { query, tx } from '../db/pool';
import { toRfc3339Nano } from '../lib/time';
import { UserService } from './users';
import { mapMessageRow, type MessageRow } from './messages';

export interface ConversationRow {
  id: string;
  type: string; // dm | group | channel | saved
  user_a_id: string | null;
  user_b_id: string | null;
  title: string | null;
  description: string | null;
  username: string | null;
  owner_id: string | null;
  has_photo: boolean;
  photo_url: string | null;
  member_count: number;
  is_public: boolean;
  created_at: Date;
  updated_at: Date;
  last_message_id: string | null;
  last_message_at: Date | null;
  unread_a: number;
  unread_b: number;
}

function canonPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export const ConversationService = {
  /** DM peer (only valid for type='dm'). */
  peerOf(conv: ConversationRow, userId: string): string {
    return (conv.user_a_id === userId ? conv.user_b_id : conv.user_a_id)!;
  },
  /** Sync DM membership via a/b (kept for the DM fast-path). */
  isMember(conv: ConversationRow, userId: string): boolean {
    return conv.user_a_id === userId || conv.user_b_id === userId;
  },
  /** Membership for ANY conversation type (DM fast-path, else the members spine). */
  async isMemberOf(conv: ConversationRow, userId: string): Promise<boolean> {
    if (conv.type === 'dm' || !conv.type) return this.isMember(conv, userId);
    const r = await query('SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [conv.id, userId]);
    return r.rows.length > 0;
  },
  isUserA(conv: ConversationRow, userId: string): boolean {
    return conv.user_a_id === userId;
  },

  async getById(id: string): Promise<ConversationRow | null> {
    const r = await query<ConversationRow>('SELECT * FROM conversations WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  },

  // §8.1 #4 — get-or-create a DM. ON CONFLICT must repeat the partial dm-index predicate (migration 002).
  async getOrCreate(requesterId: string, peerId: string): Promise<ConversationRow> {
    const [a, b] = canonPair(requesterId, peerId);
    const inserted = await query<ConversationRow>(
      `INSERT INTO conversations (user_a_id, user_b_id, type, member_count) VALUES ($1, $2, 'dm', 2)
       ON CONFLICT (LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id)) WHERE type = 'dm' DO NOTHING
       RETURNING *`,
      [a, b],
    );
    if (inserted.rows[0]) {
      await query(
        `INSERT INTO conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, 'member'), ($1, $3, 'member') ON CONFLICT DO NOTHING`,
        [inserted.rows[0].id, a, b],
      );
      return inserted.rows[0];
    }
    const existing = await query<ConversationRow>(
      `SELECT * FROM conversations WHERE type = 'dm'
        AND LEAST(user_a_id, user_b_id) = $1 AND GREATEST(user_a_id, user_b_id) = $2`,
      [a, b],
    );
    return existing.rows[0]!;
  },

  /** Create a group with an owner + initial members. */
  async createGroup(
    ownerId: string,
    title: string,
    memberIds: string[],
    opts: { description?: string | null } = {},
  ): Promise<ConversationRow> {
    return tx(async (c) => {
      const conv = await c.query<ConversationRow>(
        `INSERT INTO conversations (type, title, description, owner_id, is_public, member_count)
         VALUES ('group', $1, $2, $3, false, 1) RETURNING *`,
        [title, opts.description ?? null, ownerId],
      );
      const row = conv.rows[0]!;
      await c.query(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')`, [row.id, ownerId]);
      const uniq = [...new Set(memberIds.filter((id) => id && id !== ownerId))];
      for (const uid of uniq) {
        await c.query(
          `INSERT INTO conversation_members (conversation_id, user_id, role, invited_by) VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
          [row.id, uid, ownerId],
        );
      }
      const cnt = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM conversation_members WHERE conversation_id = $1`, [row.id]);
      await c.query(`UPDATE conversations SET member_count = $2 WHERE id = $1`, [row.id, cnt.rows[0]!.n]);
      row.member_count = cnt.rows[0]!.n;
      return row;
    });
  },

  /** Create a channel (broadcast; only owner/admin post). */
  async createChannel(
    ownerId: string,
    title: string,
    opts: { description?: string | null; isPublic?: boolean } = {},
  ): Promise<ConversationRow> {
    return tx(async (c) => {
      const conv = await c.query<ConversationRow>(
        `INSERT INTO conversations (type, title, description, owner_id, is_public, member_count)
         VALUES ('channel', $1, $2, $3, $4, 1) RETURNING *`,
        [title, opts.description ?? null, ownerId, opts.isPublic ?? false],
      );
      const row = conv.rows[0]!;
      await c.query(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')`, [row.id, ownerId]);
      return row;
    });
  },

  async membersOf(conversationId: string): Promise<ConversationMember[]> {
    const r = await query<{ user_id: string; role: string; joined_at: Date }>(
      `SELECT user_id, role, joined_at FROM conversation_members WHERE conversation_id = $1 ORDER BY joined_at`,
      [conversationId],
    );
    const members: ConversationMember[] = [];
    for (const m of r.rows) {
      const u = await UserService.getById(m.user_id);
      if (u) members.push({ user_id: m.user_id, role: m.role, joined_at: toRfc3339Nano(m.joined_at), user: UserService.toParticipant(u) });
    }
    return members;
  },

  async peersOf(userId: string): Promise<Array<{ conversationId: string; peerId: string }>> {
    const r = await query<{ id: string; user_a_id: string | null; user_b_id: string | null }>(
      "SELECT id, user_a_id, user_b_id FROM conversations WHERE type = 'dm' AND (user_a_id = $1 OR user_b_id = $1)",
      [userId],
    );
    return r.rows.map((row) => ({
      conversationId: row.id,
      peerId: (row.user_a_id === userId ? row.user_b_id : row.user_a_id)!,
    }));
  },

  // Members-based listing so DMs, groups AND channels all appear (§D6).
  async listForUser(userId: string, limit: number): Promise<ConversationRow[]> {
    const r = await query<ConversationRow>(
      `SELECT c.* FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id
        WHERE cm.user_id = $1 AND cm.is_hidden = false
        ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC
        LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 200)],
    );
    return r.rows;
  },

  async lastMessage(conv: ConversationRow, requesterId: string) {
    if (!conv.last_message_id) return null;
    const r = await query<MessageRow>('SELECT * FROM messages WHERE id = $1', [conv.last_message_id]);
    return r.rows[0] ? mapMessageRow(r.rows[0], requesterId, conv) : null;
  },

  async toDTO(conv: ConversationRow, requesterId: string): Promise<ChatConversation> {
    if (conv.type === 'group' || conv.type === 'channel') {
      const [lastMessage, mine] = await Promise.all([
        this.lastMessage(conv, requesterId),
        query<{ unread_count: number; role: string }>(
          'SELECT unread_count, role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
          [conv.id, requesterId],
        ),
      ]);
      const role = mine.rows[0]?.role;
      return {
        id: conv.id,
        peer_id: conv.id,
        peer: null,
        last_message: lastMessage,
        unread_count: mine.rows[0]?.unread_count ?? 0,
        created_at: toRfc3339Nano(conv.created_at),
        updated_at: toRfc3339Nano(conv.updated_at),
        type: conv.type as 'group' | 'channel',
        title: conv.title,
        member_count: conv.member_count,
        my_role: role as MemberRole | undefined,
        can_post: conv.type === 'group' ? true : role === 'owner' || role === 'admin',
        peer_has_photo: conv.has_photo,
        peer_photo_url: conv.photo_url,
        summary_last_message_at: conv.last_message_at ? toRfc3339Nano(conv.last_message_at) : null,
        summary_preview: lastMessage?.body ?? null,
        summary_last_message_type: lastMessage?.type ?? null,
        summary_from_me: lastMessage ? lastMessage.sender_id === requesterId : null,
        summary_last_message_id: conv.last_message_id ?? null,
      };
    }

    // ── DM (unchanged behavior) ──
    const isA = conv.user_a_id === requesterId;
    const peerId = this.peerOf(conv, requesterId);
    const [peerRow, lastRow] = await Promise.all([
      UserService.getById(peerId),
      conv.last_message_id
        ? query<MessageRow>('SELECT * FROM messages WHERE id = $1', [conv.last_message_id]).then((r) => r.rows[0] ?? null)
        : Promise.resolve(null),
    ]);
    const lastMessage = lastRow ? mapMessageRow(lastRow, requesterId, conv) : null;
    return {
      id: conv.id,
      peer_id: peerId,
      peer: peerRow ? UserService.toParticipant(peerRow) : null,
      last_message: lastMessage,
      unread_count: isA ? conv.unread_a : conv.unread_b,
      created_at: toRfc3339Nano(conv.created_at),
      updated_at: toRfc3339Nano(conv.updated_at),
      type: 'dm',
      peer_has_photo: peerRow?.has_photo ?? false,
      peer_photo_url: peerRow?.photo_url ?? null,
      summary_last_message_at: conv.last_message_at ? toRfc3339Nano(conv.last_message_at) : null,
      summary_preview: lastMessage?.body ?? null,
      summary_last_message_type: lastMessage?.type ?? null,
      summary_from_me: lastRow ? lastRow.sender_id === requesterId : null,
      summary_peer_read: lastRow
        ? lastRow.sender_id === requesterId
          ? isA
            ? lastRow.read_by_b
            : lastRow.read_by_a
          : null
        : null,
      summary_last_message_id: conv.last_message_id ?? null,
    };
  },
};
