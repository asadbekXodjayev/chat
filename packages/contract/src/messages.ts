import type { ChatMessageType } from './messageType.js';

// §6.4 — media payload (image/video/audio/voice/video_note/document).
export interface ChatMediaPayload {
  attachment_id?: string; // → GET /v1/chat/media/:id
  link?: string | null; // relative API link
  url?: string | null;
  links?: { media?: string | null; thumb?: string | null } | null;
  thumb_url?: string | null;
  mime?: string;
  size_bytes?: number;
  duration_ms?: number | null; // audio/video/video_note
  width?: number | null;
  height?: number | null;
  filename?: string | null;
  name?: string | null;
}

// §6.5 — location payload (render-only in this app).
export interface ChatLocationPayload {
  lat: number;
  lng: number;
  address: string | null;
  place_id: string | null;
}

// §6.5 — in-thread call-event payload. `direction` is AUTHORITATIVE for bubble side (§11.10).
export interface ChatCallPayload {
  direction?: 'incoming' | 'outgoing' | null;
  status?: string | null;
  duration_seconds?: number | null;
  ended_reason?: string | null;
  ended_by_side?: string | null;
}

export type ChatMessagePayload = ChatMediaPayload | ChatLocationPayload | ChatCallPayload;

// §6.3 — the message row as it crosses the wire.
export interface ChatMessage {
  id: string; // uuid
  conversation_id: string; // uuid
  sender_id: string; // uuid
  type: ChatMessageType;
  body: string | null; // text OR media caption
  payload: ChatMessagePayload | null;
  created_at: string; // RFC3339Nano UTC
  updated_at: string; // == created_at unless edited
  deleted_at: string | null; // soft-delete tombstone
  delivered_at: string | null; // null until delivered to peer device
  read_by_me: boolean; // current user has read this (peer's) message
  read_by_peer: boolean; // peer has read this (my) message
  /** CLIENT-ONLY optimistic marker — never sent by the server. */
  optimistic?: { localUrl: string };
}

// ---- Request bodies (§8.1) ----
export interface SendTextRequest {
  body: string;
}
export interface SendMediaRefRequest {
  type: string; // MediaUploadType (server normalizes)
  sha256: string;
  filename?: string;
  body?: string;
}
export interface EditMessageRequest {
  body: string;
}
export interface FileProbeRequest {
  sha256: string;
}
export interface FileProbeResponse {
  exists: boolean;
  kind?: string;
  mime?: string;
  size_bytes?: number;
  duration_ms?: number | null;
  width?: number | null;
  height?: number | null;
  has_thumb?: boolean;
}
