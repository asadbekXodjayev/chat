import { query } from '../db/pool';
import { toRfc3339Nano } from '../lib/time';
import { publishToUser } from '../ws/bus';
import { ConversationService, type ConversationRow } from './conversations';

// §5.2 / §15.1 — delivery + read receipts.
export const ReceiptService = {
  // POST /read (or ?mark_read=1): zero reader unread, mark peer's messages read, broadcast conversation_read.
  async markConversationRead(conv: ConversationRow, readerId: string): Promise<void> {
    const readerIsA = conv.user_a_id === readerId;
    await query(
      `UPDATE messages
         SET read_by_a = CASE WHEN $2 THEN true ELSE read_by_a END,
             read_by_b = CASE WHEN $3 THEN true ELSE read_by_b END
       WHERE conversation_id = $1 AND sender_id <> $4 AND deleted_at IS NULL`,
      [conv.id, readerIsA, !readerIsA, readerId],
    );
    await query(
      `UPDATE conversations
         SET unread_a = CASE WHEN $2 THEN 0 ELSE unread_a END,
             unread_b = CASE WHEN $3 THEN 0 ELSE unread_b END
       WHERE id = $1`,
      [conv.id, readerIsA, !readerIsA],
    );
    const peerId = ConversationService.peerOf(conv, readerId);
    await publishToUser(peerId, {
      type: 'conversation_read',
      data: { conversation_id: conv.id, reader_id: readerId },
    });
  },

  // On WS connect (§10.2): stamp delivered_at on messages addressed to this user, notify each sender.
  async flushUndelivered(userId: string): Promise<void> {
    const r = await query<{ id: string; conversation_id: string; sender_id: string }>(
      `SELECT m.id, m.conversation_id, m.sender_id
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE (c.user_a_id = $1 OR c.user_b_id = $1)
          AND m.sender_id <> $1 AND m.delivered_at IS NULL AND m.deleted_at IS NULL`,
      [userId],
    );
    if (r.rows.length === 0) return;
    const now = new Date();
    await query('UPDATE messages SET delivered_at = $1 WHERE id = ANY($2::uuid[])', [
      now,
      r.rows.map((x) => x.id),
    ]);
    // Group by sender → conversation → message ids, notify each sender once per conversation.
    const bySender = new Map<string, Map<string, string[]>>();
    for (const row of r.rows) {
      const byConv = bySender.get(row.sender_id) ?? new Map<string, string[]>();
      const ids = byConv.get(row.conversation_id) ?? [];
      ids.push(row.id);
      byConv.set(row.conversation_id, ids);
      bySender.set(row.sender_id, byConv);
    }
    const deliveredAt = toRfc3339Nano(now);
    for (const [senderId, byConv] of bySender) {
      for (const [conversationId, ids] of byConv) {
        await publishToUser(senderId, {
          type: 'message_delivered',
          data: { conversation_id: conversationId, message_ids: ids, delivered_at: deliveredAt },
        });
      }
    }
  },
};
