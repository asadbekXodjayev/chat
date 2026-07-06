import type { ChatMessage } from './messages.js';
import type { Call, CallType } from './calls.js';

// §9 — WebSocket contract.
//
// The socket is RECEIVE-MOSTLY. The client's ENTIRE outbound vocabulary is:
//   ping · typing · typing_stop · webrtc.offer · webrtc.answer · webrtc.ice   (§9.3)
// Everything else (send/edit/delete/mark-read/call-create/accept/end) is REST.

// ---- Internal normalized kinds (§9.2). All downstream code sees only these. ----
export type WsInternalKind =
  | 'message'
  | 'message_update'
  | 'message_delete'
  | 'message_delivered'
  | 'conversation_read'
  | 'presence'
  | 'typing'
  | 'call_invite'
  | 'call_accept'
  | 'webrtc_offer'
  | 'webrtc_answer'
  | 'webrtc_ice'
  | 'call_end'
  | 'ignored';

// §9.2 — wire `type`/`event` string → internal kind. Deliberately liberal.
const WIRE_TYPE_TO_KIND: Record<string, WsInternalKind> = {
  // message
  message: 'message',
  'message.new': 'message',
  'message.created': 'message',
  'message.updated': 'message_update',
  message_updated: 'message_update',
  'message.deleted': 'message_delete',
  message_deleted: 'message_delete',
  message_delivered: 'message_delivered',
  'message.delivered': 'message_delivered',
  conversation_read: 'conversation_read',
  'conversation.read': 'conversation_read',
  // presence / typing
  presence: 'presence',
  'presence.update': 'presence',
  typing: 'typing',
  'typing.start': 'typing',
  'typing.stop': 'typing',
  typing_stop: 'typing',
  typing_stopped: 'typing',
  // calls — lifecycle
  call: 'call_invite',
  'call.invite': 'call_invite',
  'call.ringing': 'call_invite',
  'call.accept': 'call_accept',
  'call.accepted': 'call_accept',
  'call.reject': 'call_end',
  'call.cancel': 'call_end',
  'call.declined': 'call_end',
  'call.cancelled': 'call_end',
  'call.ended': 'call_end',
  'call.missed': 'call_end',
  'call.missed.system': 'call_end',
  'call.failed': 'call_end',
  'call.end': 'call_end',
  // calls — signaling (§9.4 canonical + inbound aliases)
  'webrtc.offer': 'webrtc_offer',
  'call.webrtc.offer': 'webrtc_offer',
  'webrtc.answer': 'webrtc_answer',
  'call.webrtc.answer': 'webrtc_answer',
  'webrtc.ice': 'webrtc_ice',
  'webrtc.candidate': 'webrtc_ice',
  'call.webrtc.ice': 'webrtc_ice',
  'call.webrtc.candidate': 'webrtc_ice',
};

/** Wire types that mean "typing STOPPED" (typing:false) rather than started. */
export const TYPING_STOP_WIRE_TYPES = new Set(['typing.stop', 'typing_stop', 'typing_stopped']);

/** Map a raw wire type/event to the normalized internal kind (§9.2). Unknown → 'ignored'. */
export function wireTypeToKind(wire: string | null | undefined): WsInternalKind {
  if (!wire) return 'ignored';
  return WIRE_TYPE_TO_KIND[wire] ?? 'ignored';
}

// ---- Server → client event payload shapes (§9.2 `data` column) ----
export interface WsMessageDeletedData {
  conversation_id: string;
  message_id: string;
}
export interface WsMessageDeliveredData {
  conversation_id: string;
  message_ids: string[];
  delivered_at: string;
}
export interface WsConversationReadData {
  conversation_id: string;
  reader_id: string;
}
export interface WsPresenceData {
  user_id: string;
  online: boolean;
  last_seen?: number | null;
  typing?: boolean | null;
}
export interface WsTypingData {
  conversation_id: string;
  user_id: string;
  typing: boolean;
}
export interface WsCallInviteData {
  call: Call;
  caller_name?: string | null;
  caller_phone?: string | null;
  call_type?: CallType | null;
}
export interface WsCallLifecycleData {
  call: Call;
}
export interface WsSignalData<P> {
  call_id: string;
  from_id?: string;
  payload: P;
}

/** The envelope the server publishes and the client parses. `data` shape depends on `type`. */
export interface WsServerFrame<T = unknown> {
  type: string;
  event?: string;
  event_type?: string;
  data?: T;
}

// ---- Client → server frames (§9.3). This is the WHOLE outbound vocabulary. ----
export const WS_CLIENT_PING = 'ping';
export const WS_CLIENT_TYPING = 'typing';
export const WS_CLIENT_TYPING_STOP = 'typing_stop';
// §9.4 canonical signaling names the server relays. Getting these wrong = calls never connect.
export const WS_SIGNAL_OFFER = 'webrtc.offer';
export const WS_SIGNAL_ANSWER = 'webrtc.answer';
export const WS_SIGNAL_ICE = 'webrtc.ice';

export type WsClientFrame =
  | { type: typeof WS_CLIENT_PING }
  | { type: typeof WS_CLIENT_TYPING; data: { conversation_id: string } }
  | { type: typeof WS_CLIENT_TYPING_STOP; data: { conversation_id: string } }
  | { type: typeof WS_SIGNAL_OFFER; data: { call_id: string; payload: unknown } }
  | { type: typeof WS_SIGNAL_ANSWER; data: { call_id: string; payload: unknown } }
  | { type: typeof WS_SIGNAL_ICE; data: { call_id: string; payload: unknown } };

// ---- Client timers (§10.3, NORMATIVE) ----
export const WS_TIMERS = {
  clientPingIntervalMs: 25_000,
  serverPingIntervalMs: 54_000,
  typingThrottleMs: 2_800,
  typingIdleStopMs: 5_000,
  typingBlurDebounceMs: 220,
  peerTypingStopGraceMs: 1_200,
  peerTypingHardClearMs: 5_000,
  peerTypingRedisTtlFallbackMs: 15_000,
  presencePollWsUpMs: 15_000,
  presencePollWsDownMs: 3_000,
  messagesPollWsUpMs: 20_000,
  messagesPollWsDownMs: 4_000,
  conversationsPollWsDownMs: 20_000,
  reconnectBackoffMs: [1_000, 2_000, 5_000, 10_000] as const,
  reconnectMaxAttempts: 12,
} as const;
