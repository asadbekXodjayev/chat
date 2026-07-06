import type { FastifyInstance, FastifyRequest } from 'fastify';
import { extractToken, verifyToken } from '../lib/auth';
import { ApiError } from '../lib/envelope';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
    language: string | null;
  }
}

export function attachRequestContext(app: FastifyInstance): void {
  app.decorateRequest('userId', null);
  app.decorateRequest('language', null);
  app.addHook('onRequest', async (req) => {
    const lang = req.headers['x-language'];
    req.language = typeof lang === 'string' ? lang : null;
  });
}

/** preHandler for protected routes: resolves X-User-Token / Bearer → req.userId or 401. */
export async function authGuard(req: FastifyRequest): Promise<void> {
  const token = extractToken(req.headers as Record<string, unknown>);
  const claims = token ? verifyToken(token) : null;
  if (!claims || claims.typ !== 'access') throw new ApiError(401, 'user_not_identified');
  req.userId = claims.sub;
}

export function requireUserId(req: FastifyRequest): string {
  if (!req.userId) throw new ApiError(401, 'user_not_identified');
  return req.userId;
}
