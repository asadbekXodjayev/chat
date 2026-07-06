import type { ChatReactionAggregate } from '@chat/contract';
import { query } from '../db/pool';
import { ApiError } from '../lib/envelope';

interface ResolvedKey {
  kind: 'emoji' | 'text';
  emoji: string | null;
  text: string | null;
  key: string;
}

/** Normalize a toggle request to a canonical reaction key (§D11). Free text is capped + lowercased for the key. */
function resolveKey(emoji?: string, text?: string): ResolvedKey {
  const e = (emoji ?? '').trim();
  if (e) return { kind: 'emoji', emoji: e.slice(0, 16), text: null, key: e.slice(0, 16) };
  const t = (text ?? '').trim().slice(0, 32);
  if (t) return { kind: 'text', emoji: null, text: t, key: `t:${t.toLowerCase()}` };
  throw new ApiError(400, 'invalid_payload_detail');
}

export const ReactionService = {
  /** Toggle a reaction for (message,user,key): add if absent, remove if present. Idempotent. */
  async toggle(messageId: string, conversationId: string, userId: string, emoji?: string, text?: string): Promise<void> {
    const rk = resolveKey(emoji, text);
    const existing = await query<{ id: string }>(
      'SELECT id FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND reaction_key = $3',
      [messageId, userId, rk.key],
    );
    if (existing.rows[0]) {
      await query('DELETE FROM message_reactions WHERE id = $1', [existing.rows[0].id]);
    } else {
      await query(
        `INSERT INTO message_reactions (message_id, conversation_id, user_id, kind, emoji, text_value, reaction_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (message_id, user_id, reaction_key) DO NOTHING`,
        [messageId, conversationId, userId, rk.kind, rk.emoji, rk.text, rk.key],
      );
    }
  },

  async removeByKey(messageId: string, userId: string, key: string): Promise<void> {
    await query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND reaction_key = $3', [
      messageId,
      userId,
      key,
    ]);
  },

  /** Aggregate reactions for a set of messages, viewer-relative (reacted_by_me). */
  async aggregatesFor(messageIds: string[], userId: string): Promise<Map<string, ChatReactionAggregate[]>> {
    const map = new Map<string, ChatReactionAggregate[]>();
    if (messageIds.length === 0) return map;
    const r = await query<{
      message_id: string;
      reaction_key: string;
      kind: 'emoji' | 'text';
      emoji: string | null;
      text_value: string | null;
      count: number;
      mine: boolean;
    }>(
      `SELECT message_id, reaction_key, kind,
              min(emoji) AS emoji, min(text_value) AS text_value,
              count(*)::int AS count, bool_or(user_id = $2) AS mine
         FROM message_reactions
        WHERE message_id = ANY($1)
        GROUP BY message_id, reaction_key, kind
        ORDER BY count DESC, reaction_key ASC`,
      [messageIds, userId],
    );
    for (const row of r.rows) {
      const list = map.get(row.message_id) ?? [];
      list.push({
        key: row.reaction_key,
        kind: row.kind,
        emoji: row.emoji,
        text: row.text_value,
        count: row.count,
        reacted_by_me: row.mine,
      });
      map.set(row.message_id, list);
    }
    return map;
  },

  async forMessage(messageId: string, userId: string): Promise<ChatReactionAggregate[]> {
    return (await this.aggregatesFor([messageId], userId)).get(messageId) ?? [];
  },
};
