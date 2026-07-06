import { redis } from '../redis/redis';
import { ApiError } from '../lib/envelope';

// §NFR-8 / Q5 — fixed-window per-user limiter in Redis. Returns Retry-After via ApiError.extra.
export async function rateLimit(
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const key = `chat:rl:${bucket}:${userId}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, windowSeconds);
  if (n > limit) {
    const ttl = await redis.ttl(key);
    throw new ApiError(429, 'rate_limited', { retry_after: ttl > 0 ? ttl : windowSeconds });
  }
}
