import { useEffect, useRef } from 'react';
import { useChatRealtimeStore, type ChatToast } from '../stores/useChatRealtimeStore';

export function Toasts({ onOpen }: { onOpen: (conversationId: string) => void }) {
  const toasts = useChatRealtimeStore((s) => s.toasts);
  const dismiss = useChatRealtimeStore((s) => s.dismissToast);
  const visible = toasts.slice(0, 3);
  const overflow = toasts.length - visible.length;

  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {visible.map((t) => (
        <ToastCard key={t.id} toast={t} onOpen={onOpen} onDismiss={dismiss} />
      ))}
      {overflow > 0 && <div className="toast toast--more">+{overflow} more</div>}
    </div>
  );
}

function ToastCard({
  toast,
  onOpen,
  onDismiss,
}: {
  toast: ChatToast;
  onOpen: (conversationId: string) => void;
  onDismiss: (id: string) => void;
}) {
  const timer = useRef<number | null>(null);
  const arm = () => {
    timer.current = window.setTimeout(() => onDismiss(toast.id), 5000);
  };
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
  };
  useEffect(() => {
    arm();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="toast" onMouseEnter={clear} onMouseLeave={arm}>
      <button
        className="toast__main"
        type="button"
        onClick={() => {
          onOpen(toast.conversationId);
          onDismiss(toast.id);
        }}
      >
        <span className="toast__title">{toast.title}</span>
        <span className="toast__body">{toast.body}</span>
      </button>
      <button className="toast__close" type="button" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
        ×
      </button>
    </div>
  );
}
