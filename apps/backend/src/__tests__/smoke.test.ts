import { describe, it, expect, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server';
import { redis, redisSub } from '../redis/redis';
import { pool } from '../db/pool';

// Boots the Fastify app WITHOUT infra and drives it via inject. /health and the auth guard
// run before any DB/Redis access, so these assert routing + envelope + auth wiring end-to-end.
let app: FastifyInstance;

afterAll(async () => {
  await app?.close();
  redis.disconnect();
  redisSub.disconnect();
  await pool.end().catch(() => {});
});

describe('server wiring (no infra)', () => {
  it('health endpoint responds', async () => {
    app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('unauthenticated chat route returns a localized 401 envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/chat/conversations', headers: { 'x-language': 'ru' } });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.status).toBe('error');
    expect(body.code).toBe(401);
    expect(typeof body.description).toBe('string');
    expect(body.data).toBeNull();
  });

  it('rejects a bad WS-style token on the refresh route', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/user/auth/refresh',
      payload: { refresh_token: 'not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });
});
