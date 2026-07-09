import { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useCallStore } from '../stores/useCallStore';
import { CallController } from '../lib/callController';
import { Avatar } from './Avatar';

export function CallModal() {
  const s = useCallStore();
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = s.localStream;
  }, [s.localStream]);
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = s.remoteStream;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = s.remoteStream;
  }, [s.remoteStream]);

  if (s.phase === 'idle') return null;
  const isVideo = s.callType === 'video';
  const title = s.peerName || s.peerPhone || 'Call';
  const status =
    s.errorMsg ??
    (s.phase === 'outgoing'
      ? 'Ringing…'
      : s.phase === 'incoming'
        ? isVideo
          ? 'Incoming video call'
          : 'Incoming call'
        : s.phase === 'connecting'
          ? 'Connecting…'
          : s.phase === 'connected'
            ? 'Connected'
            : 'Call ended');

  return (
    <div className="call" role="dialog" aria-modal="true" aria-label="Call">
      {isVideo && s.remoteStream && <video ref={remoteVideoRef} className="call__remote" autoPlay playsInline muted />}
      <audio ref={remoteAudioRef} autoPlay />

      <div className="call__center">
        {(!isVideo || !s.remoteStream) && <Avatar name={s.peerName} phone={s.peerPhone} size={116} />}
        <h2 className="call__name">{title}</h2>
        <p className="call__status">{status}</p>
      </div>

      {isVideo && s.localStream && <video ref={localRef} className="call__local" autoPlay playsInline muted />}

      <div className="call__controls">
        {s.phase === 'incoming' ? (
          <>
            <button className="call__btn call__btn--decline" onClick={() => void CallController.decline()} type="button" aria-label="Decline">
              <PhoneOff size={26} aria-hidden />
            </button>
            <button className="call__btn call__btn--accept" onClick={() => void CallController.accept()} type="button" aria-label="Accept">
              <Phone size={26} aria-hidden />
            </button>
          </>
        ) : (
          <>
            <button className={`call__btn${s.muted ? ' is-on' : ''}`} onClick={() => CallController.toggleMute()} type="button" aria-pressed={s.muted} aria-label="Toggle mute">
              {s.muted ? <MicOff size={24} aria-hidden /> : <Mic size={24} aria-hidden />}
            </button>
            {isVideo && (
              <button className={`call__btn${s.cameraOff ? ' is-on' : ''}`} onClick={() => CallController.toggleCamera()} type="button" aria-pressed={s.cameraOff} aria-label="Toggle camera">
                {s.cameraOff ? <VideoOff size={24} aria-hidden /> : <Video size={24} aria-hidden />}
              </button>
            )}
            <button className="call__btn call__btn--decline" onClick={() => void CallController.hangup()} type="button" aria-label="Hang up">
              <PhoneOff size={26} aria-hidden />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
