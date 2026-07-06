import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatMessage } from '@chat/contract';
import { useChatTyping } from '../../../hooks/useChatTyping';

// §12.5 — composer: auto-grow textarea, Enter=send, Shift+Enter=newline, typing emission (§10.3).
// Supports reply + edit modes (a context bar above the input).
export function ChatComposerPanel({
  conversationId,
  onSend,
  replyTo,
  editing,
  onCancelMode,
}: {
  conversationId: string;
  onSend: (text: string) => Promise<void>;
  replyTo?: ChatMessage | null;
  editing?: ChatMessage | null;
  onCancelMode?: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { onInput, stop } = useChatTyping(conversationId);

  useEffect(() => {
    setText('');
    ref.current?.focus();
  }, [conversationId]);

  // Prefill when entering edit mode; focus when entering reply/edit mode.
  useEffect(() => {
    if (editing) setText(editing.body ?? '');
    if (editing || replyTo) ref.current?.focus();
  }, [editing, replyTo]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  const submit = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    stop();
    try {
      await onSend(value);
      setText('');
      ref.current?.focus();
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && (replyTo || editing)) {
      e.preventDefault();
      setText('');
      onCancelMode?.();
    }
  };

  const mode = editing ? 'edit' : replyTo ? 'reply' : null;

  return (
    <div className="composer-wrap">
      {mode && (
        <div className="composer-bar">
          <span className="composer-bar__icon" aria-hidden>{mode === 'edit' ? '✎' : '↩'}</span>
          <div className="composer-bar__body">
            <span className="composer-bar__title">{mode === 'edit' ? 'Edit message' : 'Reply'}</span>
            <span className="composer-bar__preview">{(editing ?? replyTo)?.body ?? ''}</span>
          </div>
          <button className="composer-bar__close" onClick={() => { setText(''); onCancelMode?.(); }} aria-label="Cancel" type="button">×</button>
        </div>
      )}
      <div className="composer">
        <textarea
          ref={ref}
          className="composer__input"
          data-chat-composer-input
          rows={1}
          value={text}
          placeholder="Message"
          aria-label="Message"
          disabled={sending}
          onChange={(e) => {
            setText(e.target.value);
            onInput();
          }}
          onKeyDown={onKeyDown}
          onBlur={stop}
        />
        {text.trim() ? (
          <button className="composer__send" onClick={() => void submit()} disabled={sending} aria-label={mode === 'edit' ? 'Save edit' : 'Send message'}>
            {mode === 'edit' ? '✓' : '➤'}
          </button>
        ) : (
          <button className="composer__send composer__send--muted" disabled aria-label="Voice message (coming soon)">
            🎙
          </button>
        )}
      </div>
    </div>
  );
}
