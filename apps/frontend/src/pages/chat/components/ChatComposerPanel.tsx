import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatMessage } from '@chat/contract';
import { useChatTyping } from '../../../hooks/useChatTyping';
import { useVoiceRecorder, computeWaveform } from '../../../hooks/useVoiceRecorder';

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ChatComposerPanel({
  conversationId,
  onSend,
  onSendVoice,
  replyTo,
  editing,
  onCancelMode,
}: {
  conversationId: string;
  onSend: (text: string) => Promise<void>;
  onSendVoice?: (blob: Blob, durationMs: number, waveform: number[], mime: string) => Promise<void>;
  replyTo?: ChatMessage | null;
  editing?: ChatMessage | null;
  onCancelMode?: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { onInput, stop } = useChatTyping(conversationId);
  const recorder = useVoiceRecorder();

  useEffect(() => {
    setText('');
    ref.current?.focus();
  }, [conversationId]);

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

  const finishVoice = async () => {
    const res = await recorder.stop();
    if (res && res.durationMs > 400 && onSendVoice) {
      const wf = await computeWaveform(res.blob);
      try {
        await onSendVoice(res.blob, res.durationMs, wf, res.mime);
      } catch {
        /* global error path */
      }
    }
  };

  const mode = editing ? 'edit' : replyTo ? 'reply' : null;

  if (recorder.recording) {
    return (
      <div className="composer-wrap">
        <div className="composer composer--rec">
          <button className="composer__icon composer__icon--danger" onClick={() => recorder.cancel()} aria-label="Cancel recording" type="button">
            🗑
          </button>
          <div className="rec">
            <span className="rec__dot" aria-hidden />
            <span className="rec__time">{fmt(recorder.durationMs)}</span>
            <span className="rec__hint muted">Recording…</span>
          </div>
          <button className="composer__send" onClick={() => void finishVoice()} aria-label="Send voice message" type="button">
            ➤
          </button>
        </div>
      </div>
    );
  }

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
          <button
            className="composer__send"
            onClick={() => void recorder.start()}
            aria-label="Record voice message"
            type="button"
            disabled={!onSendVoice}
          >
            🎙
          </button>
        )}
      </div>
    </div>
  );
}
