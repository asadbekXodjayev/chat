// Inbound call/webrtc frames are fanned out here by the WS dispatcher (useChatWebSocket) so the
// call layer can consume them without owning the socket. (§7.8 — dispatcher stays a pure router.)
export interface CallFrame {
  kind: string; // WsInternalKind: call_invite | call_accept | call_end | webrtc_offer | webrtc_answer | webrtc_ice
  wire: string;
  data: Record<string, unknown>;
}
type Listener = (f: CallFrame) => void;
const listeners = new Set<Listener>();

export function onCallFrame(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export function emitCallFrame(f: CallFrame): void {
  for (const l of listeners) l(f);
}
