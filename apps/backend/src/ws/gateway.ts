import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { redisKeys } from '@chat/contract';
import { redisSub } from '../redis/redis';
import { verifyToken } from '../lib/auth';
import { toRfc3339Nano } from '../lib/time';
import { PresenceService } from '../services/presence';
import { ConversationService } from '../services/conversations';
import { ReceiptService } from '../services/receipts';
import { CallService } from '../services/calls';
import { publishToUser } from './bus';

const WS_PATH = '/v1/chat/ws';
const CHANNEL_PREFIX = 'chat:channel:';
const SERVER_PING_MS = 54_000; // §9.1

interface Socket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
}

// Local registry of this node's live sockets, keyed by user (multi-device).
const connections = new Map<string, Set<Socket>>();

async function addConnection(userId: string, ws: Socket): Promise<void> {
  let set = connections.get(userId);
  if (!set) {
    set = new Set();
    connections.set(userId, set);
    await redisSub.subscribe(redisKeys.userChannel(userId));
  }
  set.add(ws);
}

async function removeConnection(userId: string, ws: Socket): Promise<boolean> {
  const set = connections.get(userId);
  if (!set) return true;
  set.delete(ws);
  if (set.size === 0) {
    connections.delete(userId);
    await redisSub.unsubscribe(redisKeys.userChannel(userId));
    return true; // last device gone
  }
  return false;
}

// Redis fan-out: a frame published to a user's channel → all that user's local sockets.
redisSub.on('message', (channel, payload) => {
  if (!channel.startsWith(CHANNEL_PREFIX)) return;
  const userId = channel.slice(CHANNEL_PREFIX.length);
  const set = connections.get(userId);
  if (!set) return;
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
});

async function onConnect(userId: string): Promise<void> {
  await PresenceService.setOnline(userId);
  const peers = await ConversationService.peersOf(userId);
  // Broadcast presence:true to conversation peers, flush undelivered backlog, sweep stuck calls.
  await Promise.all([
    ...peers.map((p) => publishToUser(p.peerId, { type: 'presence', data: { user_id: userId, online: true } })),
    ReceiptService.flushUndelivered(userId),
    CallService.sweepRinging(),
  ]);
}

async function onDisconnect(userId: string): Promise<void> {
  await PresenceService.setOffline(userId);
  const presence = await PresenceService.getPresence(userId);
  const peers = await ConversationService.peersOf(userId);
  await Promise.all(
    peers.flatMap((p) => [
      PresenceService.clearTyping(p.conversationId, userId),
      publishToUser(p.peerId, {
        type: 'presence',
        data: { user_id: userId, online: false, last_seen: presence.last_seen },
      }),
      publishToUser(p.peerId, {
        type: 'typing_stop',
        data: { conversation_id: p.conversationId, user_id: userId, typing: false },
      }),
    ]),
  );
}

// Extract conversation_id from either flat ({conversation_id}) or nested ({data:{conversation_id}}) frames.
function readConversationId(frame: Record<string, unknown>): string | null {
  const flat = frame['conversation_id'];
  if (typeof flat === 'string') return flat;
  const data = frame['data'];
  if (data && typeof data === 'object') {
    const nested = (data as Record<string, unknown>)['conversation_id'];
    if (typeof nested === 'string') return nested;
  }
  return null;
}

async function handleTyping(userId: string, frame: Record<string, unknown>, typing: boolean): Promise<void> {
  const conversationId = readConversationId(frame);
  if (!conversationId) return;
  const conv = await ConversationService.getById(conversationId);
  if (!conv || !ConversationService.isMember(conv, userId)) return; // never trust client-provided membership
  const peerId = ConversationService.peerOf(conv, userId);
  if (typing) await PresenceService.setTyping(conversationId, userId);
  else await PresenceService.clearTyping(conversationId, userId);
  await publishToUser(peerId, {
    type: typing ? 'typing' : 'typing_stop',
    data: { conversation_id: conversationId, user_id: userId, typing },
  });
}

// §9.4 — validate the sender is a party to call_id, then relay the canonical webrtc.* frame.
async function handleSignal(userId: string, wireType: string, frame: Record<string, unknown>): Promise<void> {
  const data = (frame['data'] as Record<string, unknown> | undefined) ?? {};
  const callId = typeof data['call_id'] === 'string' ? (data['call_id'] as string) : null;
  if (!callId) return;
  const call = await CallService.getById(callId);
  if (!call || !CallService.isParty(call, userId)) return; // party-membership guard (NFR-8)
  const targetId = call.caller_id === userId ? call.callee_id : call.caller_id;
  await publishToUser(targetId, {
    type: wireType,
    data: { call_id: callId, from_id: userId, payload: data['payload'] },
  });
}

async function onClientMessage(ws: Socket, raw: Buffer): Promise<void> {
  const userId = ws.userId;
  if (!userId) return;
  await PresenceService.refresh(userId); // any activity refreshes presence TTL
  let frame: Record<string, unknown>;
  try {
    frame = JSON.parse(raw.toString());
  } catch {
    return;
  }
  const type = typeof frame['type'] === 'string' ? (frame['type'] as string) : '';
  switch (type) {
    case 'ping':
      return; // keepalive; presence already refreshed
    case 'typing':
      return handleTyping(userId, frame, true);
    case 'typing_stop':
    case 'typing.stop':
      return handleTyping(userId, frame, false);
    case 'webrtc.offer':
    case 'webrtc.answer':
    case 'webrtc.ice':
      return handleSignal(userId, type, frame);
    default:
      return;
  }
}

export function attachWebSocketGateway(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== WS_PATH) return; // not ours — leave for others
    const token = url.searchParams.get('token');
    const claims = token ? verifyToken(token) : null;
    if (!claims || claims.typ !== 'access') {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as Socket).userId = claims.sub;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: Socket) => {
    const userId = ws.userId!;
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
      void PresenceService.refresh(userId);
    });
    ws.on('message', (data: Buffer) => void onClientMessage(ws, data));
    ws.on('close', () => {
      void (async () => {
        const last = await removeConnection(userId, ws);
        if (last) await onDisconnect(userId);
      })();
    });
    ws.on('error', () => ws.terminate());

    void (async () => {
      await addConnection(userId, ws);
      await onConnect(userId);
    })();
  });

  // §9.1 — server ping every 54s; a missed pong terminates the dead socket.
  const pingTimer = setInterval(() => {
    for (const set of connections.values()) {
      for (const ws of set) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, SERVER_PING_MS);
  pingTimer.unref?.();

  // §5.6 — periodic RINGING→MISSED sweep in case no socket event triggers it.
  const sweepTimer = setInterval(() => void CallService.sweepRinging(), 10_000);
  sweepTimer.unref?.();
}

export function localConnectionCount(): number {
  let n = 0;
  for (const set of connections.values()) n += set.size;
  return n;
}
