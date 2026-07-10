import { useEffect, useState, type CSSProperties } from 'react';
import { ImageOff } from 'lucide-react';
import type { ChatMediaPayload, ChatMessage } from '@chat/contract';
import { apiFetchBlob } from '../../../lib/apiClient';

/** Inline image bubble. Media is auth-gated, so we fetch the blob (not a raw <img src>). */
export function ChatImageMessage({ message }: { message: ChatMessage }) {
  const payload = (message.payload ?? {}) as ChatMediaPayload;
  const media = payload.links?.media ?? undefined;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!media) {
      setFailed(true);
      return;
    }
    let obj: string | null = null;
    let alive = true;
    apiFetchBlob(media)
      .then((b) => {
        if (!alive) return;
        obj = URL.createObjectURL(b);
        setUrl(obj);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [media]);

  // Reserve the right aspect ratio while loading to avoid layout jump.
  const ratioStyle: CSSProperties | undefined =
    payload.width && payload.height ? { aspectRatio: `${payload.width} / ${payload.height}` } : undefined;
  const caption = message.body?.trim();

  return (
    <div className="img-msg">
      {failed ? (
        <div className="img-msg__fail">
          <ImageOff size={18} aria-hidden /> Image unavailable
        </div>
      ) : url ? (
        <button className="img-msg__frame" type="button" onClick={() => setZoom(true)} aria-label="Open image">
          <img className="img-msg__img" src={url} alt={caption || 'Image'} loading="lazy" style={ratioStyle} />
        </button>
      ) : (
        <div className="img-msg__ph" style={ratioStyle} aria-hidden />
      )}
      {caption && <span className="bubble__caption">{caption}</span>}
      {zoom && url && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Image viewer" onClick={() => setZoom(false)}>
          <img className="lightbox__img" src={url} alt={caption || 'Image'} />
        </div>
      )}
    </div>
  );
}
