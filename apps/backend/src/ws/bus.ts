import { redis } from '../redis/redis';
import { redisKeys } from '@chat/contract';
import { query } from '../db/pool';

// The WS gateway subscribes each online user to their Redis channel and fans frames out to
// that user's live sockets (multi-device). Services publish peer notifications through here —
// this is the ONLY path from a REST mutation to a peer's socket (§3.1 CQRS split).
export async function publishToUser(userId: string, frame: Record<string, unknown>): Promise<void> {
  await redis.publish(redisKeys.userChannel(userId), JSON.stringify(frame));
}

/** Fan a frame to every member of a conversation (groups/channels). DMs are just N=2. §5.10. */
export async function publishToConversation(
  conversationId: string,
  frame: Record<string, unknown>,
  excludeUserId?: string,
): Promise<void> {
  const r = await query<{ user_id: string }>(
    'SELECT user_id FROM conversation_members WHERE conversation_id = $1',
    [conversationId],
  );
  const payload = JSON.stringify(frame);
  await Promise.all(
    r.rows
      .filter((m) => m.user_id !== excludeUserId)
      .map((m) => redis.publish(redisKeys.userChannel(m.user_id), payload)),
  );
}
