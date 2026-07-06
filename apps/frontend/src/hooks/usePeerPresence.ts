import { useQuery } from '@tanstack/react-query';
import { queryKeys, type ChatPresence } from '@chat/contract';
import { getPresence } from '../api/chat';
import { useChatRealtimeStore } from '../stores/useChatRealtimeStore';

// §10.3/§10.4 — HTTP presence reconciliation (source of truth self-heal). Live dot still comes
// from the store; this query supplies last_seen and repairs missed WS events.
export function usePeerPresence(peerId: string | null, conversationId: string | null) {
  const wsConnected = useChatRealtimeStore((s) => s.wsConnected);
  return useQuery<ChatPresence>({
    queryKey: peerId ? queryKeys.presence(peerId, conversationId ?? undefined) : ['CHAT_PRESENCE', 'none'],
    queryFn: () => getPresence(peerId!, conversationId ?? undefined),
    enabled: !!peerId,
    refetchInterval: wsConnected ? 15_000 : 3_000,
  });
}
