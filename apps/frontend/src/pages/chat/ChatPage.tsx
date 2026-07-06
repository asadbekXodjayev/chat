import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ChatParticipant } from '@chat/contract';
import { useChatWebSocket } from '../../hooks/useChatWebSocket';
import { useConversationsQuery, useMessagesQuery } from '../../hooks/useChatQueries';
import { useChatRealtimeStore } from '../../stores/useChatRealtimeStore';
import { sendText, getOrCreateConversation } from '../../api/chat';
import { upsertMessage, flattenSortedMessages, type MessagesInfinite } from '../../lib/messageCache';
import { clearSession } from '../../lib/session';
import { ChatSidebarPanel } from './components/ChatSidebarPanel';
import { ChatThreadPanel } from './components/ChatThreadPanel';
import { ChatComposerPanel } from './components/ChatComposerPanel';
import { AppDrawer } from '../../components/AppDrawer';
import { ProfilePage } from '../../components/ProfilePage';

export function ChatPage({ me: meInitial, onLogout }: { me: ChatParticipant; onLogout: () => void }) {
  useChatWebSocket(); // the single shared socket for this tab

  const [me, setMe] = useState(meInitial);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const qc = useQueryClient();
  const conversationsQuery = useConversationsQuery();
  const conversations = conversationsQuery.data ?? [];

  const activeConversationId = useChatRealtimeStore((s) => s.activeConversationId);
  const setActiveConversation = useChatRealtimeStore((s) => s.setActiveConversation);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );

  const messagesQuery = useMessagesQuery(activeConversationId);
  const messages = useMemo(
    () => flattenSortedMessages(messagesQuery.data as MessagesInfinite | undefined),
    [messagesQuery.data],
  );

  const openConversationWithPeer = async (peerId: string) => {
    const conv = await getOrCreateConversation(peerId);
    qc.setQueryData(queryKeys.conversations(), (old: typeof conversations | undefined) => {
      const list = old ?? [];
      return list.some((c) => c.id === conv.id) ? list : [conv, ...list];
    });
    setActiveConversation(conv.id);
  };

  const handleSend = async (text: string) => {
    if (!active) return;
    // Server notifies only the PEER over WS; the sender seeds its own cache from the POST response.
    const msg = await sendText(active.id, text, crypto.randomUUID());
    qc.setQueryData(queryKeys.messages(active.id), (old: MessagesInfinite | undefined) => upsertMessage(old, msg));
    void qc.invalidateQueries({ queryKey: queryKeys.conversations() });
  };

  const logout = () => {
    clearSession();
    onLogout();
  };

  return (
    <div className="app">
      <ChatSidebarPanel
        me={me}
        conversations={conversations}
        loading={conversationsQuery.isLoading}
        activeId={activeConversationId}
        onSelect={setActiveConversation}
        onOpenPeer={openConversationWithPeer}
        onBurger={() => setDrawerOpen(true)}
      />
      <AppDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        me={me}
        onOpenProfile={() => setProfileOpen(true)}
        onLogout={logout}
      />
      <ProfilePage open={profileOpen} onClose={() => setProfileOpen(false)} me={me} onUpdated={setMe} />
      <main className="main">
        {active ? (
          <>
            <ChatThreadPanel
              conversation={active}
              messages={messages}
              me={me}
              hasOlder={messagesQuery.hasNextPage ?? false}
              loadingOlder={messagesQuery.isFetchingNextPage}
              onLoadOlder={() => void messagesQuery.fetchNextPage()}
            />
            <ChatComposerPanel conversationId={active.id} onSend={handleSend} />
          </>
        ) : (
          <div className="empty">
            <div className="empty__art" aria-hidden>
              ✦
            </div>
            <h2>Select a chat</h2>
            <p>Search a phone number to start a new conversation, or pick one on the left.</p>
          </div>
        )}
      </main>
    </div>
  );
}
