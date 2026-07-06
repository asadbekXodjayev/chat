// §6.2 — message type enum. Backend accepts BOTH lower_snake and legacy UPPERCASE
// aliases; the canonical internal set is the lowercase union below.
export const CHAT_MESSAGE_TYPES = [
  'text',
  'img',
  'audio',
  'video',
  'video_note',
  'location',
  'document',
  'call',
] as const;
export type ChatMessageType = (typeof CHAT_MESSAGE_TYPES)[number];

// Every alias the wire may carry → canonical. Covers lower_snake and UPPERCASE (§6.2)
// plus a few tolerant spellings (image/photo/voice/doc).
const ALIAS_TO_CANONICAL: Record<string, ChatMessageType> = {
  text: 'text',
  img: 'img',
  image: 'img',
  photo: 'img',
  audio: 'audio',
  voice: 'audio',
  video: 'video',
  video_note: 'video_note',
  videonote: 'video_note',
  circle: 'video_note',
  location: 'location',
  document: 'document',
  doc: 'document',
  call: 'call',
};

/** Normalize any wire `type` (lower_snake OR UPPERCASE alias) to the canonical enum. Defaults to `text`. */
export function normalizeChatMessageType(raw: string | null | undefined): ChatMessageType {
  if (!raw) return 'text';
  return ALIAS_TO_CANONICAL[raw.toLowerCase()] ?? 'text';
}

// §8.1 — the media upload `type` values accepted by POST .../messages/media and /media-ref.
// Note VOICE is a distinct upload type (file duplicated under a `voice` form field) whose
// stored message type normalizes to `audio`.
export const MEDIA_UPLOAD_TYPES = ['img', 'audio', 'video', 'video_note', 'document', 'VOICE', 'CIRCLE'] as const;
export type MediaUploadType = (typeof MEDIA_UPLOAD_TYPES)[number];

export function isVoiceUpload(type: string): boolean {
  return type.toUpperCase() === 'VOICE';
}
export function isCircleUpload(type: string): boolean {
  return type.toUpperCase() === 'CIRCLE';
}
