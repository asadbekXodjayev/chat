import type { ChatConversation } from '@chat/contract';
import { query } from '../db/pool';
import { toRfc3339Nano } from '../lib/time';
import { UserService } from './users';
import { mapMessageRow, type MessageRow } from './messages';

export interface ConversationRow {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: Date;
  updated_at: Date;
  last_message_id: string | null;
  last_message_at: Date | null;
  unread_a: number;
  unread_b: number;
}

/** Canonical ordering of the unordered pair so the row + unread_a/unread_b are deterministic. */
function canonPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export const ConversationService = {
  peerOf(conv: ConversationRow, userId: string): string {
    return conv.user_a_id === userId ? conv.user_b_id : conv.user_a_id;
  },
  isMember(conv: ConversationRow, userId: string): boolean {
    return conv.user_a_id === userId || conv.user_b_id === userId;
  },
  isUserA(conv: ConversationRow, userId: string): boolean {
    return conv.user_a_id === userId;
  },

  async getById(id: string): Promise<ConversationRow | null> {
    const r = await query<ConversationRow>('SELECT * FROM conversations WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  },

  // §8.1 #4 / §15.1 — get-or-create by {peer_id}, requester ∈ {a,b}.
  async getOrCreate(requesterId: string, peerId: string): Promise<ConversationRow> {
    const [a, b] = canonPair(requesterId, peerId);
    const inserted = await query<ConversationRow>(
      `INSERT INTO conversations (user_a_id, user_b_id) VALUES ($1, $2)
       ON CONFLICT (LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id)) DO NOTHING
       RETURNING *`,
      [a, b],
    );
    if (inserted.rows[0]) return inserted.rows[0];
    const existing = await query<ConversationRow>(
      `SELECT * FROM conversations
       WHERE LEAST(user_a_id, user_b_id) = $1 AND GREATEST(user_a_id, user_b_id) = $2`,
      [a, b],
    );
    return existing.rows[0]!;
  },

  /** All conversations of a user as {conversationId, peerId} — for presence/typing fan-out. */
  async peersOf(userId: string): Promise<Array<{ conversationId: string; peerId: string }>> {
    const r = await query<{ id: string; user_a_id: string; user_b_id: string }>(
      'SELECT id, user_a_id, user_b_id FROM conversations WHERE user_a_id = $1 OR user_b_id = $1',
      [userId],
    );
    return r.rows.map((row) => ({
      conversationId: row.id,
      peerId: row.user_a_id === userId ? row.user_b_id : row.user_a_id,
    }));
  },

  async listForUser(userId: string, limit: number): Promise<ConversationRow[]> {
    const r = await query<ConversationRow>(
      `SELECT * FROM conversations
       WHERE user_a_id = $1 OR user_b_id = $1
       ORDER BY COALESCE(last_message_at, updated_at) DESC
       LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 200)],
    );
    return r.rows;
  },

  async toDTO(conv: ConversationRow, requesterId: string): Promise<ChatConversation> {
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
