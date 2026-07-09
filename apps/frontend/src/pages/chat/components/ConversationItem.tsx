import { CheckCheck, Radio, Users } from 'lucide-react';
import type { ChatConversation, ChatParticipant } from '@chat/contract';
import { useChatRealtimeStore } from '../../../stores/useChatRealtimeStore';
import { conversationPreview, formatMessageTime } from '../../../lib/format';
import { Avatar } from '../../../components/Avatar';

export function ConversationItem({
  conversation,
  me,
  active,
  onClick,
}: {
  conversation: ChatConversation;
  me: ChatParticipant;
  active: boolean;
  onClick: () => void;
}) {
  const online = useChatRealtimeStore((s) => s.isOnline(conversation.peer_id));
  const peer = conversation.peer;
  const isGroup = conversation.type === 'group' || conversation.type === 'channel';
  const GroupIcon = conversation.type === 'channel' ? Radio : Users;
  const title = isGroup
    ? conversation.title || (conversation.type === 'channel' ? 'Channel' : 'Group')
    : peer?.name || peer?.phone || 'Unknown user';
  const preview = conversationPreview(conversation, me.id);
  const time = conversation.summary_last_message_at ?? conversation.last_message?.created_at;
  const unread = conversation.unread_count;
  const fromMe = conversation.summary_from_me ?? conversation.last_message?.sender_id === me.id;
  const peerRead = conversation.summary_peer_read;

  return (
    <button className={`convrow ${active ? 'is-active' : ''}`} role="listitem" onClick={onClick}>
      <Avatar name={isGroup ? title : peer?.name} phone={isGroup ? undefined : peer?.phone} online={isGroup ? undefined : online} />
      <div className="convrow__body">
        <div className="convrow__top">
          <span className="convrow__name">
            {isGroup && <GroupIcon size={14} aria-hidden className="convrow__kind" />}
            {title}
          </span>
          {time && <span className="convrow__time">{formatMessageTime(time)}</span>}
        </div>
        <div className="convrow__bottom">
          <span className="convrow__preview">
            {fromMe && <CheckCheck size={14} aria-hidden className={`tick ${peerRead ? 'tick--read' : ''}`} />}
            {preview}
          </span>
          {unread > 0 && !active && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
        </div>
      </div>
    </button>
  );
}
