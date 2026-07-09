import {
  WS_SIGNAL_OFFER,
  WS_SIGNAL_ANSWER,
  WS_SIGNAL_ICE,
  type CallIceServer,
  type CallType,
  type WsCallInviteData,
  type WsCallLifecycleData,
  type WsSignalData,
} from '@chat/contract';
import { sendWsFrame } from './socketBus';
import { onCallFrame, type CallFrame } from './callBus';
import { getIceServers, createCall, acceptCall, declineCall, cancelCall, endCall } from '../api/calls';
import { useCallStore } from '../stores/useCallStore';

/**
 * The single WebRTC call engine (§7.8). Caller is the offerer (impolite) and only offers AFTER
 * `call.accepted` — the callee only ever answers — which sidesteps glare without perfect-negotiation
 * complexity. ICE trickles both ways; candidates are buffered until the remote description is set.
 * Media is P2P; the server only relays SDP/ICE.
 */
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let pendingIce: RTCIceCandidateInit[] = [];
let currentCallId: string | null = null;
let isCaller = false;
let unsub: (() => void) | null = null;
let connectTimer: number | null = null;
let restarted = false; // caller has already spent its one ICE-restart attempt
let recovering = false; // an ICE failure is being handled — swallow duplicate failure events

const S = () => useCallStore.getState();
const CONNECT_TIMEOUT_MS = 35_000; // §7.8 — if ICE can't establish in time, surface a failure.

function clearConnectTimer(): void {
  if (connectTimer !== null) {
    window.clearTimeout(connectTimer);
    connectTimer = null;
  }
}

// Give ICE a bounded window to connect; otherwise the user is stuck on "Connecting…" forever.
function armConnectTimer(): void {
  clearConnectTimer();
  connectTimer = window.setTimeout(() => {
    if (S().phase !== 'connected') {
      S().set({ errorMsg: 'Could not connect — check your network or try again.' });
      teardown();
    }
  }, CONNECT_TIMEOUT_MS);
}

// ICE dropped. Re-entrant-safe: the caller re-offers with an ICE restart once, the callee waits for
// it, and both give the connection a bounded window to recover before tearing down. `recovering`
// swallows the duplicate 'failed' event that connectionState + iceConnectionState both emit.
function handleIceFailure(): void {
  if (recovering || !pc || S().phase === 'ended') return;
  recovering = true;
  S().set({ phase: 'connecting' }); // show "Connecting…" so the connect-timer guard is valid
  armConnectTimer(); // bounded recovery window → teardown if we don't reconnect
  if (isCaller && !restarted && currentCallId) {
    restarted = true;
    void (async () => {
      try {
        const offer = await pc!.createOffer({ iceRestart: true });
        await pc!.setLocalDescription(offer);
        sendWsFrame({ type: WS_SIGNAL_OFFER, data: { call_id: currentCallId!, payload: { type: offer.type, sdp: offer.sdp } } });
      } catch {
        S().set({ errorMsg: 'Connection lost.' });
        teardown();
      }
    })();
  }
  // Callee (or a caller out of restart attempts) simply waits out the connect timer.
}

async function iceServers(): Promise<RTCIceServer[]> {
  try {
    const r = await getIceServers();
    const list = (r.ice_servers ?? []) as CallIceServer[];
    return list.length ? (list as unknown as RTCIceServer[]) : [{ urls: 'stun:stun.l.google.com:19302' }];
  } catch {
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
}

async function setupPc(callType: CallType): Promise<void> {
  pc = new RTCPeerConnection({ iceServers: await iceServers() });
  pc.onicecandidate = (e) => {
    if (e.candidate && currentCallId) {
      sendWsFrame({ type: WS_SIGNAL_ICE, data: { call_id: currentCallId, payload: e.candidate.toJSON() } });
    }
  };
  pc.ontrack = (e) => {
    const stream = e.streams[0];
    if (stream) S().set({ remoteStream: stream });
  };
  pc.onconnectionstatechange = () => {
    const st = pc?.connectionState;
    if (st === 'connected') {
      clearConnectTimer();
      recovering = false;
      S().set({ phase: 'connected', errorMsg: null });
    } else if (st === 'failed') {
      handleIceFailure();
    }
  };
  pc.oniceconnectionstatechange = () => {
    const st = pc?.iceConnectionState;
    if (st === 'failed') handleIceFailure();
    else if (st === 'connected' || st === 'completed') recovering = false;
  };
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera & microphone need a secure (https) connection.');
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
  } catch (err) {
    const name = (err as DOMException)?.name;
    throw new Error(
      name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Camera/microphone permission denied.'
        : name === 'NotFoundError' || name === 'DevicesNotFoundError'
          ? 'No camera or microphone found.'
          : 'Could not access camera/microphone.',
    );
  }
  S().set({ localStream });
  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
}

