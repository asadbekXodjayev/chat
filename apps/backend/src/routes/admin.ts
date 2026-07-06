import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sendOk } from '../lib/envelope';
import { adminGuard, requireUserId } from '../plugins/context';
import { query } from '../db/pool';
import { MediaService } from '../services/media';

// §3.2 / §5.9 — admin god-mode read surface. Guarded by adminGuard, deliberately SILENT (never marks
// read / stamps delivered / emits conversation_read / mutates unread), every access is audited.
async function audit(
  req: FastifyRequest,
  action: string,
  targets: { user_id?: string; conversation_id?: string; attachment_id?: string } = {},
): Promise<void> {
  await query(
    `INSERT INTO audit_log (admin_id, action, target_user_id, target_conversation_id, target_attachment_id, ip)
     VALUES ($1, $2, $3, $4, $5, $6::text::inet)`,
    [requireUserId(req), action, targets.user_id ?? null, targets.conversation_id ?? null, targets.attachment_id ?? null, req.ip],
  );
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/admin/users', { preHandler: adminGuard }, async (req, reply) => {
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit ?? 100), 1), 500);
    const r = await query(
      `SELECT id, phone, name, username, role, has_photo, photo_url, created_at, last_seen_at
         FROM users ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    await audit(req, 'list_users');
    return sendOk(reply, { users: r.rows }, { language: req.language });
  });

  app.get('/v1/admin/conversations', { preHandler: adminGuard }, async (req, reply) => {
    const userId = (req.query as { user_id?: string }).user_id ?? null;
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit ?? 100), 1), 500);
    const r = userId
      ? await query(
          `SELECT c.* FROM conversations c
             JOIN conversation_members cm ON cm.conversation_id = c.id
            WHERE cm.user_id = $1 ORDER BY c.last_message_at DESC NULLS LAST LIMIT $2`,
          [userId, limit],
        )
      : await query(`SELECT * FROM conversations ORDER BY last_message_at DESC NULLS LAST LIMIT $1`, [limit]);
    await audit(req, 'list_conversations', { user_id: userId ?? undefined });
    return sendOk(reply, { conversations: r.rows }, { language: req.language });
  });

  app.get('/v1/admin/conversations/:id/messages', { preHandler: adminGuard }, async (req, reply) => {
    const convId = (req.params as { id: string }).id;
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit ?? 100), 1), 500);
    const r = await query(
      `SELECT id, conversation_id, sender_id, type, body, payload, created_at, edited_at, deleted_at
         FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [convId, limit],
    );
    await audit(req, 'read_conversation', { conversation_id: convId });
    return sendOk(reply, { messages: r.rows }, { language: req.language });
  });

  app.get('/v1/admin/media/:id', { preHandler: adminGuard }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const a = await MediaService.getById(id);
    if (!a) return reply.code(404).send();
    const buf = await MediaService.readBlob(a);
    await audit(req, 'read_media', { attachment_id: id });
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Type', a.mime ?? 'application/octet-stream');
    reply.header('Content-Disposition', `attachment`);
    return reply.send(buf);
  });

  app.get('/v1/admin/audit', { preHandler: adminGuard }, async (req, reply) => {
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit ?? 200), 1), 1000);
    const r = await query(`SELECT * FROM audit_log ORDER BY id DESC LIMIT $1`, [limit]);
    return sendOk(reply, { audit: r.rows }, { language: req.language });
  });
}
