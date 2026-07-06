// §6.8
export type CallStatus =
  | 'RINGING'
  | 'ACTIVE'
  | 'ENDED'
  | 'DECLINED'
  | 'MISSED'
  | 'CANCELLED'
  | 'FAILED';

export type CallType = 'audio' | 'video' | 'screen';

export interface Call {
  id: string;
  conversation_id: string | null;
  caller_id: string;
  callee_id: string;
  status: CallStatus;
  call_type?: CallType | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
  ended_reason: string | null;
  client_request_id: string | null; // idempotency key
}

export interface CallIceServer {
  urls?: string | string[];
  username?: string | null;
  credential?: string | null;
}

// §8.2 request bodies
export interface CallCreateRequest {
  peer_id: string;
  conversation_id?: string | null;
  client_request_id?: string | null;
  call_type?: CallType | null;
}

export interface CallEndRequest {
  reason?: string;
}
export interface CallDeclineRequest {
  reason?: string;
}
