import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useChatTyping } from '../../../hooks/useChatTyping';

// §12.5 — composer: auto-grow textarea, Enter=send, Shift+Enter=newline, typing emission (§10.3).
export function ChatComposerPanel({
  conversationId,
  onSend,
}: {
  conversationId: string;
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { onInput, stop } = useChatTyping(conversationId);

  // Auto-focus on conversation activate (FR-40); reset draft on switch.
  useEffect(() => {
    setText('');
    ref.current?.focus();
  }, [conversationId]);

  // Auto-grow 1–6 rows.
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
    stop(); // typing_stop on send
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
    }
  };

  return (
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
        <button className="composer__send" onClick={() => void submit()} disabled={sending} aria-label="Send message">
          ➤
        </button>
      ) : (
        <button className="composer__send composer__send--muted" disabled aria-label="Voice message (coming soon)">
          🎙
        </button>
      )}
    </div>
  );
}
