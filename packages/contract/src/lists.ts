import type { ApiResponse } from './envelope.js';
import type { ChatConversation } from './conversations.js';
import type { ChatMessage } from './messages.js';
import type { Call } from './calls.js';
import type { ChatUserFinderItem } from './users.js';

// §6.10 — tolerant list shapes. Client accepts either `items` or the type-specific key.
export type ConversationsResponse = ApiResponse<{
  items?: ChatConversation[];
  conversations?: ChatConversation[];
  total?: number;
}>;

export type MessagesResponse = ApiResponse<{
  items?: ChatMessage[];
  messages?: ChatMessage[];
  cursor?: string | null;
}>;

export type CallsResponse = ApiResponse<{ calls?: Call[]; items?: Call[] }>;

export type UserFinderResponse = ApiResponse<{ items?: ChatUserFinderItem[] }>;

/** Pull the array out of a tolerant list envelope regardless of which key the server used. */
export function pickList<T>(data: { items?: T[] } & Record<string, unknown>, ...altKeys: string[]): T[] {
  if (Array.isArray(data.items)) return data.items;
  for (const key of altKeys) {
    const v = data[key];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}
