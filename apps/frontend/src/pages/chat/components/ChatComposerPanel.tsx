import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Trash2, Send, Check, Pencil, Reply, X, Video, Mic, Paperclip, FileText } from 'lucide-react';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, formatBytes, type ChatMessage } from '@chat/contract';
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
  onSendFile,
  onOpenCircle,
  replyTo,
  editing,
  onCancelMode,
}: {
  conversationId: string;
  onSend: (text: string) => Promise<void>;
  onSendVoice?: (blob: Blob, durationMs: number, waveform: number[], mime: string) => Promise<void>;
  onSendFile?: (file: File, caption: string) => Promise<void>;
  onOpenCircle?: () => void;
  replyTo?: ChatMessage | null;
  editing?: ChatMessage | null;
  onCancelMode?: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { onInput, stop } = useChatTyping(conversationId);
  const recorder = useVoiceRecorder();

  useEffect(() => {
    setText('');
    setPendingFile(null);
    setError(null);
    ref.current?.focus();
  }, [conversationId]);

  // Object-URL preview for a pending image attachment (revoked on change/unmount).
  useEffect(() => {
    if (pendingFile && pendingFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(pendingFile);
      setThumbUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setThumbUrl(null);
    return undefined;
  }, [pendingFile]);

  const pickFile = () => {
    setError(null);
    fileRef.current?.click();
  };
  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = ''; // allow re-picking the same file
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(`“${f.name}” is too large — max ${MAX_UPLOAD_LABEL}.`);
      return;
    }
    setError(null);
    setPendingFile(f);
    ref.current?.focus();
  };

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
    if (sending) return;
    if (pendingFile && onSendFile) {
      setSending(true);
      stop();
      try {
        await onSendFile(pendingFile, value);
        setPendingFile(null);
        setText('');
        setError(null);
        ref.current?.focus();
      } catch {
        setError('Upload failed — please try again.');
      } finally {
        setSending(false);
      }
      return;
    }
    if (!value) return;
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
    } else if (e.key === 'Escape' && pendingFile) {
      e.preventDefault();
      setPendingFile(null);
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
  const hasContent = text.trim().length > 0 || pendingFile != null;

  if (recorder.recording) {
    return (
      <div className="composer-wrap">
        <div className="composer composer--rec">
          <button className="composer__icon composer__icon--danger" onClick={() => recorder.cancel()} aria-label="Cancel recording" type="button">
            <Trash2 size={20} aria-hidden />
          </button>
          <div className="rec">
            <span className="rec__dot" aria-hidden />
            <span className="rec__time">{fmt(recorder.durationMs)}</span>
            <span className="rec__hint muted">Recording…</span>
          </div>
          <button className="composer__send" onClick={() => void finishVoice()} aria-label="Send voice message" type="button">
            <Send size={20} aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="composer-wrap">
      {mode && (
        <div className="composer-bar">
          <span className="composer-bar__icon" aria-hidden>{mode === 'edit' ? <Pencil size={18} /> : <Reply size={18} />}</span>
          <div className="composer-bar__body">
            <span className="composer-bar__title">{mode === 'edit' ? 'Edit message' : 'Reply'}</span>
            <span className="composer-bar__preview">{(editing ?? replyTo)?.body ?? ''}</span>
          </div>
          <button className="composer-bar__close" onClick={() => { setText(''); onCancelMode?.(); }} aria-label="Cancel" type="button"><X size={18} aria-hidden /></button>
        </div>
      )}
      {pendingFile && (
        <div className="composer-bar composer-bar--attach">
          <span className="composer-bar__thumb" aria-hidden>
            {thumbUrl ? <img src={thumbUrl} alt="" /> : <FileText size={20} />}
          </span>
          <div className="composer-bar__body">
            <span className="composer-bar__title">{pendingFile.name}</span>
            <span className="composer-bar__preview">{formatBytes(pendingFile.size)}</span>
          </div>
          <button className="composer-bar__close" onClick={() => setPendingFile(null)} aria-label="Remove attachment" type="button"><X size={18} aria-hidden /></button>
        </div>
      )}
      {error && <div className="composer-error" role="alert">{error}</div>}
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={onFilePicked}
        aria-hidden
        tabIndex={-1}
      />
      <div className="composer">
        <button className="composer__icon" onClick={pickFile} aria-label="Attach file" type="button" disabled={sending || !onSendFile || !!editing}>
          <Paperclip size={20} aria-hidden />
        </button>
        <textarea
          ref={ref}
          className="composer__input"
          data-chat-composer-input
          rows={1}
          value={text}
          placeholder={pendingFile ? 'Add a caption…' : 'Message'}
          aria-label="Message"
          disabled={sending}
          onChange={(e) => {
            setText(e.target.value);
            onInput();
          }}
          onKeyDown={onKeyDown}
          onBlur={stop}
        />
        {hasContent ? (
          <button className="composer__send" onClick={() => void submit()} disabled={sending} aria-label={mode === 'edit' ? 'Save edit' : 'Send message'}>
            {mode === 'edit' ? <Check size={20} aria-hidden /> : <Send size={20} aria-hidden />}
          </button>
        ) : (
          <>
            {onOpenCircle && (
              <button className="composer__icon" onClick={onOpenCircle} aria-label="Record video note" type="button">
                <Video size={20} aria-hidden />
              </button>
            )}
            <button
              className="composer__send"
              onClick={() => void recorder.start()}
              aria-label="Record voice message"
              type="button"
              disabled={!onSendVoice}
            >
              <Mic size={20} aria-hidden />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
