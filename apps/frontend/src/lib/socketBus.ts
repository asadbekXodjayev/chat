// The one shared socket is owned by useChatWebSocket; this bus lets the composer emit the only
// client→server frames it produces (typing / typing_stop, §9.3) without prop-drilling the socket.
let sock: WebSocket | null = null;

export function setActiveSocket(ws: WebSocket | null): void {
  sock = ws;
}

export function sendWsFrame(frame: Record<string, unknown>): boolean {
  if (sock && sock.readyState === WebSocket.OPEN) {
    sock.send(JSON.stringify(frame));
    return true;
  }
  return false;
}
