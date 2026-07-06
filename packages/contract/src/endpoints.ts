// §8 — REST paths. All under /v1. NEVER inline an endpoint string; import from here so FE and BE agree.
export const API_PREFIX = '/v1';

// §5.1 — Telegram-OTP auth.
export const authEndpoints = {
  requestCode: () => `/auth/request-code`,
  verifyCode: () => `/auth/verify-code`,
  register: () => `/auth/register`,
  refresh: () => `/auth/refresh`,
  logout: () => `/auth/logout`,
  logoutAll: () => `/auth/logout-all`,
} as const;

// §5.2 — profile.
export const userEndpoints = {
  me: () => `/users/me`,
  user: (id: string) => `/users/${id}`,
  usernameAvailable: (username: string) => `/users/username-available?username=${encodeURIComponent(username)}`,
  myPhoto: () => `/users/me/photo`,
  userPhoto: (id: string) => `/chat/users/${id}/photo`,
} as const;

export const chatEndpoints = {
  userFinder: (phone: string, limit = 10) =>
    `/chat/user-finder?phone=${encodeURIComponent(phone)}&limit=${limit}`,
  userPhoto: (userId: string) => `/chat/users/${userId}/photo`,

  conversations: (limit = 100) => `/chat/conversations?limit=${limit}`,
  createConversation: () => `/chat/conversations`,
  markRead: (conversationId: string) => `/chat/conversations/${conversationId}/read`,
  messages: (
    conversationId: string,
    opts: { limit?: number; markRead?: boolean; cursor?: string; before?: string } = {},
  ) => {
    const parts: string[] = [`limit=${opts.limit ?? 50}`];
    if (opts.markRead) parts.push('mark_read=1');
    if (opts.cursor) parts.push(`cursor=${encodeURIComponent(opts.cursor)}`);
    if (opts.before) parts.push(`before=${encodeURIComponent(opts.before)}`);
    return `/chat/conversations/${conversationId}/messages?${parts.join('&')}`;
  },
  sendMessage: (conversationId: string) => `/chat/conversations/${conversationId}/messages`,
  sendMedia: (conversationId: string) => `/chat/conversations/${conversationId}/messages/media`,
  sendMediaRef: (conversationId: string) => `/chat/conversations/${conversationId}/messages/media-ref`,
  fileProbe: () => `/chat/files/probe`,

  editMessage: (messageId: string) => `/chat/messages/${messageId}`,
  deleteMessage: (messageId: string) => `/chat/messages/${messageId}`,
  reactions: (messageId: string) => `/chat/messages/${messageId}/reactions`,
  reaction: (messageId: string, key: string) => `/chat/messages/${messageId}/reactions/${encodeURIComponent(key)}`,
  pinMessage: (messageId: string) => `/chat/messages/${messageId}/pin`,

  media: (attachmentId: string) => `/chat/media/${attachmentId}`,
  file: (fileId: string) => `/chat/files/${fileId}`, // legacy alias of media

  presence: (userId: string, conversationId?: string) =>
    `/chat/presence/${userId}${conversationId ? `?conversation_id=${conversationId}` : ''}`,

  pushToken: () => `/chat/push-token`,

  ws: () => `/chat/ws`, // upgraded; query params built by buildChatWebSocketUrl
} as const;

export const callEndpoints = {
  history: (limit = 50) => `/calls?limit=${limit}`,
  create: () => `/calls`,
  iceServers: () => `/calls/ice-servers`,
  get: (callId: string) => `/calls/${callId}`,
  accept: (callId: string) => `/calls/${callId}/accept`,
  decline: (callId: string) => `/calls/${callId}/decline`,
  cancel: (callId: string) => `/calls/${callId}/cancel`,
  end: (callId: string) => `/calls/${callId}/end`,
  testBootstrap: () => `/calls/test/bootstrap`,
} as const;

// §7.1 headers
export const HEADERS = {
  userToken: 'X-User-Token',
  clientToken: 'X-Client-Token',
  deviceType: 'X-Device-Type',
  language: 'X-Language',
  userId: 'X-User-ID',
} as const;
