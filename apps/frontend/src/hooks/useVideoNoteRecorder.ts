import { useRef, useState } from 'react';

const V_MIME = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
function pickMime(): string {
  for (const m of V_MIME) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
  return '';
}

export interface CircleResult {
  blob: Blob;
  durationMs: number;
  mime: string;
}

/** Round video-note recorder: square getUserMedia + MediaRecorder. The overlay owns the preview + poster. */
export function useVideoNoteRecorder() {
  const [recording, setRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const resolveRef = useRef<((r: CircleResult | null) => void) | null>(null);

  const clearTick = () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
  };
  const stopTracks = () => streamRef.current?.getTracks().forEach((t) => t.stop());

  const start = async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 }, aspectRatio: 1 },
        audio: true,
      });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || 'video/webm';
        const blob = new Blob(chunksRef.current, { type });
        stopTracks();
        resolveRef.current?.({ blob, durationMs: Date.now() - startRef.current, mime: type });
        resolveRef.current = null;
      };
      recRef.current = rec;
      startRef.current = Date.now();
      rec.start();
      setRecording(true);
      setDurationMs(0);
      tickRef.current = window.setInterval(() => setDurationMs(Date.now() - startRef.current), 100);
      return stream;
    } catch {
      return null;
    }
  };

  const stop = (): Promise<CircleResult | null> =>
    new Promise((resolve) => {
      clearTick();
      setRecording(false);
      if (!recRef.current || recRef.current.state === 'inactive') {
        stopTracks();
        resolve(null);
        return;
      }
      resolveRef.current = resolve;
      recRef.current.stop();
    });

  const cancel = () => {
    clearTick();
    resolveRef.current = null;
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    stopTracks();
    setRecording(false);
  };

  return { recording, durationMs, start, stop, cancel };
}
