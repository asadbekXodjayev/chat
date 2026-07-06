import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@chat/contract';
import {
  upsertMessage,
  stampDelivered,
  stampReadByPeer,
  stampDeleted,
  flattenSortedMessages,
  type MessagesInfinite,
} from '../lib/messageCache';

function msg(id: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    conversation_id: 'c1',
    sender_id: 'me',
    type: 'text',
    body: `m${id}`,
    payload: null,
    created_at: `2026-07-05T10:00:0${id}.000000000Z`,
    updated_at: `2026-07-05T10:00:0${id}.000000000Z`,
    deleted_at: null,
    delivered_at: null,
    read_by_me: true,
    read_by_peer: false,
    ...over,
  };
}

const seed = (): MessagesInfinite => ({ pages: [{ items: [msg('1'), msg('2')], cursor: null }], pageParams: [undefined] });

describe('WS cache patches (§14.3)', () => {
  it('upsert appends a new message and replaces an existing one', () => {
    const added = upsertMessage(seed(), msg('3'));
    expect(flattenSortedMessages(added).map((m) => m.id)).toEqual(['1', '2', '3']);

    const replaced = upsertMessage(seed(), msg('2', { body: 'edited' }));
    expect(flattenSortedMessages(replaced).find((m) => m.id === '2')?.body).toBe('edited');
    expect(flattenSortedMessages(replaced)).toHaveLength(2); // no dupe
  });

  it('stampDelivered sets delivered_at only on matching ids', () => {
    const out = stampDelivered(seed(), ['2'], '2026-07-05T10:00:05.000000000Z');
    const flat = flattenSortedMessages(out);
    expect(flat.find((m) => m.id === '1')?.delivered_at).toBeNull();
    expect(flat.find((m) => m.id === '2')?.delivered_at).toBe('2026-07-05T10:00:05.000000000Z');
  });

  it('stampReadByPeer flips read_by_peer on my sent messages', () => {
    const out = stampReadByPeer(seed(), 'me');
    expect(flattenSortedMessages(out).every((m) => m.read_by_peer)).toBe(true);
  });

  it('stampDeleted tombstones a message', () => {
    const out = stampDeleted(seed(), '1', '2026-07-05T10:00:09.000000000Z');
    const m1 = flattenSortedMessages(out).find((m) => m.id === '1');
    expect(m1?.deleted_at).toBeTruthy();
    expect(m1?.body).toBeNull();
  });

  it('flatten dedups across pages and sorts ascending by created_at', () => {
    const data: MessagesInfinite = {
      pages: [
        { items: [msg('2'), msg('3')], cursor: null },
        { items: [msg('1'), msg('2')], cursor: null }, // overlap on id 2
      ],
      pageParams: [undefined, 'c'],
    };
    expect(flattenSortedMessages(data).map((m) => m.id)).toEqual(['1', '2', '3']);
  });
});
