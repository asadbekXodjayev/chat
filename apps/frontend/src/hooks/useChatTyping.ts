import { useCallback, useEffect, useRef } from 'react';
import { WS_TIMERS } from '@chat/contract';
import { sendWsFrame } from '../lib/socketBus';

// §10.3 — outbound typing: throttle to 1 frame / 2.8s while typing; idle 5s → typing_stop;
// also stop on blur/send/switch/unmount.
export function useChatTyping(conversationId: string | null) {
  const lastSentRef = useRef(0);
  const idleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    lastSentRef.current = 0;
    if (conversationId) sendWsFrame({ type: 'typing_stop', data: { conversation_id: conversationId } });
  }, [conversationId]);

  const onInput = useCallback(() => {
    if (!conversationId) return;
    const now = Date.now();
    if (now - lastSentRef.current >= WS_TIMERS.typingThrottleMs) {
      lastSentRef.current = now;
      sendWsFrame({ type: 'typing', data: { conversation_id: conversationId } });
    }
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(stop, WS_TIMERS.typingIdleStopMs);
  }, [conversationId, stop]);

  // Stop typing when the conversation changes or the component unmounts.
  useEffect(() => stop, [conversationId, stop]);

  return { onInput, stop };
}
