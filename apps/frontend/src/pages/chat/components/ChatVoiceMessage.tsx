import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Play, Pause } from 'lucide-react';
import type { ChatMediaPayload, ChatMessage } from '@chat/contract';
import { apiFetchBlob } from '../../../lib/apiClient';

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function fallbackBars(seed: string, n: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    out.push(0.2 + ((h % 1000) / 1000) * 0.8);
  }
  return out;
}

export function ChatVoiceMessage({ message, own }: { message: ChatMessage; own: boolean }) {
  const payload = (message.payload ?? {}) as ChatMediaPayload;
  const media = payload.links?.media ?? undefined;
  const durationMs = payload.duration_ms ?? 0;
  const bars = payload.waveform && payload.waveform.length ? payload.waveform : fallbackBars(message.id, 40);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!media) return;
    let obj: string | null = null;
    let alive = true;
    apiFetchBlob(media)
      .then((b) => {
        if (!alive) return;
        obj = URL.createObjectURL(b);
        setUrl(obj);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [media]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.pause();
    else void a.play();
  };
  const seek = (e: MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration;
  };

  return (
    <div className={`voice ${own ? 'voice--own' : ''}`}>
      <button className="voice__play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play voice message'} type="button" disabled={!url}>
        {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
      </button>
      <div className="voice__wave" onClick={seek} role="slider" aria-label="Seek" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} tabIndex={0}>
        {bars.map((h, i) => (
          <span key={i} className={`voice__bar${i / bars.length < progress ? ' is-played' : ''}`} style={{ height: `${18 + h * 82}%` }} />
        ))}
      </div>
      <span className="voice__time">{fmt(progress > 0 ? progress * durationMs : durationMs)}</span>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            if (a.duration) setProgress(a.currentTime / a.duration);
          }}
        />
      )}
    </div>
  );
}
