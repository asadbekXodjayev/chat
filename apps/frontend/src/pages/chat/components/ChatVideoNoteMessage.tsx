import { useEffect, useRef, useState } from 'react';
import type { ChatMediaPayload, ChatMessage } from '@chat/contract';
import { apiFetchBlob } from '../../../lib/apiClient';

export function ChatVideoNoteMessage({ message }: { message: ChatMessage }) {
  const p = (message.payload ?? {}) as ChatMediaPayload;
  const media = p.links?.media ?? undefined;
  const [url, setUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let alive = true;
    const objs: string[] = [];
    if (media)
      apiFetchBlob(media)
        .then((b) => {
          if (!alive) return;
          const u = URL.createObjectURL(b);
          objs.push(u);
          setUrl(u);
        })
        .catch(() => undefined);
    const thumb = p.links?.thumb;
    if (thumb)
      apiFetchBlob(thumb)
        .then((b) => {
          if (!alive) return;
          const u = URL.createObjectURL(b);
          objs.push(u);
          setPosterUrl(u);
        })
        .catch(() => undefined);
    return () => {
      alive = false;
      objs.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [media, p.links?.thumb]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (playing) v.pause();
    else {
      v.muted = false;
      void v.play();
    }
  };

  return (
    <div className="vnbubble" onClick={toggle} title="Video note">
      {url ? (
        <video
          ref={ref}
          className="vnbubble__video"
          src={url}
          poster={posterUrl ?? undefined}
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      ) : (
        <div className="vnbubble__ph" aria-hidden />
      )}
      {!playing && <span className="vnbubble__play" aria-hidden>▶</span>}
    </div>
  );
}
