import { useRef, useState } from 'react';

const MIME_PREF = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
function pickMime(): string {
  for (const m of MIME_PREF) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
  return '';
}

export interface VoiceResult {
  blob: Blob;
  durationMs: number;
  mime: string;
}

/** Compute ≤`bars` normalized amplitude peaks from an audio blob (for the waveform). */
export async function computeWaveform(blob: Blob, bars = 48): Promise<number[]> {
  try {
    const buf = await blob.arrayBuffer();
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const block = Math.floor(data.length / bars) || 1;
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      for (let j = 0; j < block; j++) {
        const v = Math.abs(data[i * block + j] ?? 0);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    void ctx.close();
    const norm = Math.max(...peaks, 0.01);
    return peaks.map((p) => Math.min(1, p / norm));
  } catch {
    return [];
  }
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const resolveRef = useRef<((r: VoiceResult | null) => void) | null>(null);

  const cleanupTick = () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
  };

  const start = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        stream.getTracks().forEach((t) => t.stop());
        resolveRef.current?.({ blob, durationMs: Date.now() - startRef.current, mime: type });
        resolveRef.current = null;
      };
      recRef.current = rec;
      startRef.current = Date.now();
      rec.start();
      setRecording(true);
      setDurationMs(0);
      tickRef.current = window.setInterval(() => setDurationMs(Date.now() - startRef.current), 100);
      return true;
    } catch {
      return false;
    }
  };

  const stop = (): Promise<VoiceResult | null> =>
    new Promise((resolve) => {
      cleanupTick();
      setRecording(false);
      if (!recRef.current || recRef.current.state === 'inactive') {
        resolve(null);
        return;
      }
      resolveRef.current = resolve;
      recRef.current.stop();
    });

  const cancel = () => {
    cleanupTick();
    resolveRef.current = null;
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
  };

  return { recording, durationMs, start, stop, cancel };
}
