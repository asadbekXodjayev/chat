import { createHmac } from 'node:crypto';
import type { Call, CallCreateRequest, CallIceServer, CallStatus, CallType } from '@chat/contract';
import { query } from '../db/pool';
import { env } from '../config/env';
import { toRfc3339Nano } from '../lib/time';
import { ApiError } from '../lib/envelope';
import { publishToUser } from '../ws/bus';
import { ConversationService } from './conversations';

export interface CallRow {
  id: string;
  conversation_id: string | null;
  caller_id: string;
  callee_id: string;
  status: CallStatus;
  call_type: CallType | null;
  created_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  ended_by: string | null;
  ended_reason: string | null;
  client_request_id: string | null;
}

const RINGING_TIMEOUT_MS = 30_000; // §3.3 / §5.6 — RINGING > 30s → MISSED.

function mapCallRow(row: CallRow): Call {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    caller_id: row.caller_id,
    callee_id: row.callee_id,
    status: row.status,
    call_type: row.call_type,
    created_at: toRfc3339Nano(row.created_at),
    started_at: row.started_at ? toRfc3339Nano(row.started_at) : null,
    ended_at: row.ended_at ? toRfc3339Nano(row.ended_at) : null,
    ended_by: row.ended_by,
    ended_reason: row.ended_reason,
    client_request_id: row.client_request_id,
  };
}

const ACTIVE_STATES: CallStatus[] = ['RINGING', 'ACTIVE'];

