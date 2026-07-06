import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys, type ChatConversation, type ChatParticipant } from '@chat/contract';
import { userFinder } from '../../../api/chat';
import { Avatar } from '../../../components/Avatar';
import { ConversationItem } from './ConversationItem';

interface Props {
  me: ChatParticipant;
  conversations: ChatConversation[];
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onOpenPeer: (peerId: string) => void;
  onLogout: () => void;
}

export function ChatSidebarPanel({ me, conversations, loading, activeId, onSelect, onOpenPeer, onLogout }: Props) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  // §12.1 FR-4 — 350ms debounce on global people search.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const searching = debounced.length >= 3;
  const finder = useQuery({
    queryKey: queryKeys.userFinder(debounced),
    queryFn: async () => (await userFinder(debounced)).items ?? [],
    enabled: searching,
  });

  const term = search.trim().toLowerCase();
  const filteredConversations = term
    ? conversations.filter((c) => {
        const p = c.peer;
        return (
          p?.name?.toLowerCase().includes(term) ||
          p?.phone.toLowerCase().includes(term) ||
          (c.summary_preview ?? '').toLowerCase().includes(term)
        );
      })
    : conversations;

  const existingPeerIds = new Set(conversations.map((c) => c.peer_id));
  const globalResults = (finder.data ?? []).filter((u) => u.id !== me.id && !existingPeerIds.has(u.id));

  return (
    <aside className="sidebar">
      <div className="sidebar__search">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search or start a new chat"
          aria-label="Search conversations and people"
        />
        {search && (
          <button className="sidebar__clear" onClick={() => setSearch('')} aria-label="Clear search">
            ×
          </button>
        )}
      </div>

      <div className="sidebar__list" role="list">
        {loading && <div className="sidebar__state">Loading…</div>}

        {!loading &&
          filteredConversations.map((c) => (
            <ConversationItem key={c.id} conversation={c} me={me} active={c.id === activeId} onClick={() => onSelect(c.id)} />
          ))}

        {searching && (
          <>
            <div className="sidebar__group">Global search</div>
            {finder.isLoading && <div className="sidebar__state">Searching people…</div>}
            {!finder.isLoading && globalResults.length === 0 && <div className="sidebar__state">Nothing found</div>}
            {globalResults.map((u) => (
              <button key={u.id} className="convrow" role="listitem" onClick={() => onOpenPeer(u.id)}>
                <Avatar name={u.name} phone={u.phone} />
                <div className="convrow__body">
                  <div className="convrow__top">
                    <span className="convrow__name">{u.name || u.phone}</span>
                  </div>
                  <div className="convrow__preview">{u.phone}</div>
                </div>
              </button>
            ))}
          </>
        )}

        {!loading && !searching && conversations.length === 0 && (
          <div className="sidebar__empty">
            <p>No conversations yet.</p>
            <p className="muted">Search a phone number above to start one.</p>
          </div>
        )}
      </div>

      <div className="sidebar__self">
        <Avatar name={me.name} phone={me.phone} size={36} />
        <div className="sidebar__self-id">
          <span className="convrow__name">{me.name || 'You'}</span>
          <span className="muted">{me.phone}</span>
        </div>
        <button className="btn btn--ghost" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
