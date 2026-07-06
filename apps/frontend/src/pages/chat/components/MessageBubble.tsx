import { Fragment, type ReactNode } from 'react';
import type { ChatMessage } from '@chat/contract';
import { MessageMeta } from './MessageMeta';

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

export function MessageBubble({ message, own, isNewestOwn }: { message: ChatMessage; own: boolean; isNewestOwn: boolean }) {
  if (message.deleted_at) {
    return (
      <div className={`bubble ${own ? 'bubble--own' : 'bubble--peer'} bubble--deleted`}>
        <span className="bubble__deleted">Message deleted</span>
      </div>
    );
  }

  const isText = message.type === 'text';
  return (
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
  );
}
