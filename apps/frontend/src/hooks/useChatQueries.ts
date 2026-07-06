import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { queryKeys, type ChatConversation } from '@chat/contract';
import { getMessages, listConversations } from '../api/chat';
import type { MessagesPage } from '../lib/messageCache';

// §NFR-2 — queries retry once; mutations retry 0 (set at QueryClient level).
export function useConversationsQuery() {
  return useQuery<ChatConversation[]>({
    queryKey: queryKeys.conversations(),
    queryFn: async () => (await listConversations()).items ?? [],
    staleTime: 5_000,
  });
}

// §14.2 — infinite history, page size 50, keyset cursor.
export function useMessagesQuery(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: conversationId ? queryKeys.messages(conversationId) : ['CHAT_MESSAGES', 'none'],
    enabled: !!conversationId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }): Promise<MessagesPage> =>
      getMessages(conversationId!, { limit: 50, cursor: pageParam, markRead: !pageParam }),
    getNextPageParam: (last: MessagesPage): string | undefined => {
      if (last.cursor) return last.cursor;
      if (last.items.length < 50) return undefined;
      // oldest message id in this newest→oldest page (§14.2)
      const oldest = last.items.reduce((a, b) => (a.created_at <= b.created_at ? a : b));
      return oldest?.id;
    },
  });
}
