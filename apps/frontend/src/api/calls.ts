import { callEndpoints, type Call, type CallIceServer, type CallType } from '@chat/contract';
import { apiRequest } from '../lib/apiClient';

const v1 = (p: string) => `/v1${p}`;

export function getIceServers(): Promise<{ ice_servers: CallIceServer[] }> {
  return apiRequest(v1(callEndpoints.iceServers()));
}
export function createCall(peerId: string, callType: CallType, clientRequestId: string): Promise<{ call: Call }> {
  return apiRequest(v1(callEndpoints.create()), {
    method: 'POST',
    body: { peer_id: peerId, call_type: callType, client_request_id: clientRequestId },
  });
}
export function acceptCall(id: string): Promise<{ call: Call }> {
  return apiRequest(v1(callEndpoints.accept(id)), { method: 'POST', body: {} });
}
export function declineCall(id: string, reason?: string): Promise<{ call: Call }> {
  return apiRequest(v1(callEndpoints.decline(id)), { method: 'POST', body: { reason } });
}
export function cancelCall(id: string): Promise<{ call: Call }> {
  return apiRequest(v1(callEndpoints.cancel(id)), { method: 'POST', body: {} });
}
export function endCall(id: string, reason?: string): Promise<{ call: Call }> {
  return apiRequest(v1(callEndpoints.end(id)), { method: 'POST', body: { reason } });
}
