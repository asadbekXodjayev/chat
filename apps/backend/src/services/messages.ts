import { normalizeChatMessageType, type ChatMessage } from '@chat/contract';
import { query } from '../db/pool';
import { toRfc3339Nano } from '../lib/time';
import { publishToUser, publishToConversation } from '../ws/bus';
import { ApiError } from '../lib/envelope';
import { PresenceService } from './presence';
import { ConversationService, type ConversationRow } from './conversations';

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  delivered_at: Date | null;
  read_by_a: boolean;
  read_by_b: boolean;
  client_request_id: string | null;
  reply_to_message_id: string | null;
  quote_text: string | null;
  edited_at: Date | null;
}

/** Pure row → wire DTO, viewer-relative (read_by_me / read_by_peer per §6.3). */
export function mapMessageRow(row: MessageRow, requesterId: string, conv: ConversationRow): ChatMessage {
  const isA = conv.user_a_id === requesterId;
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    type: normalizeChatMessageType(row.type),
    body: row.body,
    payload: (row.payload as ChatMessage['payload']) ?? null,
    created_at: toRfc3339Nano(row.created_at),
    updated_at: toRfc3339Nano(row.updated_at),
    deleted_at: row.deleted_at ? toRfc3339Nano(row.deleted_at) : null,
    delivered_at: row.delivered_at ? toRfc3339Nano(row.delivered_at) : null,
    read_by_me: isA ? row.read_by_a : row.read_by_b,
    read_by_peer: isA ? row.read_by_b : row.read_by_a,
    reply_to: row.reply_to_message_id ? { message_id: row.reply_to_message_id, quote_text: row.quote_text } : null,
    edited_at: row.edited_at ? toRfc3339Nano(row.edited_at) : null,
  };
}

export interface SendInput {
  type?: string;
  body?: string | null;
  payload?: Record<string, unknown> | null;
  clientRequestId?: string | null;
  replyToMessageId?: string | null;
  quoteText?: string | null;
}

