import type { ChatConversation, ChatMessage, ChatMessageType } from '@chat/contract';

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** §12.1 FR-7 — HH:mm if today, else DD.MM.YYYY. */
export function formatMessageTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${two(d.getHours())}:${two(d.getMinutes())}`;
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** §12.4 FR-20 — day-separator label. */
export function daySeparatorLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

export function initials(name: string | null | undefined, phone?: string | null): string {
  const source = (name && name.trim()) || phone || '?';
  const parts = source.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

const TYPE_ICON: Partial<Record<ChatMessageType, string>> = {
  img: '📷 Photo',
  video: '🎥 Video',
  video_note: '⭕ Video note',
  audio: '🎙 Voice message',
  document: '📄 Document',
  location: '📍 Location',
  call: '📞 Call',
};

/** §12.1 FR-6 — sidebar preview priority. */
export function conversationPreview(c: ChatConversation, myId: string): string {
  const last = c.last_message;
  if (last?.deleted_at) return 'Message deleted';
  const fromMe = c.summary_from_me ?? last?.sender_id === myId;
  const prefix = fromMe ? 'You: ' : '';
  const summary = c.summary_preview ?? last?.body;
  if (summary) return prefix + summary;
  const type = c.summary_last_message_type ?? last?.type;
  if (type && TYPE_ICON[type]) return prefix + TYPE_ICON[type];
  return type ? `${prefix}[${type}]` : '';
}

export type ReadReceipt = 'sent' | 'delivered' | 'read';

/**
 * §12.4 FR-28 — own-message receipt. read_by_peer → read; delivered_at (or not newest) → delivered;
 * else single (sent).
 */
export function getOwnMessageReadReceipt(m: ChatMessage, isNewestOwn: boolean): ReadReceipt {
  if (m.read_by_peer) return 'read';
  if (m.delivered_at || !isNewestOwn) return 'delivered';
  return 'sent';
}

export function relativeLastSeen(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return 'offline';
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (secs < 60) return 'last seen just now';
  if (secs < 3600) return `last seen ${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `last seen ${Math.floor(secs / 3600)}h ago`;
  return `last seen ${Math.floor(secs / 86_400)}d ago`;
}
