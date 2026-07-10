import { Fragment, useState, type ReactNode } from 'react';
import {
  Image as ImageIcon,
  Video,
  CirclePlay,
  Mic,
  FileText,
  MapPin,
  Phone,
  Pin,
  Smile,
  MoreHorizontal,
  Reply,
  Copy,
  Pencil,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ChatMessage } from '@chat/contract';
import { MessageMeta } from './MessageMeta';
import { ChatVoiceMessage } from './ChatVoiceMessage';
import { ChatVideoNoteMessage } from './ChatVideoNoteMessage';
import { ChatImageMessage } from './ChatImageMessage';
import { ChatFileMessage } from './ChatFileMessage';
import { toggleReaction, deleteMessage, pinMessage } from '../../../api/chat';
import { upsertMessage, type MessagesInfinite } from '../../../lib/messageCache';

const URL_RE = /((?:https?:\/\/|www\.)[^\s]+)/gi;
function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(<Fragment key={last}>{text.slice(last, idx)}</Fragment>);
    let url = m[0];
    let trailing = '';
    while (/[.,!?)]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    const href = url.startsWith('http') ? url : `https://${url}`;
    out.push(
      <a key={idx} href={href} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
    if (trailing) out.push(<Fragment key={`${idx}t`}>{trailing}</Fragment>);
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key="tail">{text.slice(last)}</Fragment>);
  return out;
}

const MEDIA_META: Record<string, { icon: LucideIcon; label: string }> = {
  img: { icon: ImageIcon, label: 'Photo' },
  video: { icon: Video, label: 'Video' },
  video_note: { icon: CirclePlay, label: 'Video note' },
  audio: { icon: Mic, label: 'Voice message' },
  document: { icon: FileText, label: 'Document' },
  location: { icon: MapPin, label: 'Location' },
  call: { icon: Phone, label: 'Call' },
};

function MediaLabel({ type }: { type: string }) {
  const meta = MEDIA_META[type];
  if (!meta) return <>{`[${type}]`}</>;
  const Icon = meta.icon;
  return (
    <>
      <Icon size={15} aria-hidden /> {meta.label}
    </>
  );
}

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👏'];

interface Props {
  message: ChatMessage;
  own: boolean;
  isNewestOwn: boolean;
  onReply?: (m: ChatMessage) => void;
  onEdit?: (m: ChatMessage) => void;
}

export function MessageBubble({ message, own, isNewestOwn, onReply, onEdit }: Props) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const patchCache = (updated: ChatMessage) =>
    qc.setQueryData(queryKeys.messages(message.conversation_id), (old) =>
      upsertMessage(old as MessagesInfinite | undefined, updated),
    );

  const react = async (arg: { emoji?: string; text?: string }) => {
    setPickerOpen(false);
    try {
      patchCache(await toggleReaction(message.id, arg));
    } catch {
      /* global error path */
    }
  };

  const doPin = async () => {
    setMenuOpen(false);
    try {
      patchCache(await pinMessage(message.id));
    } catch {
      /* noop */
    }
  };
  const doDelete = async () => {
    setMenuOpen(false);
    try {
      await deleteMessage(message.id);
      patchCache({ ...message, deleted_at: new Date().toISOString(), body: null, payload: null, reactions: [] });
    } catch {
      /* noop */
    }
  };
  const doCopy = () => {
    setMenuOpen(false);
    if (message.body) void navigator.clipboard?.writeText(message.body).catch(() => undefined);
  };

  if (message.deleted_at) {
    return (
      <div className={`bubble ${own ? 'bubble--own' : 'bubble--peer'} bubble--deleted`}>
        <span className="bubble__deleted">Message deleted</span>
      </div>
    );
  }

  const isText = message.type === 'text';
  const reactions = message.reactions ?? [];
  const canEdit = own && isText;

  return (
    <div className={`msg ${own ? 'msg--own' : 'msg--peer'}`}>
      <div className="msg__row">
        <div className={`bubble ${own ? 'bubble--own' : 'bubble--peer'}${message.is_pinned ? ' is-pinned' : ''}`}>
          {message.reply_to && (
            <div className="bubble__reply">
              <span className="bubble__reply-bar" aria-hidden />
              <span className="bubble__reply-text">{message.reply_to.quote_text || 'Message'}</span>
            </div>
          )}
          {isText ? (
            <span className="bubble__text">{message.body ? linkify(message.body) : null}</span>
          ) : message.type === 'audio' ? (
            <ChatVoiceMessage message={message} own={own} />
          ) : message.type === 'video_note' ? (
            <ChatVideoNoteMessage message={message} />
          ) : message.type === 'img' ? (
            <ChatImageMessage message={message} />
          ) : message.type === 'document' ? (
            <ChatFileMessage message={message} />
          ) : (
            <span className="bubble__media">
              <span className="bubble__media-label"><MediaLabel type={message.type} /></span>
              {message.body && <span className="bubble__caption">{message.body}</span>}
            </span>
          )}
          {message.is_pinned && <span className="bubble__pin" title="Pinned"><Pin size={13} aria-hidden /></span>}
          <MessageMeta message={message} own={own} isNewestOwn={isNewestOwn} />
        </div>

        <div className="msg__tools">
          <button className="msg__tool" aria-label="React" onClick={() => setPickerOpen((o) => !o)} type="button">
            <Smile size={17} aria-hidden />
          </button>
          <button className="msg__tool" aria-label="Message actions" onClick={() => setMenuOpen((o) => !o)} type="button">
            <MoreHorizontal size={17} aria-hidden />
          </button>
          {pickerOpen && (
            <div className="reactpop" role="menu">
              {QUICK.map((e) => (
                <button key={e} className="reactpop__opt" onClick={() => react({ emoji: e })} type="button">
                  {e}
                </button>
              ))}
            </div>
          )}
          {menuOpen && (
            <>
              <div className="menu__backdrop" onClick={() => setMenuOpen(false)} />
              <div className="menu" role="menu">
                <button className="menu__item" onClick={() => { setMenuOpen(false); onReply?.(message); }} type="button"><Reply size={16} aria-hidden /> Reply</button>
                {isText && <button className="menu__item" onClick={doCopy} type="button"><Copy size={16} aria-hidden /> Copy</button>}
                <button className="menu__item" onClick={doPin} type="button"><Pin size={16} aria-hidden /> {message.is_pinned ? 'Unpin' : 'Pin'}</button>
                {canEdit && <button className="menu__item" onClick={() => { setMenuOpen(false); onEdit?.(message); }} type="button"><Pencil size={16} aria-hidden /> Edit</button>}
                {own && <button className="menu__item menu__item--danger" onClick={doDelete} type="button"><Trash2 size={16} aria-hidden /> Delete</button>}
              </div>
            </>
          )}
        </div>
      </div>

      {reactions.length > 0 && (
        <div className={`reactions ${own ? 'reactions--own' : ''}`}>
          {reactions.map((r) => (
            <button
              key={r.key}
              className={`pill${r.reacted_by_me ? ' is-mine' : ''}`}
              onClick={() => react(r.kind === 'emoji' ? { emoji: r.emoji ?? '' } : { text: r.text ?? '' })}
              type="button"
            >
              <span className="pill__key">{r.kind === 'emoji' ? r.emoji : r.text}</span>
              <span className="pill__count">{r.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