export const MessageService = {
  async getById(id: string): Promise<MessageRow | null> {
    const r = await query<MessageRow>('SELECT * FROM messages WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  },

  // §5.1 / §15.1 — persist, stamp delivered_at if peer online, update summary+unread, fan out.
  async send(conv: ConversationRow, senderId: string, input: SendInput): Promise<ChatMessage> {
    if (conv.type === 'group' || conv.type === 'channel') return this.sendToGroup(conv, senderId, input);
    const peerId = ConversationService.peerOf(conv, senderId);
    const senderIsA = conv.user_a_id === senderId;
    const peerOnline = await PresenceService.isOnline(peerId);
    const deliveredAt = peerOnline ? new Date() : null;
    const type = normalizeChatMessageType(input.type ?? 'text');

    const inserted = await query<MessageRow>(
      `INSERT INTO messages
        (conversation_id, sender_id, type, body, payload, delivered_at, read_by_a, read_by_b, client_request_id,
         reply_to_message_id, quote_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (conversation_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        conv.id,
        senderId,
        type,
        input.body ?? null,
        input.payload ?? null,
        deliveredAt,
        senderIsA, // sender has read own message
        !senderIsA,
        input.clientRequestId ?? null,
        input.replyToMessageId ?? null,
        input.quoteText ?? null,
      ],
    );

    let row = inserted.rows[0];
    if (!row) {
      // Idempotent retry: return the already-stored message without re-broadcasting.
      const existing = await query<MessageRow>(
        'SELECT * FROM messages WHERE conversation_id = $1 AND client_request_id = $2',
        [conv.id, input.clientRequestId],
      );
      return mapMessageRow(existing.rows[0]!, senderId, conv);
    }

    // Update denormalized conversation summary + recipient unread counter.
    const peerIsA = conv.user_a_id === peerId;
    await query(
      `UPDATE conversations
         SET last_message_id = $1, last_message_at = $2, updated_at = now(),
             unread_a = unread_a + $3, unread_b = unread_b + $4
       WHERE id = $5`,
      [row.id, row.created_at, peerIsA ? 1 : 0, peerIsA ? 0 : 1, conv.id],
    );

    // Fan out to the peer (peer-perspective DTO) + delivery receipt back to the sender.
    await publishToUser(peerId, { type: 'message.new', data: mapMessageRow(row, peerId, conv) });
    if (deliveredAt) {
      await publishToUser(senderId, {
        type: 'message_delivered',
        data: {
          conversation_id: conv.id,
          message_ids: [row.id],
          delivered_at: toRfc3339Nano(deliveredAt),
        },
      });
    }
    return mapMessageRow(row, senderId, conv);
  },

  /** Group/channel send: per-member unread + N-way fanout (§5.10). Channels: only owner/admin post. */
  async sendToGroup(conv: ConversationRow, senderId: string, input: SendInput): Promise<ChatMessage> {
    if (conv.type === 'channel') {
      const r = await query<{ role: string }>(
        'SELECT role FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
        [conv.id, senderId],
      );
      const role = r.rows[0]?.role;
      if (role !== 'owner' && role !== 'admin') throw new ApiError(403, 'forbidden');
    }
    const type = normalizeChatMessageType(input.type ?? 'text');
    const inserted = await query<MessageRow>(
      `INSERT INTO messages
        (conversation_id, sender_id, type, body, payload, delivered_at, read_by_a, read_by_b, client_request_id,
         reply_to_message_id, quote_text)
       VALUES ($1,$2,$3,$4,$5, now(), true, true, $6, $7, $8)
       ON CONFLICT (conversation_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [conv.id, senderId, type, input.body ?? null, input.payload ?? null, input.clientRequestId ?? null, input.replyToMessageId ?? null, input.quoteText ?? null],
    );
    const row = inserted.rows[0];
    if (!row) {
      const existing = await query<MessageRow>('SELECT * FROM messages WHERE conversation_id = $1 AND client_request_id = $2', [conv.id, input.clientRequestId]);
      return mapMessageRow(existing.rows[0]!, senderId, conv);
    }
    await query('UPDATE conversations SET last_message_id = $1, last_message_at = $2, updated_at = now() WHERE id = $3', [row.id, row.created_at, conv.id]);
    await query('UPDATE conversation_members SET unread_count = unread_count + 1 WHERE conversation_id = $1 AND user_id <> $2', [conv.id, senderId]);
    await publishToConversation(conv.id, { type: 'message.new', data: mapMessageRow(row, senderId, conv) }, senderId);
    return mapMessageRow(row, senderId, conv);
  },

  // §8.1 #11 — edit (text only), broadcast message.updated.
  async edit(row: MessageRow, conv: ConversationRow, body: string): Promise<ChatMessage> {
    const updated = await query<MessageRow>(
      'UPDATE messages SET body = $1, updated_at = now(), edited_at = now() WHERE id = $2 RETURNING *',
      [body, row.id],
    );
    const r = updated.rows[0]!;
    const peerId = ConversationService.peerOf(conv, row.sender_id);
    await publishToUser(peerId, { type: 'message.updated', data: mapMessageRow(r, peerId, conv) });
    return mapMessageRow(r, row.sender_id, conv);
  },

  // §8.1 #12 — soft delete, broadcast message.deleted.
  async softDelete(row: MessageRow, conv: ConversationRow): Promise<{ deleted: boolean }> {
    await query('UPDATE messages SET deleted_at = now(), body = NULL, payload = NULL WHERE id = $1', [row.id]);
    const peerId = ConversationService.peerOf(conv, row.sender_id);
    await publishToUser(peerId, {
      type: 'message.deleted',
      data: { conversation_id: conv.id, message_id: row.id },
    });
    return { deleted: true };
  },

  /** Pinned message ids within a conversation (for the DTO is_pinned flag). */
  async pinnedIds(conversationId: string, messageIds: string[]): Promise<Set<string>> {
    if (messageIds.length === 0) return new Set();
    const r = await query<{ message_id: string }>(
      'SELECT message_id FROM message_pins WHERE conversation_id = $1 AND message_id = ANY($2)',
      [conversationId, messageIds],
    );
    return new Set(r.rows.map((x) => x.message_id));
  },

  /** Toggle pin. Returns the new pinned state. */
  async togglePin(conv: ConversationRow, messageId: string, userId: string): Promise<boolean> {
    const existing = await query('SELECT 1 FROM message_pins WHERE conversation_id = $1 AND message_id = $2', [
      conv.id,
      messageId,
    ]);
    if (existing.rows.length > 0) {
      await query('DELETE FROM message_pins WHERE conversation_id = $1 AND message_id = $2', [conv.id, messageId]);
      return false;
    }
    await query(
      'INSERT INTO message_pins (conversation_id, message_id, pinned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [conv.id, messageId, userId],
    );
    return true;
  },

  // §14.2 — history newest→oldest, keyset pagination by (created_at, id).
  async listHistory(
    convId: string,
    opts: { limit: number; cursor?: string; before?: string },
  ): Promise<{ rows: MessageRow[]; cursor: string | null }> {
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    let rows: MessageRow[];
    if (opts.cursor) {
      const anchor = await query<MessageRow>('SELECT created_at, id FROM messages WHERE id = $1', [opts.cursor]);
      const a = anchor.rows[0];
      if (!a) {
        rows = [];
      } else {
        const r = await query<MessageRow>(
          `SELECT * FROM messages
           WHERE conversation_id = $1 AND (created_at, id) < ($2, $3)
           ORDER BY created_at DESC, id DESC LIMIT $4`,
          [convId, a.created_at, a.id, limit],
        );
        rows = r.rows;
      }
    } else {
      const r = await query<MessageRow>(
        `SELECT * FROM messages WHERE conversation_id = $1
         ORDER BY created_at DESC, id DESC LIMIT $2`,
        [convId, limit],
      );
      rows = r.rows;
    }
    const cursor = rows.length === limit ? (rows[rows.length - 1]!.id ?? null) : null;
    return { rows, cursor };
  },
};
