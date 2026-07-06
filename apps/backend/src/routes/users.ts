import type { FastifyInstance } from 'fastify';
import { ApiError, sendOk } from '../lib/envelope';
import { authGuard, requireUserId } from '../plugins/context';
import { UserService } from '../services/users';
import { MediaService } from '../services/media';
import { query } from '../db/pool';

// Profile surface (§5.2). All routes authed.
export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/users/me', { preHandler: authGuard }, async (req, reply) => {
    const user = await UserService.getById(requireUserId(req));
    if (!user) throw new ApiError(404, 'user_not_identified');
    return sendOk(reply, UserService.toSelfProfile(user), { language: req.language });
  });

  app.patch('/v1/users/me', { preHandler: authGuard }, async (req, reply) => {
    const userId = requireUserId(req);
    const body = (req.body ?? {}) as { name?: string; username?: string; bio?: string };
    const patch: { name?: string; username?: string; bio?: string } = {};
    if (typeof body.name === 'string') {
      const n = body.name.trim();
      if (n.length < 1 || n.length > 64) throw new ApiError(400, 'invalid_payload_detail');
      patch.name = n;
    }
    if (typeof body.username === 'string') patch.username = body.username.trim();
    if (typeof body.bio === 'string') {
      if (body.bio.length > 280) throw new ApiError(400, 'invalid_payload_detail');
      patch.bio = body.bio;
    }
    const user = await UserService.setProfile(userId, patch);
    return sendOk(reply, UserService.toSelfProfile(user), { language: req.language });
  });

  app.get('/v1/users/username-available', { preHandler: authGuard }, async (req, reply) => {
    const userId = requireUserId(req);
    const username = String((req.query as { username?: string }).username ?? '').trim();
    const available = await UserService.usernameAvailable(username, userId);
    return sendOk(reply, { available }, { language: req.language });
  });

  app.get('/v1/users/:id', { preHandler: authGuard }, async (req, reply) => {
    const user = await UserService.getById((req.params as { id: string }).id);
    if (!user) throw new ApiError(404, 'user_not_identified');
    return sendOk(reply, UserService.toPublicProfile(user), { language: req.language });
  });

  // Avatar upload (multipart, image only). Avatars are viewable by any authed user (Telegram-like).
  app.post('/v1/users/me/photo', { preHandler: authGuard }, async (req, reply) => {
    const userId = requireUserId(req);
    let buf: Buffer | null = null;
    let mime = 'image/jpeg';
    for await (const part of req.parts()) {
      if (part.type === 'file' && !buf) {
        buf = await part.toBuffer();
        mime = part.mimetype || mime;
      } else if (part.type === 'file') {
        await part.toBuffer();
      }
    }
    if (!buf) throw new ApiError(400, 'invalid_payload_detail');
    if (!mime.startsWith('image/')) throw new ApiError(415, 'unsupported_media_type');
    const attachment = await MediaService.store(buf, mime, 'media');
    const photoUrl = `/v1/chat/users/${userId}/photo`;
    await query('UPDATE users SET has_photo = true, photo_attachment_id = $2, photo_url = $3, updated_at = now() WHERE id = $1', [
      userId,
      attachment.id,
      photoUrl,
    ]);
    const user = await UserService.getById(userId);
    return sendOk(reply, UserService.toSelfProfile(user!), { language: req.language });
  });

  app.delete('/v1/users/me/photo', { preHandler: authGuard }, async (req, reply) => {
    const userId = requireUserId(req);
    await query('UPDATE users SET has_photo = false, photo_attachment_id = NULL, photo_url = NULL WHERE id = $1', [userId]);
    return sendOk(reply, { ok: true }, { language: req.language });
  });

  // Serve any user's avatar to any authed user (semi-public; not gated by the message-edge check).
  app.get('/v1/chat/users/:id/photo', { preHandler: authGuard }, async (req, reply) => {
    const r = await query<{ photo_attachment_id: string | null }>(
      'SELECT photo_attachment_id FROM users WHERE id = $1',
      [(req.params as { id: string }).id],
    );
    const attId = r.rows[0]?.photo_attachment_id;
    if (!attId) return reply.code(404).send();
    const a = await MediaService.getById(attId);
    if (!a) return reply.code(404).send();
    const buf = await MediaService.readBlob(a);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Type', a.mime?.startsWith('image/') ? a.mime : 'application/octet-stream');
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(buf);
  });
}
