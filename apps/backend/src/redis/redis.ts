import { Redis } from 'ioredis';
import { env } from '../config/env';

// Two connections: one for commands (SET/GET/DEL/PUBLISH), one dedicated to SUBSCRIBE
// (a subscribed connection can't issue normal commands).
export const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
export const redisSub = new Redis(env.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });

redis.on('error', (e) => console.error('[redis] error', e.message));
redisSub.on('error', (e) => console.error('[redis:sub] error', e.message));
