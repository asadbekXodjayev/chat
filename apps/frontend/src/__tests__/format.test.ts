import { describe, it, expect } from 'vitest';
import type { ChatConversation, ChatMessage } from '@chat/contract';
import { getOwnMessageReadReceipt, conversationPreview } from '../lib/format';

const base: ChatMessage = {
  id: '1',
  conversation_id: 'c1',
  sender_id: 'me',
  type: 'text',
  body: 'hi',
  payload: null,
  created_at: '2026-07-05T10:00:00.000000000Z',
  updated_at: '2026-07-05T10:00:00.000000000Z',
  deleted_at: null,
  delivered_at: null,
  read_by_me: true,
  read_by_peer: false,
};

describe('own-message receipt (§12.4 FR-28)', () => {
  it('read_by_peer → read', () => {
    expect(getOwnMessageReadReceipt({ ...base, read_by_peer: true }, true)).toBe('read');
  });
  it('delivered_at (or not newest) → delivered', () => {
    expect(getOwnMessageReadReceipt({ ...base, delivered_at: '2026-07-05T10:00:01.000000000Z' }, true)).toBe('delivered');
    expect(getOwnMessageReadReceipt(base, false)).toBe('delivered'); // not newest
  });
  it('else newest undelivered → sent', () => {
    expect(getOwnMessageReadReceipt(base, true)).toBe('sent');
  });
});

describe('conversation preview (§12.1 FR-6)', () => {
  const conv = (over: Partial<ChatConversation>): ChatConversation => ({
    id: 'c1',
    peer_id: 'peer',
    peer: null,
    last_message: null,
    unread_count: 0,
    created_at: base.created_at,
    updated_at: base.created_at,
    ...over,
  });

  it('deleted last message shows tombstone', () => {
    expect(conversationPreview(conv({ last_message: { ...base, deleted_at: base.created_at } }), 'me')).toBe(
      'Message deleted',
    );
  });
  it('prefixes You: for own last message', () => {
    expect(conversationPreview(conv({ summary_preview: 'hello', summary_from_me: true }), 'me')).toBe('You: hello');
  });
  it('falls back to a type icon label', () => {
    expect(conversationPreview(conv({ summary_last_message_type: 'img', summary_from_me: false }), 'me')).toContain(
      'Photo',
    );
  });
});
