import type { FastifyInstance, FastifyRequest } from 'fastify';
import { extractToken, verifyToken } from '../lib/auth';
import { ApiError } from '../lib/envelope';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
    userRole: string | null;
    language: string | null;
  }
}

export function attachRequestContext(app: FastifyInstance): void {
  app.decorateRequest('userId', null);
  app.decorateRequest('userRole', null);
  app.decorateRequest('language', null);
  app.addHook('onRequest', async (req) => {
    const lang = req.headers['x-language'];
    req.language = typeof lang === 'string' ? lang : null;
  });
}

/** preHandler for protected routes: resolves X-User-Token / Bearer → req.userId/userRole or 401. */
export async function authGuard(req: FastifyRequest): Promise<void> {
  const token = extractToken(req.headers as Record<string, unknown>);
  const claims = token ? verifyToken(token) : null;
  if (!claims || claims.typ !== 'access') throw new ApiError(401, 'user_not_identified');
  req.userId = claims.sub;
  req.userRole = claims.role;
}

/** preHandler for the admin god-mode surface (§3.2). Role comes from the (DB-derived) access claim. */
export async function adminGuard(req: FastifyRequest): Promise<void> {
  await authGuard(req);
  if (req.userRole !== 'admin') throw new ApiError(403, 'forbidden_admin_only');
}

export function requireUserId(req: FastifyRequest): string {
  if (!req.userId) throw new ApiError(401, 'user_not_identified');
  return req.userId;
}

export function isAdmin(req: FastifyRequest): boolean {
  return req.userRole === 'admin';
}
