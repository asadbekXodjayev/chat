import { Fragment, useEffect, useLayoutEffect, useRef } from 'react';
import type { ChatConversation, ChatMessage, ChatParticipant } from '@chat/contract';
import { useChatRealtimeStore } from '../../../stores/useChatRealtimeStore';
import { usePeerPresence } from '../../../hooks/usePeerPresence';
import { dayKey, daySeparatorLabel, relativeLastSeen } from '../../../lib/format';
import { Avatar } from '../../../components/Avatar';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';

interface Props {
  conversation: ChatConversation;
  messages: ChatMessage[];
  me: ChatParticipant;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onBack?: () => void;
  onReply?: (m: ChatMessage) => void;
  onEdit?: (m: ChatMessage) => void;
}

export function ChatThreadPanel({ conversation, messages, me, hasOlder, loadingOlder, onLoadOlder, onBack, onReply, onEdit }: Props) {
  const peerId = conversation.peer_id;
  const online = useChatRealtimeStore((s) => s.isOnline(peerId));
  const peerTyping = useChatRealtimeStore((s) => s.peerTyping[conversation.id] === true);
  const presence = usePeerPresence(peerId, conversation.id);

  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  // §12.4 FR-32 — instant jump to newest on open.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  // Auto-scroll on new message/typing only if already near the bottom (within 80px).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, peerTyping]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const subtitle = peerTyping
    ? 'typing…'
    : online
      ? 'online'
      : presence.data && !presence.data.online
        ? relativeLastSeen(presence.data.last_seen)
        : 'offline';

  const newestOwnId = [...messages].reverse().find((m) => m.sender_id === me.id && !m.deleted_at)?.id ?? null;
  const peer = conversation.peer;

  let lastDay = '';

  return (
    <section className="thread">
      <header className="thread__header">
        {onBack && (
          <button className="thread__back" onClick={onBack} aria-label="Back to chats" type="button">
            <span aria-hidden>←</span>
          </button>
        )}
        <Avatar name={peer?.name} phone={peer?.phone} online={online} size={40} />
        <div className="thread__peer">
          <span className="thread__name">{peer?.name || peer?.phone || 'Unknown user'}</span>
          <span className={`thread__subtitle ${peerTyping ? 'is-typing' : ''}`}>{subtitle}</span>
        </div>
      </header>

      <div className="thread__scroll" ref={scrollRef} onScroll={onScroll}>
        {hasOlder && (
          <div className="thread__loadolder">
            <button className="btn btn--ghost" onClick={onLoadOlder} disabled={loadingOlder}>
              {loadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        )}

        {messages.map((m) => {
          const key = dayKey(m.created_at);
          const showSep = key !== lastDay;
          lastDay = key;
          const own = m.sender_id === me.id;
          return (
            <Fragment key={m.id}>
              {showSep && <div className="thread__daysep">{daySeparatorLabel(m.created_at)}</div>}
              <MessageBubble message={m} own={own} isNewestOwn={m.id === newestOwnId} onReply={onReply} onEdit={onEdit} />
            </Fragment>
          );
        })}

        {peerTyping && <TypingIndicator />}
      </div>
    </section>
  );
}
