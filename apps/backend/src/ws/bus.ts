import { redis } from '../redis/redis';
import { redisKeys } from '@chat/contract';

// The WS gateway subscribes each online user to their Redis channel and fans frames out to
// that user's live sockets (multi-device). Services publish peer notifications through here —
// this is the ONLY path from a REST mutation to a peer's socket (§3.1 CQRS split).
export async function publishToUser(userId: string, frame: Record<string, unknown>): Promise<void> {
  await redis.publish(redisKeys.userChannel(userId), JSON.stringify(frame));
}
