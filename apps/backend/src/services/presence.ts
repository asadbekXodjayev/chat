import {
  redisKeys,
  REDIS_PRESENCE_TTL_SECONDS,
  REDIS_TYPING_TTL_SECONDS,
  REDIS_LASTSEEN_TTL_SECONDS,
  type ChatPresence,
} from '@chat/contract';
import { redis } from '../redis/redis';
import { nowUnixSeconds } from '../lib/time';

// §10.1/§10.2 — Redis is the presence brain. TTLs are NORMATIVE (65s / 15s / 30d).
export const PresenceService = {
  async setOnline(userId: string): Promise<void> {
    await redis.set(redisKeys.presence(userId), '1', 'EX', REDIS_PRESENCE_TTL_SECONDS);
  },
  /** Refresh presence TTL on WS ping/pong or any activity (keeps a silent client online). */
  async refresh(userId: string): Promise<void> {
    await redis.set(redisKeys.presence(userId), '1', 'EX', REDIS_PRESENCE_TTL_SECONDS);
  },
  async setOffline(userId: string): Promise<void> {
    await redis.del(redisKeys.presence(userId));
    await redis.set(redisKeys.lastseen(userId), String(nowUnixSeconds()), 'EX', REDIS_LASTSEEN_TTL_SECONDS);
  },
  async isOnline(userId: string): Promise<boolean> {
    return (await redis.exists(redisKeys.presence(userId))) === 1;
  },
  async getPresence(userId: string, conversationId?: string): Promise<ChatPresence> {
    const online = await this.isOnline(userId);
    let last_seen: number | null = null;
    if (!online) {
      const v = await redis.get(redisKeys.lastseen(userId));
      last_seen = v ? Number(v) : null;
    }
    let typing: boolean | null = null;
    if (conversationId) {
      typing = (await redis.exists(redisKeys.typing(conversationId, userId))) === 1;
    }
    return { user_id: userId, online, last_seen, typing };
  },
  async setTyping(conversationId: string, userId: string): Promise<void> {
    await redis.set(redisKeys.typing(conversationId, userId), '1', 'EX', REDIS_TYPING_TTL_SECONDS);
  },
  async clearTyping(conversationId: string, userId: string): Promise<void> {
    await redis.del(redisKeys.typing(conversationId, userId));
  },
};
