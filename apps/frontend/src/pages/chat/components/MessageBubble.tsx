import { Fragment, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ChatMessage } from '@chat/contract';
import { MessageMeta } from './MessageMeta';
import { toggleReaction } from '../../../api/chat';
import { upsertMessage, type MessagesInfinite } from '../../../lib/messageCache';

// §12.4 FR-24 — linkify http(s):// and www. with trailing punctuation excluded.
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

const MEDIA_LABEL: Record<string, string> = {
  img: '📷 Photo',
  video: '🎥 Video',
  video_note: '⭕ Video note',
  audio: '🎙 Voice message',
  document: '📄 Document',
  location: '📍 Location',
  call: '📞 Call',
};

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👏'];

export function MessageBubble({ message, own, isNewestOwn }: { message: ChatMessage; own: boolean; isNewestOwn: boolean }) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  const react = async (arg: { emoji?: string; text?: string }) => {
    setPickerOpen(false);
    try {
      const updated = await toggleReaction(message.id, arg);
      qc.setQueryData(queryKeys.messages(message.conversation_id), (old) =>
        upsertMessage(old as MessagesInfinite | undefined, updated),
      );
    } catch {
      /* surfaced by the global error path; keep the UI responsive */
    }
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

  return (
    <div className={`msg ${own ? 'msg--own' : 'msg--peer'}`}>
      <div className="msg__row">
        <div className={`bubble ${own ? 'bubble--own' : 'bubble--peer'}`}>
          {isText ? (
            <span className="bubble__text">{message.body ? linkify(message.body) : null}</span>
          ) : (
            <span className="bubble__media">
              <span className="bubble__media-label">{MEDIA_LABEL[message.type] ?? `[${message.type}]`}</span>
              {message.body && <span className="bubble__caption">{message.body}</span>}
            </span>
          )}
          <MessageMeta message={message} own={own} isNewestOwn={isNewestOwn} />
        </div>

        <div className="msg__react">
          <button className="msg__react-btn" aria-label="React" onClick={() => setPickerOpen((o) => !o)} type="button">
            🙂
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
              title={r.reacted_by_me ? 'Remove your reaction' : 'React'}
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
