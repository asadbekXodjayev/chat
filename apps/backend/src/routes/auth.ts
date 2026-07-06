import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError, sendOk } from '../lib/envelope';
import { authGuard, requireUserId } from '../plugins/context';
import { OtpService } from '../services/otp';
import { SessionService } from '../services/sessions';
import { UserService } from '../services/users';
import { env } from '../config/env';

function meta(req: FastifyRequest) {
  const ua = req.headers['user-agent'];
  return { userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null, ip: req.ip };
}

// Telegram-OTP auth (§3.1 / §5.1). dev-login is retired in prod (env-gated).
export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Request an OTP. Uniform response regardless of account existence (no enumeration).
  app.post('/v1/auth/request-code', async (req, reply) => {
    const body = (req.body ?? {}) as { phone?: string };
    if (!body.phone) throw new ApiError(400, 'invalid_payload_detail');
    const { resendAfter, delivered } = await OtpService.requestCode(body.phone, req.ip);
    return sendOk(reply, { status: 'code_sent', resend_after: resendAfter, delivered }, {
      descriptionKey: 'otp_sent',
      language: req.language,
    });
  });

  // Verify an OTP → mint a session. New numbers get needs_registration=true.
  app.post('/v1/auth/verify-code', async (req, reply) => {
    const body = (req.body ?? {}) as { phone?: string; code?: string };
    if (!body.phone || !body.code) throw new ApiError(400, 'invalid_payload_detail');
    const phone = await OtpService.verifyCode(body.phone, body.code);
    const user = await UserService.getOrCreateByPhone(phone);
    const token = await SessionService.issue(user.id, user.role, meta(req));
    return sendOk(
      reply,
      { user: UserService.toParticipant(user), token, needs_registration: UserService.needsRegistration(user) },
      { language: req.language },
    );
  });

  // Complete registration (name + unique @username). Authed with the just-issued session.
  app.post('/v1/auth/register', { preHandler: authGuard }, async (req, reply) => {
    const userId = requireUserId(req);
    const body = (req.body ?? {}) as { name?: string; username?: string };
    const name = (body.name ?? '').trim();
    const username = (body.username ?? '').trim();
    if (name.length < 1 || name.length > 64 || !username) throw new ApiError(400, 'invalid_payload_detail');
    const user = await UserService.setProfile(userId, { name, username });
    return sendOk(reply, { user: UserService.toParticipant(user) }, { language: req.language });
  });

  // Stateful, rotating refresh — role re-read from DB, revocable, reuse-detecting (§3.5).
  app.post('/v1/auth/refresh', async (req, reply) => {
    const body = (req.body ?? {}) as { refresh_token?: string };
    if (!body.refresh_token) throw new ApiError(401, 'user_not_identified');
    const token = await SessionService.rotate(body.refresh_token, meta(req));
    if (!token) throw new ApiError(401, 'user_not_identified');
    return sendOk(reply, { token }, { language: req.language });
  });

  // Legacy path used by the current FE apiClient (/v1/user/auth/refresh) — same handler.
  app.post('/v1/:role/auth/refresh', async (req, reply) => {
    const body = (req.body ?? {}) as { refresh_token?: string };
    if (!body.refresh_token) throw new ApiError(401, 'user_not_identified');
    const token = await SessionService.rotate(body.refresh_token, meta(req));
    if (!token) throw new ApiError(401, 'user_not_identified');
    return sendOk(reply, { token }, { language: req.language });
  });

  app.post('/v1/auth/logout', { preHandler: authGuard }, async (req, reply) => {
    const body = (req.body ?? {}) as { refresh_token?: string };
    if (body.refresh_token) await SessionService.revoke(body.refresh_token);
    return sendOk(reply, { ok: true }, { language: req.language });
  });

  app.post('/v1/auth/logout-all', { preHandler: authGuard }, async (req, reply) => {
    await SessionService.revokeAllForUser(requireUserId(req));
    return sendOk(reply, { ok: true }, { language: req.language });
  });

  // DEV ONLY — retired in prod. Mounted only under the same gate as the test OTP.
  if (env.authAllowDevLogin && !env.isProd) {
    app.post('/v1/auth/dev-login', async (req, reply) => {
      const body = (req.body ?? {}) as { phone?: string; name?: string };
      if (!body.phone || body.phone.trim().length < 3) throw new ApiError(400, 'invalid_payload_detail');
      const user = await UserService.getOrCreateByPhone(body.phone.trim(), body.name ?? null);
      const token = await SessionService.issue(user.id, user.role, meta(req));
      return sendOk(reply, { user: UserService.toParticipant(user), token }, { language: req.language });
    });
  }
}
