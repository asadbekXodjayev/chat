import { create } from 'zustand';

// §14.1 — Zustand owns ephemeral realtime UI state only (durable data lives in the query cache).
interface ChatRealtimeState {
  activeConversationId: string | null;
  wsConnected: boolean;
  onlineUsers: Record<string, boolean>; // key = lowercased user id (§10.4)
  peerTyping: Record<string, boolean>; // key = conversationId

  setActiveConversation: (id: string | null) => void;
  setWsConnected: (connected: boolean) => void;
  setUserOnline: (userId: string, online: boolean) => void;
  setPeerTyping: (conversationId: string, typing: boolean) => void;
  isOnline: (userId: string) => boolean;
}

export const useChatRealtimeStore = create<ChatRealtimeState>((set, get) => ({
  activeConversationId: null,
  wsConnected: false,
  onlineUsers: {},
  peerTyping: {},

  setActiveConversation: (id) => set({ activeConversationId: id }),
  setWsConnected: (connected) => set({ wsConnected: connected }),
  setUserOnline: (userId, online) =>
    set((s) => ({ onlineUsers: { ...s.onlineUsers, [userId.toLowerCase()]: online } })),
  setPeerTyping: (conversationId, typing) =>
    set((s) => ({ peerTyping: { ...s.peerTyping, [conversationId]: typing } })),
  isOnline: (userId) => get().onlineUsers[userId.toLowerCase()] === true,
}));
