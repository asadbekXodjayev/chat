// §6.7 — presence snapshot computed from Redis.
export interface ChatPresence {
  user_id: string;
  online: boolean;
  last_seen: number | null; // unix SECONDS; present only when online === false
  typing: boolean | null; // present only when queried with ?conversation_id=
}

// §10.1 — exact Redis keys + TTLs (NORMATIVE). A mismatch produces stale dots / stuck "typing…".
export const REDIS_PRESENCE_TTL_SECONDS = 65;
export const REDIS_TYPING_TTL_SECONDS = 15;
export const REDIS_LASTSEEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export const redisKeys = {
  presence: (userId: string) => `chat:presence:${userId}`,
  typing: (conversationId: string, userId: string) => `chat:typing:${conversationId}:${userId}`,
  lastseen: (userId: string) => `chat:lastseen:${userId}`,
  /** Per-user pub/sub channel the WS gateway fans out on. */
  userChannel: (userId: string) => `chat:channel:${userId}`,
} as const;