export const CallService = {
  mapCallRow,

  async getById(id: string): Promise<CallRow | null> {
    const r = await query<CallRow>('SELECT * FROM calls WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  },

  isParty(call: CallRow, userId: string): boolean {
    return call.caller_id === userId || call.callee_id === userId;
  },

  async userBusy(userId: string): Promise<boolean> {
    const r = await query(
      `SELECT 1 FROM calls WHERE status = ANY($2) AND (caller_id = $1 OR callee_id = $1) LIMIT 1`,
      [userId, ACTIVE_STATES],
    );
    return r.rows.length > 0;
  },

  // §8.2 #2 — idempotent create by client_request_id, busy checks, broadcast call.invite.
  async create(callerId: string, req: CallCreateRequest, callerName: string | null, callerPhone: string): Promise<Call> {
    if (req.client_request_id) {
      const existing = await query<CallRow>('SELECT * FROM calls WHERE client_request_id = $1', [req.client_request_id]);
      if (existing.rows[0]) return mapCallRow(existing.rows[0]);
    }
    if (await this.userBusy(callerId)) throw new ApiError(409, 'call_user_busy');
    if (await this.userBusy(req.peer_id)) throw new ApiError(409, 'call_peer_busy');

    const conv = await ConversationService.getOrCreate(callerId, req.peer_id);
    const inserted = await query<CallRow>(
      `INSERT INTO calls (conversation_id, caller_id, callee_id, status, call_type, client_request_id)
       VALUES ($1, $2, $3, 'RINGING', $4, $5) RETURNING *`,
      [conv.id, callerId, req.peer_id, req.call_type ?? 'audio', req.client_request_id ?? null],
    );
    const row = inserted.rows[0]!;
    await publishToUser(req.peer_id, {
      type: 'call.invite',
      data: {
        call: mapCallRow(row),
        caller_name: callerName,
        caller_phone: callerPhone,
        call_type: row.call_type,
      },
    });
    return mapCallRow(row);
  },

  async accept(call: CallRow): Promise<Call> {
    if (call.status !== 'RINGING') throw new ApiError(409, 'call_invalid_state');
    const r = await query<CallRow>(
      `UPDATE calls SET status = 'ACTIVE', started_at = now() WHERE id = $1 RETURNING *`,
      [call.id],
    );
    const row = r.rows[0]!;
    const frame = { type: 'call.accepted', data: { call: mapCallRow(row) } };
    await Promise.all([publishToUser(row.caller_id, frame), publishToUser(row.callee_id, frame)]);
    return mapCallRow(row);
  },

  async terminate(
    call: CallRow,
    byUserId: string,
    status: Extract<CallStatus, 'DECLINED' | 'CANCELLED' | 'ENDED' | 'MISSED' | 'FAILED'>,
    reason: string | null,
    wireType: string,
  ): Promise<Call> {
    const r = await query<CallRow>(
      `UPDATE calls SET status = $2, ended_at = now(), ended_by = $3, ended_reason = $4 WHERE id = $1 RETURNING *`,
      [call.id, status, byUserId, reason],
    );
    const row = r.rows[0]!;
    const frame = { type: wireType, event_type: wireType, data: { call: mapCallRow(row) } };
    await Promise.all([publishToUser(row.caller_id, frame), publishToUser(row.callee_id, frame)]);
    return mapCallRow(row);
  },

  async history(userId: string, limit: number): Promise<Call[]> {
    const r = await query<CallRow>(
      `SELECT * FROM calls WHERE caller_id = $1 OR callee_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 100)],
    );
    return r.rows.map(mapCallRow);
  },

  // §5.6 — sweep stuck RINGING calls to MISSED and notify both parties.
  async sweepRinging(): Promise<void> {
    const cutoff = new Date(Date.now() - RINGING_TIMEOUT_MS);
    const r = await query<CallRow>(
      `UPDATE calls SET status = 'MISSED', ended_at = now(), ended_reason = 'timeout'
       WHERE status = 'RINGING' AND created_at < $1 RETURNING *`,
      [cutoff],
    );
    for (const row of r.rows) {
      const frame = { type: 'call.missed.system', event_type: 'call.missed.system', data: { call: mapCallRow(row) } };
      await Promise.all([publishToUser(row.caller_id, frame), publishToUser(row.callee_id, frame)]);
    }
  },

  // §11.2 / §11.7 — ICE config. Prefers a hosted TURN provider (Metered → Twilio) so calls
  // traverse symmetric NAT; falls back to the static CALLS_ICE_URLS + HMAC-TURN config, then STUN.
  async iceServers(): Promise<CallIceServer[]> {
    const now = Date.now();
    if (iceCache && iceCache.expires > now) return iceCache.servers;

    let servers: CallIceServer[] | null = null;
    try {
      if (env.callsMeteredDomain && env.callsMeteredApiKey) servers = await fetchMeteredServers();
      else if (env.callsTwilioSid && env.callsTwilioToken) servers = await fetchTwilioServers();
    } catch {
      servers = null; // provider hiccup → fall back rather than fail the call
    }
    if (!servers || servers.length === 0) servers = staticIceServers();

    iceCache = { servers, expires: now + 5 * 60_000 }; // provider creds are long-lived; 5-min cache
    return servers;
  },
};

// ---- ICE server resolution ----

let iceCache: { servers: CallIceServer[]; expires: number } | null = null;

// Static ICE from CALLS_ICE_URLS (+ optional HMAC-signed TURN); STUN-only as the last resort.
function staticIceServers(): CallIceServer[] {
  const stun = env.callsIceUrls.filter((u) => u.startsWith('stun:'));
  const turn = env.callsIceUrls.filter((u) => u.startsWith('turn:') || u.startsWith('turns:'));
  const servers: CallIceServer[] = [];
  if (stun.length) servers.push({ urls: stun });
  if (turn.length) {
    if (env.callsTurnSecret) {
      const username = String(Math.floor(Date.now() / 1000) + 3600);
      const credential = createHmac('sha1', env.callsTurnSecret).update(username).digest('base64');
      servers.push({ urls: turn, username, credential });
    } else {
      servers.push({ urls: turn });
    }
  }
  if (servers.length === 0) servers.push({ urls: ['stun:stun.l.google.com:19302'] });
  return servers;
}

// Metered: GET /api/v1/turn/credentials → array of RTCIceServer-shaped objects.
async function fetchMeteredServers(): Promise<CallIceServer[] | null> {
  const url = `https://${env.callsMeteredDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(env.callsMeteredApiKey)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as CallIceServer[]) : null;
}

// Twilio Network Traversal Service: POST /Tokens.json → { ice_servers: [{ urls|url, username, credential }] }.
async function fetchTwilioServers(): Promise<CallIceServer[] | null> {
  const auth = Buffer.from(`${env.callsTwilioSid}:${env.callsTwilioToken}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.callsTwilioSid}/Tokens.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { ice_servers?: { url?: string; urls?: string; username?: string; credential?: string }[] };
  const servers: CallIceServer[] = [];
  for (const s of data.ice_servers ?? []) {
    const urls = s.urls ?? s.url;
    if (!urls) continue;
    servers.push({ urls, username: s.username ?? null, credential: s.credential ?? null });
  }
  return servers;
}
