import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVideoNoteRecorder } from '../../../hooks/useVideoNoteRecorder';

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const RING = 2 * Math.PI * 48; // circumference for r=48

export function ChatVideoNoteRecorder({
  onSend,
  onClose,
}: {
  onSend: (blob: Blob, poster: Blob | null, durationMs: number, size: number, mime: string) => Promise<void>;
  onClose: () => void;
}) {
  const rec = useVideoNoteRecorder();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    rec.start().then((stream) => {
      if (cancelled) return;
      if (!stream) {
        setError('Camera/microphone unavailable');
        return;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      }
    });
    return () => {
      cancelled = true;
      if (!finishedRef.current) rec.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capturePoster = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return resolve(null);
      const s = Math.min(v.videoWidth, v.videoHeight);
      const c = document.createElement('canvas');
      c.width = s;
      c.height = s;
      const ctx = c.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, s, s);
      c.toBlob((b) => resolve(b), 'image/jpeg', 0.8);
    });

  const finish = async () => {
    if (busy || finishedRef.current) return;
    finishedRef.current = true;
    setBusy(true);
    const poster = await capturePoster();
    const res = await rec.stop();
    if (res && res.durationMs > 800) {
      try {
        await onSend(res.blob, poster, res.durationMs, 480, res.mime);
      } catch {
        /* global error path */
      }
    }
    onClose();
  };

  // Auto-stop at 60s.
  useEffect(() => {
    if (rec.durationMs >= 60000 && rec.recording) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.durationMs]);

  const cancel = () => {
    finishedRef.current = true;
    rec.cancel();
    onClose();
  };

  return createPortal(
    <div className="vnote" role="dialog" aria-modal="true" aria-label="Record video note">
      <div className="vnote__stage">
        <video ref={videoRef} className="vnote__preview" muted playsInline />
        <svg className="vnote__ring" viewBox="0 0 100 100" aria-hidden>
          <circle className="vnote__ring-bg" cx="50" cy="50" r="48" />
          <circle
            className="vnote__ring-fg"
            cx="50"
            cy="50"
            r="48"
            style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - Math.min(rec.durationMs / 60000, 1)) }}
          />
        </svg>
      </div>
      {error ? <p className="vnote__err">{error}</p> : <span className="vnote__time">{fmt(rec.durationMs)}</span>}
      <div className="vnote__controls">
        <button className="btn" onClick={cancel} type="button">Cancel</button>
        <button className="vnote__stop" onClick={() => void finish()} disabled={busy || !!error} aria-label="Stop and send" type="button">
          ■
        </button>
      </div>
    </div>,
    document.body,
  );
}
