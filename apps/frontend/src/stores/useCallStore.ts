import { create } from 'zustand';
import type { Call, CallType } from '@chat/contract';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'ended';

export interface CallState {
  phase: CallPhase;
  call: Call | null;
  callType: CallType;
  muted: boolean;
  cameraOff: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  peerName: string | null;
  peerPhone: string | null;
  errorMsg: string | null;
  set: (p: Partial<CallState>) => void;
  reset: () => void;
}

const initial = {
  phase: 'idle' as CallPhase,
  call: null,
  callType: 'audio' as CallType,
  muted: false,
  cameraOff: false,
  localStream: null,
  remoteStream: null,
  peerName: null,
  peerPhone: null,
  errorMsg: null,
};

export const useCallStore = create<CallState>((set) => ({
  ...initial,
  set: (p) => set(p),
  reset: () => set({ ...initial }),
}));
