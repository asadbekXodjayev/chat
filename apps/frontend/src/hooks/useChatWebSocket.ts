import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  queryKeys,
  wireTypeToKind,
  TYPING_STOP_WIRE_TYPES,
  WS_TIMERS,
  type ChatMessage,
  type WsMessageDeliveredData,
  type WsConversationReadData,
  type WsMessageDeletedData,
  type WsPresenceData,
  type WsTypingData,
} from '@chat/contract';
import { buildChatWebSocketUrl } from '../lib/buildChatWebSocketUrl';
import { setActiveSocket } from '../lib/socketBus';
import { getUser } from '../lib/session';
import { useChatRealtimeStore } from '../stores/useChatRealtimeStore';
import { markConversationRead } from '../api/chat';
import {
  upsertMessage,
  stampDelivered,
  stampReadByPeer,
  stampDeleted,
  type MessagesInfinite,
} from '../lib/messageCache';

function looksLikeMessage(o: Record<string, unknown>): boolean {
  return typeof o['id'] === 'string' && typeof o['conversation_id'] === 'string' && typeof o['sender_id'] === 'string';
}

function patchMessages(qc: QueryClient, convId: string, fn: (d: MessagesInfinite | undefined) => MessagesInfinite): void {
  qc.setQueryData(queryKeys.messages(convId), (old: MessagesInfinite | undefined) => fn(old));
}

function createDispatcher(qc: QueryClient) {
  const store = () => useChatRealtimeStore.getState();
  const invalidateConversations = () => void qc.invalidateQueries({ queryKey: queryKeys.conversations() });

  return (raw: string): void => {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const wire = (frame['type'] as string) ?? (frame['event'] as string) ?? '';
    let kind = wireTypeToKind(wire);
    const data = (frame['data'] as Record<string, unknown> | undefined) ?? frame;
    // §9.2 — a bare message object (no recognized type) is a `message`.
    if (kind === 'ignored' && looksLikeMessage(frame)) kind = 'message';

    const me = getUser()?.id ?? null;

    switch (kind) {
      case 'message': {
        const msg = data as unknown as ChatMessage;
        store().setUserOnline(msg.sender_id, true);
        store().setPeerTyping(msg.conversation_id, false);
        patchMessages(qc, msg.conversation_id, (d) => upsertMessage(d, msg));
        if (store().activeConversationId === msg.conversation_id && msg.sender_id !== me) {
          void markConversationRead(msg.conversation_id).catch(() => {});
        }
        invalidateConversations();
        break;
      }
      case 'message_update': {
        const msg = data as unknown as ChatMessage;
        patchMessages(qc, msg.conversation_id, (d) => upsertMessage(d, msg));
        invalidateConversations();
        break;
      }
      case 'message_delivered': {
        const d = data as unknown as WsMessageDeliveredData;
        patchMessages(qc, d.conversation_id, (old) => stampDelivered(old, d.message_ids, d.delivered_at));
        invalidateConversations();
        break;
      }
      case 'conversation_read': {
        const d = data as unknown as WsConversationReadData;
        if (me && d.reader_id !== me) patchMessages(qc, d.conversation_id, (old) => stampReadByPeer(old, me));
        invalidateConversations();
        break;
      }
      case 'message_delete': {
        const d = data as unknown as WsMessageDeletedData;
        patchMessages(qc, d.conversation_id, (old) => stampDeleted(old, d.message_id, new Date().toISOString()));
        invalidateConversations();
        break;
      }
      case 'presence': {
        const d = data as unknown as WsPresenceData;
        store().setUserOnline(d.user_id, d.online);
        break;
      }
      case 'typing': {
        const d = data as unknown as WsTypingData;
        const typing = TYPING_STOP_WIRE_TYPES.has(wire) ? false : d.typing !== false;
        store().setPeerTyping(d.conversation_id, typing);
        if (typing) store().setUserOnline(d.user_id, true);
        break;
      }
      // webrtc_* / call_* handled by the (deferred) call modal, ignored at chat-page level.
      default:
        break;
    }
  };
}

/** §14.5 — the single shared socket for this tab: ping keepalive, backoff reconnect, cache patching. */
export function useChatWebSocket(): void {
  const qc = useQueryClient();
  const setWsConnected = useChatRealtimeStore((s) => s.setWsConnected);

  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const dispatch = createDispatcher(qc);

    const resync = () => {
      void qc.invalidateQueries({ queryKey: queryKeys.conversations() });
      const active = useChatRealtimeStore.getState().activeConversationId;
      if (active) {
        void qc.invalidateQueries({ queryKey: queryKeys.messages(active) });
        void markConversationRead(active).catch(() => {});
      }
    };

    const connect = () => {
      const url = buildChatWebSocketUrl();
      if (!url) return;
      ws = new WebSocket(url);
      ws.onopen = () => {
        attempt = 0;
        setWsConnected(true);
        setActiveSocket(ws);
        ws?.send(JSON.stringify({ type: 'ping' }));
        pingTimer = setInterval(() => ws?.send(JSON.stringify({ type: 'ping' })), WS_TIMERS.clientPingIntervalMs);
        resync();
      };
      ws.onmessage = (e) => dispatch(String(e.data));
      ws.onclose = () => {
        setWsConnected(false);
        setActiveSocket(null);
        if (pingTimer) clearInterval(pingTimer);
        if (!stopped) scheduleReconnect();
      };
      ws.onerror = () => ws?.close();
    };

    const scheduleReconnect = () => {
      if (attempt >= WS_TIMERS.reconnectMaxAttempts) return;
      const schedule = WS_TIMERS.reconnectBackoffMs;
      const delay = schedule[Math.min(attempt, schedule.length - 1)] ?? 10_000;
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    connect();
    return () => {
      stopped = true;
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [qc, setWsConnected]);
}
