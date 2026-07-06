import {
  chatEndpoints,
  type ChatConversation,
  type ChatMessage,
  type ChatPresence,
  type ChatUserFinderItem,
  type ChatParticipant,
} from '@chat/contract';
import { apiRequest } from '../lib/apiClient';
import { setSession, type TokenPair } from '../lib/session';

// ---- Dev auth (stubbed IdP, see backend routes/auth.ts) ----
export async function devLogin(phone: string, name?: string): Promise<ChatParticipant> {
  const data = await apiRequest<{ user: ChatParticipant; token: TokenPair }>('/v1/auth/dev-login', {
    method: 'POST',
    body: { phone, name },
  });
  setSession(data.user, data.token);
  return data.user;
}

const v1 = (p: string) => `/v1${p}`;

// ---- Chat (§8.1) ----
export function listConversations(limit = 100): Promise<{ items?: ChatConversation[] }> {
  return apiRequest(v1(chatEndpoints.conversations(limit)));
}
export function getOrCreateConversation(peerId: string): Promise<ChatConversation> {
  return apiRequest(v1(chatEndpoints.createConversation()), { method: 'POST', body: { peer_id: peerId } });
}
export function markConversationRead(conversationId: string): Promise<{ ok: boolean }> {
  return apiRequest(v1(chatEndpoints.markRead(conversationId)), { method: 'POST', body: {} });
}
export function getMessages(
  conversationId: string,
  opts: { limit?: number; cursor?: string; markRead?: boolean } = {},
): Promise<{ items: ChatMessage[]; cursor: string | null }> {
  return apiRequest<{ items?: ChatMessage[]; cursor?: string | null }>(
    v1(chatEndpoints.messages(conversationId, opts)),
  ).then((d) => ({ items: d.items ?? [], cursor: d.cursor ?? null }));
}
export function sendText(
  conversationId: string,
  body: string,
  clientRequestId?: string,
  replyToMessageId?: string,
): Promise<ChatMessage> {
  return apiRequest(v1(chatEndpoints.sendMessage(conversationId)), {
    method: 'POST',
    body: { body, client_request_id: clientRequestId, reply_to_message_id: replyToMessageId },
  });
}
export function pinMessage(messageId: string): Promise<ChatMessage> {
  return apiRequest(v1(chatEndpoints.pinMessage(messageId)), { method: 'POST' });
}
export function editMessage(messageId: string, body: string): Promise<ChatMessage> {
  return apiRequest(v1(chatEndpoints.editMessage(messageId)), { method: 'PATCH', body: { body } });
}
export function deleteMessage(messageId: string): Promise<{ deleted: boolean }> {
  return apiRequest(v1(chatEndpoints.deleteMessage(messageId)), { method: 'DELETE' });
}
export function toggleReaction(messageId: string, r: { emoji?: string; text?: string }): Promise<ChatMessage> {
  return apiRequest(v1(chatEndpoints.reactions(messageId)), { method: 'PUT', body: r });
}
export function removeReaction(messageId: string, key: string): Promise<ChatMessage> {
  return apiRequest(v1(chatEndpoints.reaction(messageId, key)), { method: 'DELETE' });
}
export function userFinder(phone: string, limit = 10): Promise<{ items?: ChatUserFinderItem[] }> {
  return apiRequest(v1(chatEndpoints.userFinder(phone, limit)));
}
export function getPresence(userId: string, conversationId?: string): Promise<ChatPresence> {
  return apiRequest(v1(chatEndpoints.presence(userId, conversationId)));
}
