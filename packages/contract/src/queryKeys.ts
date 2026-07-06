// §14.1 — TanStack Query cache keys. Single source of truth for both queries and WS cache patches.
export const queryKeys = {
  conversations: () => ['CHAT_CONVERSATIONS'] as const,
  messages: (conversationId: string) => ['CHAT_MESSAGES', conversationId] as const,
  presence: (peerId: string, conversationId?: string) =>
    ['CHAT_PRESENCE', peerId, conversationId ?? null] as const,
  calls: (conversationId: string) => ['CALLS', conversationId] as const,
  media: (userId: string, path: string) => ['chat-media', userId, path] as const,
  userFinder: (phone: string) => ['CHAT_USER_FINDER', phone] as const,
  iceServers: () => ['CALLS_ICE_SERVERS'] as const,
} as const;
