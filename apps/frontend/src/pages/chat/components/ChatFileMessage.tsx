import { useState } from 'react';
import { FileText, Download, Loader2 } from 'lucide-react';
import { formatBytes, type ChatMediaPayload, type ChatMessage } from '@chat/contract';
import { apiFetchBlob } from '../../../lib/apiClient';

/** Document / arbitrary-file bubble: a download card. Media is auth-gated → fetch blob then save. */
export function ChatFileMessage({ message }: { message: ChatMessage }) {
  const payload = (message.payload ?? {}) as ChatMediaPayload;
  const media = payload.links?.media ?? undefined;
  const name = payload.filename || payload.name || 'File';
  const size = payload.size_bytes ?? 0;
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (!media || busy) return;
    setBusy(true);
    try {
      const blob = await apiFetchBlob(media);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* global error path */
    } finally {
      setBusy(false);
    }
  };

  const caption = message.body?.trim();

  return (
    <div className="file-msg">
      <button className="file-card" type="button" onClick={() => void download()} disabled={busy} aria-label={`Download ${name}`}>
        <span className="file-card__icon" aria-hidden>
          {busy ? <Loader2 size={20} className="spin" /> : <FileText size={20} />}
        </span>
        <span className="file-card__body">
          <span className="file-card__name">{name}</span>
          <span className="file-card__meta">
            {size ? formatBytes(size) : null}
            <Download size={12} aria-hidden />
          </span>
        </span>
      </button>
      {caption && <span className="bubble__caption">{caption}</span>}
    </div>
  );
}
