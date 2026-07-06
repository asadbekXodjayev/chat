import type { ChatMessage } from '@chat/contract';

// TanStack infinite-query cache shape for [CHAT_MESSAGES, convId].
export interface MessagesPage {
  items: ChatMessage[];
  cursor: string | null;
}
export interface MessagesInfinite {
  pages: MessagesPage[];
  pageParams: unknown[];
}

const empty: MessagesInfinite = { pages: [{ items: [], cursor: null }], pageParams: [undefined] };

function mapPages(data: MessagesInfinite | undefined, fn: (items: ChatMessage[]) => ChatMessage[]): MessagesInfinite {
  const src = data ?? empty;
  return { ...src, pages: src.pages.map((p) => ({ ...p, items: fn(p.items) })) };
}

/** Upsert a message: replace by id anywhere, else append to the first (newest) page. §14.3 `message`. */
export function upsertMessage(data: MessagesInfinite | undefined, msg: ChatMessage): MessagesInfinite {
  const src = data ?? empty;
  let found = false;
  const pages = src.pages.map((p) => {
    const items = p.items.map((m) => {
      if (m.id === msg.id) {
        found = true;
        return { ...m, ...msg };
      }
      return m;
    });
    return { ...p, items };
  });
  if (!found && pages[0]) pages[0] = { ...pages[0], items: [...pages[0].items, msg] };
  return { ...src, pages };
}

/** §14.3 `message_delivered` — stamp delivered_at on matching ids. */
export function stampDelivered(data: MessagesInfinite | undefined, ids: string[], deliveredAt: string): MessagesInfinite {
  const set = new Set(ids);
  return mapPages(data, (items) =>
    items.map((m) => (set.has(m.id) && !m.delivered_at ? { ...m, delivered_at: deliveredAt } : m)),
  );
}

/** §14.3 `conversation_read` (reader≠me) — flag my sent messages read_by_peer=true. */
export function stampReadByPeer(data: MessagesInfinite | undefined, myId: string): MessagesInfinite {
  return mapPages(data, (items) =>
    items.map((m) => (m.sender_id === myId && !m.read_by_peer ? { ...m, read_by_peer: true } : m)),
  );
}

/** §14.3 `message_delete` — tombstone. */
export function stampDeleted(data: MessagesInfinite | undefined, messageId: string, deletedAt: string): MessagesInfinite {
  return mapPages(data, (items) =>
    items.map((m) => (m.id === messageId ? { ...m, deleted_at: deletedAt, body: null, payload: null } : m)),
  );
}

/** Flatten all pages → dedup by id → ascending by created_at (§14.2). */
export function flattenSortedMessages(data: MessagesInfinite | undefined): ChatMessage[] {
  if (!data) return [];
  const byId = new Map<string, ChatMessage>();
  for (const page of data.pages) for (const m of page.items) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
