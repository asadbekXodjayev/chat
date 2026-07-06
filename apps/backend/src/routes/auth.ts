import type { FastifyInstance } from 'fastify';
import { ApiError, sendOk } from '../lib/envelope';
import { signTokenPair, verifyToken } from '../lib/auth';
import { UserService } from '../services/users';

// Auth issuance. In this reference build the identity provider is stubbed:
//   POST /v1/auth/dev-login  — get-or-create a user by phone and mint tokens (DEV ONLY).
//   POST /v1/:role/auth/refresh — rotate an access token from a refresh token (§7.3).
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/auth/dev-login', async (req, reply) => {
    const body = (req.body ?? {}) as { phone?: string; name?: string };
    if (!body.phone || body.phone.trim().length < 3) throw new ApiError(400, 'invalid_payload_detail');
    const user = await UserService.getOrCreateByPhone(body.phone.trim(), body.name ?? null);
    const token = signTokenPair(user.id, user.role);
    return sendOk(reply, { user: UserService.toParticipant(user), token }, { language: req.language });
  });

  app.post('/v1/:role/auth/refresh', async (req, reply) => {
    const body = (req.body ?? {}) as { refresh_token?: string };
    const claims = body.refresh_token ? verifyToken(body.refresh_token) : null;
    if (!claims || claims.typ !== 'refresh') throw new ApiError(401, 'user_not_identified');
    const token = signTokenPair(claims.sub, claims.role);
    return sendOk(reply, { token }, { language: req.language });
  });
}
