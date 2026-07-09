import type { FastifyInstance } from 'fastify';
import type { CallCreateRequest } from '@chat/contract';
import { ApiError, sendOk } from '../lib/envelope';
import { authGuard, requireUserId } from '../plugins/context';
import { rateLimit } from '../plugins/rateLimit';
import { env } from '../config/env';
import { CallService, type CallRow } from '../services/calls';
import { UserService } from '../services/users';

export async function callRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authGuard);

  // #9 dev bootstrap
  app.get('/v1/calls/test/bootstrap', async (req, reply) => {
    const userId = requireUserId(req);
    return sendOk(reply, { current_user_id: userId }, { language: req.language });
  });

  // #3 ICE servers (fresh per call)
  app.get('/v1/calls/ice-servers', async (req, reply) => {
    requireUserId(req);
    return sendOk(reply, { ice_servers: await CallService.iceServers() }, { language: req.language });
  });

  // #1 history
  app.get('/v1/calls', async (req, reply) => {
    const userId = requireUserId(req);
    const q = req.query as { limit?: string };
    const calls = await CallService.history(userId, q.limit ? Number(q.limit) : 50);
    return sendOk(reply, { calls }, { language: req.language });
  });

  // #2 create (idempotent, 201 RINGING)
  app.post('/v1/calls', async (req, reply) => {
    const userId = requireUserId(req);
    await rateLimit(userId, 'call_create', env.rlCallCreatePerMin, 60);
    const body = (req.body ?? {}) as CallCreateRequest;
    if (!body.peer_id) throw new ApiError(400, 'invalid_payload_detail');
    const me = await UserService.getById(userId);
    const call = await CallService.create(userId, body, me?.name ?? null, me?.phone ?? '');
    return sendOk(reply, { call }, { code: 201, language: req.language });
  });

  const loadCallForParty = async (id: string, userId: string): Promise<CallRow> => {
    const call = await CallService.getById(id);
    if (!call) throw new ApiError(404, 'call_not_found');
    if (!CallService.isParty(call, userId)) throw new ApiError(403, 'forbidden');
    return call;
  };

  // #4 poll
  app.get('/v1/calls/:id', async (req, reply) => {
    const userId = requireUserId(req);
    const call = await loadCallForParty((req.params as { id: string }).id, userId);
    return sendOk(reply, { call: CallService.mapCallRow(call) }, { language: req.language });
  });

  // #5 accept (callee only)
  app.post('/v1/calls/:id/accept', async (req, reply) => {
    const userId = requireUserId(req);
    const call = await loadCallForParty((req.params as { id: string }).id, userId);
    if (call.callee_id !== userId) throw new ApiError(403, 'forbidden');
    return sendOk(reply, { call: await CallService.accept(call) }, { language: req.language });
  });

  // #6 decline (callee only)
  app.post('/v1/calls/:id/decline', async (req, reply) => {
    const userId = requireUserId(req);
    const call = await loadCallForParty((req.params as { id: string }).id, userId);
    if (call.callee_id !== userId) throw new ApiError(403, 'forbidden');
    const reason = (req.body as { reason?: string } | undefined)?.reason ?? null;
    const out = await CallService.terminate(call, userId, 'DECLINED', reason, 'call.declined');
    return sendOk(reply, { call: out }, { language: req.language });
  });

  // #7 cancel (caller only)
  app.post('/v1/calls/:id/cancel', async (req, reply) => {
    const userId = requireUserId(req);
    const call = await loadCallForParty((req.params as { id: string }).id, userId);
    if (call.caller_id !== userId) throw new ApiError(403, 'forbidden');
    const out = await CallService.terminate(call, userId, 'CANCELLED', null, 'call.cancelled');
    return sendOk(reply, { call: out }, { language: req.language });
  });

  // #8 end (either party)
  app.post('/v1/calls/:id/end', async (req, reply) => {
    const userId = requireUserId(req);
    const call = await loadCallForParty((req.params as { id: string }).id, userId);
    const reason = (req.body as { reason?: string } | undefined)?.reason ?? null;
    const out = await CallService.terminate(call, userId, 'ENDED', reason, 'call.ended');
    return sendOk(reply, { call: out }, { language: req.language });
  });
}
