import { Check, CheckCheck } from 'lucide-react';
import type { ChatMessage } from '@chat/contract';
import { formatMessageTime, getOwnMessageReadReceipt } from '../../../lib/format';

// §12.4 FR-26/FR-28 — timestamp, "edited" tag, and own-message delivery/read ticks.
export function MessageMeta({ message, own, isNewestOwn }: { message: ChatMessage; own: boolean; isNewestOwn: boolean }) {
  const edited = new Date(message.updated_at).getTime() - new Date(message.created_at).getTime() > 1000;
  const receipt = own ? getOwnMessageReadReceipt(message, isNewestOwn) : null;

  return (
    <span className="meta">
      {edited && <span className="meta__edited">edited</span>}
      <span className="meta__time">{formatMessageTime(message.created_at)}</span>
      {receipt && (
        <span
          className={`tick ${receipt === 'read' ? 'tick--read' : ''}`}
          title={receipt}
          aria-label={`message ${receipt}`}
        >
          {receipt === 'sent' ? <Check size={14} aria-hidden /> : <CheckCheck size={14} aria-hidden />}
        </span>
      )}
    </span>
  );
}