function flushIce(): void {
  if (!pc) return;
  for (const c of pendingIce) void pc.addIceCandidate(c).catch(() => undefined);
  pendingIce = [];
}

function teardown(): void {
  if (pc) {
    pc.close();
    pc = null;
  }
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  pendingIce = [];
  currentCallId = null;
  isCaller = false;
  restarted = false;
  recovering = false;
  clearConnectTimer();
  S().set({ phase: 'ended', localStream: null, remoteStream: null });
  window.setTimeout(() => {
    if (S().phase === 'ended') S().reset();
  }, 1400);
}

async function handleFrame(f: CallFrame): Promise<void> {
  if (f.kind === 'call_invite') {
    const d = f.data as unknown as WsCallInviteData;
    if (S().phase !== 'idle') return; // busy: ignore (server also enforces one live call)
    currentCallId = d.call.id;
    isCaller = false;
    S().set({
      phase: 'incoming',
      call: d.call,
      callType: d.call_type ?? d.call.call_type ?? 'audio',
      peerName: d.caller_name ?? null,
      peerPhone: d.caller_phone ?? null,
    });
    return;
  }
  if (f.kind === 'call_accept') {
    const d = f.data as unknown as WsCallLifecycleData;
    if (d.call.id !== currentCallId) return;
    S().set({ phase: 'connecting', call: d.call });
    armConnectTimer();
    if (isCaller) {
      await setupPc(S().callType);
      const offer = await pc!.createOffer();
      await pc!.setLocalDescription(offer);
      sendWsFrame({ type: WS_SIGNAL_OFFER, data: { call_id: currentCallId!, payload: { type: offer.type, sdp: offer.sdp } } });
    }
    return;
  }
  if (f.kind === 'webrtc_offer') {
    const d = f.data as unknown as WsSignalData<RTCSessionDescriptionInit>;
    if (d.call_id !== currentCallId || !pc) return;
    await pc.setRemoteDescription(d.payload);
    flushIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendWsFrame({ type: WS_SIGNAL_ANSWER, data: { call_id: currentCallId, payload: { type: answer.type, sdp: answer.sdp } } });
    return;
  }
  if (f.kind === 'webrtc_answer') {
    const d = f.data as unknown as WsSignalData<RTCSessionDescriptionInit>;
    if (d.call_id !== currentCallId || !pc) return;
    await pc.setRemoteDescription(d.payload);
    flushIce();
    return;
  }
  if (f.kind === 'webrtc_ice') {
    const d = f.data as unknown as WsSignalData<RTCIceCandidateInit>;
    if (d.call_id !== currentCallId) return;
    if (pc && pc.remoteDescription) void pc.addIceCandidate(d.payload).catch(() => undefined);
    else pendingIce.push(d.payload);
    return;
  }
  if (f.kind === 'call_end') {
    const d = f.data as unknown as WsCallLifecycleData;
    if (d.call && d.call.id !== currentCallId) return;
    teardown();
  }
}

export const CallController = {
  init(): void {
    if (!unsub)
      unsub = onCallFrame(
        (f) =>
          void handleFrame(f).catch((e) => {
            S().set({ errorMsg: e instanceof Error ? e.message : 'Call error' });
            teardown();
          }),
      );
  },

  async startCall(peerId: string, peerName: string | null, peerPhone: string | null, callType: CallType): Promise<void> {
    if (S().phase !== 'idle') return;
    isCaller = true;
    S().set({ phase: 'outgoing', callType, peerName, peerPhone, call: null, errorMsg: null });
    try {
      const { call } = await createCall(peerId, callType, crypto.randomUUID());
      currentCallId = call.id;
      S().set({ call });
    } catch (e) {
      S().set({ errorMsg: e instanceof Error ? e.message : 'Call failed' });
      teardown();
    }
  },

  async accept(): Promise<void> {
    const call = S().call;
    if (!call) return;
    try {
      await setupPc(S().callType); // callee prepares its PC before the offer arrives
      await acceptCall(call.id);
      S().set({ phase: 'connecting', errorMsg: null });
    } catch (e) {
      S().set({ errorMsg: e instanceof Error ? e.message : 'Could not accept' });
      teardown();
    }
  },

  async decline(): Promise<void> {
    const call = S().call;
    if (call) await declineCall(call.id).catch(() => undefined);
    teardown();
  },

  async hangup(): Promise<void> {
    const call = S().call;
    const phase = S().phase;
    if (call) {
      if (phase === 'outgoing') await cancelCall(call.id).catch(() => undefined);
      else await endCall(call.id).catch(() => undefined);
    }
    teardown();
  },

  toggleMute(): void {
    const m = !S().muted;
    localStream?.getAudioTracks().forEach((t) => (t.enabled = !m));
    S().set({ muted: m });
  },

  toggleCamera(): void {
    const off = !S().cameraOff;
    localStream?.getVideoTracks().forEach((t) => (t.enabled = !off));
    S().set({ cameraOff: off });
  },
};
