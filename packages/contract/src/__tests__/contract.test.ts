import { describe, it, expect } from 'vitest';
import {
  normalizeChatMessageType,
  wireTypeToKind,
  TYPING_STOP_WIRE_TYPES,
  resolveLanguage,
  chatEndpoints,
  callEndpoints,
  queryKeys,
  redisKeys,
  REDIS_PRESENCE_TTL_SECONDS,
  REDIS_TYPING_TTL_SECONDS,
} from '../index.js';

describe('message type normalizer (§6.2)', () => {
  it('maps UPPERCASE aliases to canonical', () => {
    expect(normalizeChatMessageType('PHOTO')).toBe('img');
    expect(normalizeChatMessageType('VOICE')).toBe('audio');
    expect(normalizeChatMessageType('AUDIO')).toBe('audio');
    expect(normalizeChatMessageType('VIDEO_NOTE')).toBe('video_note');
    expect(normalizeChatMessageType('DOCUMENT')).toBe('document');
  });
  it('passes canonical lower_snake through', () => {
    expect(normalizeChatMessageType('text')).toBe('text');
    expect(normalizeChatMessageType('video_note')).toBe('video_note');
  });
  it('defaults unknown/empty to text', () => {
    expect(normalizeChatMessageType(undefined)).toBe('text');
    expect(normalizeChatMessageType('weird')).toBe('text');
  });
});

describe('WS wire→kind map (§9.2 / §9.4)', () => {
  it('normalizes canonical + alias signaling names', () => {
    expect(wireTypeToKind('webrtc.offer')).toBe('webrtc_offer');
    expect(wireTypeToKind('webrtc.answer')).toBe('webrtc_answer');
    expect(wireTypeToKind('webrtc.ice')).toBe('webrtc_ice');
    expect(wireTypeToKind('webrtc.candidate')).toBe('webrtc_ice'); // inbound alias
    expect(wireTypeToKind('call.webrtc.offer')).toBe('webrtc_offer');
  });
  it('collapses message + call lifecycle variants', () => {
    expect(wireTypeToKind('message.new')).toBe('message');
    expect(wireTypeToKind('message.created')).toBe('message');
    expect(wireTypeToKind('call.invite')).toBe('call_invite');
    expect(wireTypeToKind('call.ended')).toBe('call_end');
    expect(wireTypeToKind('call.missed.system')).toBe('call_end');
  });
  it('flags typing stop variants and ignores unknowns', () => {
    expect(TYPING_STOP_WIRE_TYPES.has('typing_stop')).toBe(true);
    expect(TYPING_STOP_WIRE_TYPES.has('typing')).toBe(false);
    expect(wireTypeToKind('totally.unknown')).toBe('ignored');
  });
});

describe('language fallback (§7.1)', () => {
  it('keeps supported, maps extended, defaults', () => {
    expect(resolveLanguage('en')).toBe('en');
    expect(resolveLanguage('kk')).toBe('kk'); // supported code
    expect(resolveLanguage('de')).toBe('en'); // extended → en
    expect(resolveLanguage('pl')).toBe('en');
    expect(resolveLanguage(undefined)).toBe('ru');
    expect(resolveLanguage('en-US')).toBe('en');
  });
});

describe('endpoints + keys are stable', () => {
  it('builds message + presence paths', () => {
    expect(chatEndpoints.messages('c1', { limit: 50, markRead: true })).toBe(
      '/chat/conversations/c1/messages?limit=50&mark_read=1',
    );
    expect(chatEndpoints.presence('u1', 'c1')).toBe('/chat/presence/u1?conversation_id=c1');
    expect(callEndpoints.accept('call1')).toBe('/calls/call1/accept');
  });
  it('exposes normative Redis TTLs + keys (§10.1)', () => {
    expect(REDIS_PRESENCE_TTL_SECONDS).toBe(65);
    expect(REDIS_TYPING_TTL_SECONDS).toBe(15);
    expect(redisKeys.typing('c1', 'u1')).toBe('chat:typing:c1:u1');
    expect(queryKeys.messages('c1')).toEqual(['CHAT_MESSAGES', 'c1']);
  });
});
