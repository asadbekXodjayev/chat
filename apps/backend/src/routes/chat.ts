import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { normalizeChatMessageType } from '@chat/contract';
import { ApiError, sendOk } from '../lib/envelope';
import { authGuard, requireUserId } from '../plugins/context';
import { rateLimit } from '../plugins/rateLimit';
import { env } from '../config/env';
import { UserService } from '../services/users';
import { ConversationService, type ConversationRow } from '../services/conversations';
import { MessageService, mapMessageRow } from '../services/messages';
import { ReceiptService } from '../services/receipts';
import { PresenceService } from '../services/presence';
import { MediaService } from '../services/media';
import { redis } from '../redis/redis';

async function loadConversationForMember(id: string, userId: string): Promise<ConversationRow> {
  const conv = await ConversationService.getById(id);
  if (!conv) throw new ApiError(404, 'conversation_not_found');
  if (!ConversationService.isMember(conv, userId)) throw new ApiError(403, 'forbidden');
  return conv;
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authGuard); // every /chat/* route requires auth

  // #1 user-finder
  app.get('/v1/chat/user-finder', async (req, reply) => {
    requireUserId(req);
    const q = req.query as { phone?: string; limit?: string };
    const phone = (q.phone ?? '').trim();
    if (phone.length < 3) return sendOk(reply, { items: [] }, { language: req.language });
    const items = await UserService.finder(phone, q.limit ? Number(q.limit) : 10);
    return sendOk(reply, { items }, { language: req.language });
  });

  // #2 peer avatar is served by userRoutes (GET /v1/chat/users/:id/photo) from photo_attachment_id.

  // #3 conversations list
  app.get('/v1/chat/conversations', async (req, reply) => {
    const userId = requireUserId(req);
    const q = req.query as { limit?: string };
    const rows = await ConversationService.listForUser(userId, q.limit ? Number(q.limit) : 100);
    const items = await Promise.all(rows.map((c) => ConversationService.toDTO(c, userId)));
    return sendOk(reply, { items }, { language: req.language });
  });

  // #4 get-or-create conversation
  app.post('/v1/chat/conversations', async (req, reply) => {
    const userId = requireUserId(req);
    const body = (req.body ?? {}) as { peer_id?: string };
    if (!body.peer_id) throw new ApiError(400, 'invalid_payload_detail');
    if (body.peer_id === userId) throw new ApiError(400, 'invalid_payload_detail');
    const peer = await UserService.getById(body.peer_id);
    if (!peer) throw new ApiError(400, 'invalid_payload_detail');
    const conv = await ConversationService.getOrCreate(userId, body.peer_id);
    return sendOk(reply, await ConversationService.toDTO(conv, userId), { language: req.language });
  });

  // #5 mark read
  app.post('/v1/chat/conversations/:id/read', async (req, reply) => {
    const userId = requireUserId(req);
    const conv = await loadConversationForMember((req.params as { id: string }).id, userId);
    await ReceiptService.markConversationRead(conv, userId);
    return sendOk(reply, { ok: true }, { language: req.language });
  });

  // #6 messages history
  app.get('/v1/chat/conversations/:id/messages', async (req, reply) => {
    const userId = requireUserId(req);
    const conv = await loadConversationForMember((req.params as { id: string }).id, userId);
    const q = req.query as { limit?: string; mark_read?: string; cursor?: string; before?: string };
    const { rows, cursor } = await MessageService.listHistory(conv.id, {
      limit: q.limit ? Number(q.limit) : 50,
      cursor: q.cursor,
      before: q.before,
    });
    if (q.mark_read === '1') await ReceiptService.markConversationRead(conv, userId);
    const items = rows.map((r) => mapMessageRow(r, userId, conv));
    return sendOk(reply, { items, cursor }, { language: req.language });
  });

  // #7 send text
  app.post('/v1/chat/conversations/:id/messages', async (req, reply) => {
    const userId = requireUserId(req);
    await rateLimit(userId, 'send', env.rlSendPerSec, 1);
    const conv = await loadConversationForMember((req.params as { id: string }).id, userId);
    const body = (req.body ?? {}) as { body?: string; client_request_id?: string };
    if (!body.body || body.body.trim().length === 0) throw new ApiError(400, 'invalid_payload_detail');
    const msg = await MessageService.send(conv, userId, {
      type: 'text',
      body: body.body,
      clientRequestId: body.client_request_id ?? null,
    });
    return sendOk(reply, msg, { language: req.language });
  });

  // #8 media upload (multipart)
  app.post('/v1/chat/conversations/:id/messages/media', async (req, reply) => {
    const userId = requireUserId(req);
    await rateLimit(userId, 'upload', env.rlUploadPerMin, 60);
    const conv = await loadConversationForMember((req.params as { id: string }).id, userId);

    let type = 'document';
    let body: string | null = null;
    let filename: string | null = null;
    let fileBuf: Buffer | null = null;
    let mime = 'application/octet-stream';
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (!fileBuf) {
          fileBuf = await part.toBuffer();
          mime = part.mimetype || mime;
          filename = filename ?? part.filename ?? null;
        } else {
          await part.toBuffer(); // drain the duplicated `voice` field
        }
      } else if (part.fieldname === 'type') type = String(part.value);
      else if (part.fieldname === 'body') body = String(part.value);
      else if (part.fieldname === 'filename') filename = String(part.value);
    }
    if (!fileBuf) throw new ApiError(400, 'invalid_payload_detail');
    const canonical = normalizeChatMessageType(type);
    const kind = canonical === 'document' ? 'document' : 'media';
    const attachment = await MediaService.store(fileBuf, mime, kind);
    const msg = await MediaService.sendMediaMessage(conv, userId, type, attachment, body, filename, null);
    return sendOk(reply, msg, { language: req.language });
  });

  // #9 media-ref (dedup send)
  app.post('/v1/chat/conversations/:id/messages/media-ref', async (req, reply) => {
    const userId = requireUserId(req);
    await rateLimit(userId, 'send', env.rlSendPerSec, 1);
    const conv = await loadConversationForMember((req.params as { id: string }).id, userId);
    const body = (req.body ?? {}) as { type?: string; sha256?: string; filename?: string; body?: string };
    if (!body.sha256 || !body.type) throw new ApiError(400, 'invalid_payload_detail');
    const attachment = await MediaService.findBySha(body.sha256);
    if (!attachment) throw new ApiError(404, 'message_not_found');
    // §3.7 — you may only re-attach content you already have access to; else force a fresh upload.
    if (!(await MediaService.userHasSha(body.sha256, userId))) throw new ApiError(404, 'message_not_found');
    const msg = await MediaService.sendMediaMessage(
      conv,
      userId,
      body.type,
      attachment,
      body.body ?? null,
      body.filename ?? null,
      null,
    );
    return sendOk(reply, msg, { language: req.language });
  });

  // #10 file probe (dedup existence)
  app.post('/v1/chat/files/probe', async (req, reply) => {
    const userId = requireUserId(req);
    await rateLimit(userId, 'probe', 30, 60);
    const body = (req.body ?? {}) as { sha256?: string };
    if (!body.sha256) throw new ApiError(400, 'invalid_payload_detail');
    // §3.7 — caller-scoped: only reveal existence/metadata for content this user can already access.
    if (!(await MediaService.userHasSha(body.sha256, userId))) {
      return sendOk(reply, { exists: false }, { language: req.language });
    }
    return sendOk(reply, await MediaService.probe(body.sha256), { language: req.language });
  });

  // #11 edit
  app.patch('/v1/chat/messages/:id', async (req, reply) => {
    const userId = requireUserId(req);
    const row = await MessageService.getById((req.params as { id: string }).id);
    if (!row) throw new ApiError(404, 'message_not_found');
    if (row.sender_id !== userId) throw new ApiError(403, 'forbidden');
    if (row.deleted_at || normalizeChatMessageType(row.type) === 'call') throw new ApiError(400, 'invalid_payload_detail');
    const conv = await loadConversationForMember(row.conversation_id, userId);
    const body = (req.body ?? {}) as { body?: string };
    if (!body.body || body.body.trim().length === 0) throw new ApiError(400, 'invalid_payload_detail');
    return sendOk(reply, await MessageService.edit(row, conv, body.body), { language: req.language });
  });

  // #12 delete
  app.delete('/v1/chat/messages/:id', async (req, reply) => {
    const userId = requireUserId(req);
    const row = await MessageService.getById((req.params as { id: string }).id);
    if (!row) throw new ApiError(404, 'message_not_found');
    if (row.sender_id !== userId) throw new ApiError(403, 'forbidden');
    const conv = await loadConversationForMember(row.conversation_id, userId);
    return sendOk(reply, await MessageService.softDelete(row, conv), { language: req.language });
  });

  // #13 / #14 authenticated media stream (blob, not envelope)
  const streamMedia = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = requireUserId(req);
    const a = await MediaService.getById((req.params as { id: string }).id);
    if (!a) return reply.code(404).send();
    // §3.4 — authorize on the message↔conversation edge; 404 on miss (no existence oracle).
    if (!(await MediaService.canAccess(a.id, userId))) return reply.code(404).send();
    const buf = await MediaService.readBlob(a);
    const mime = a.mime ?? 'application/octet-stream';
    const inlineSafe = /^(image|audio|video)\//.test(mime) || mime === 'application/pdf';
    reply.header('X-Content-Type-Options', 'nosniff'); // §3.10 — never sniff to text/html or SVG
    reply.header('Content-Type', inlineSafe ? mime : 'application/octet-stream');
    reply.header('Cache-Control', 'private, max-age=3600');
    if (a.kind === 'document' || !inlineSafe) {
      const name = a.storage_key;
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    }
    return reply.send(buf);
  };
  app.get('/v1/chat/media/:id', streamMedia);
  app.get('/v1/chat/files/:id', streamMedia);

  // #15 presence
  app.get('/v1/chat/presence/:user_id', async (req, reply) => {
    requireUserId(req);
    const { user_id } = req.params as { user_id: string };
    const q = req.query as { conversation_id?: string };
    return sendOk(reply, await PresenceService.getPresence(user_id, q.conversation_id), { language: req.language });
  });

  // #16 upsert push token
  app.post('/v1/chat/push-token', async (req, reply) => {
    const userId = requireUserId(req);
    const body = (req.body ?? {}) as { token?: string; device_type?: string };
    if (!body.token) throw new ApiError(400, 'invalid_payload_detail');
    await redis.hset(`chat:pushtokens:${userId}`, body.token, req.language ?? 'en'); // lightweight dev store
    return sendOk(reply, { ok: true }, { language: req.language });
  });

  // #17 remove push token
  app.delete('/v1/chat/push-token', async (req, reply) => {
    const userId = requireUserId(req);
    const body = (req.body ?? {}) as { token?: string };
    if (body.token) await redis.hdel(`chat:pushtokens:${userId}`, body.token);
    return sendOk(reply, { ok: true }, { language: req.language });
  });
}
