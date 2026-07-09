import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { ChatConversation } from '@chat/contract';
import { Avatar } from './Avatar';
import { createGroup, createChannel } from '../api/chat';

export function NewGroupModal({
  kind,
  conversations,
  onClose,
  onCreated,
}: {
  kind: 'group' | 'channel';
  conversations: ChatConversation[];
  onClose: () => void;
  onCreated: (c: ChatConversation) => void;
}) {
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dmPeers = conversations.filter((c) => (c.type ?? 'dm') === 'dm' && c.peer);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const create = async () => {
    const t = title.trim();
    if (t.length < 1) {
      setError('Enter a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const conv = kind === 'group' ? await createGroup(t, [...selected]) : await createChannel(t, isPublic);
      onCreated(conv);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div className="sheet__backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div
          className="sheet"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          role="dialog"
          aria-modal="true"
          aria-label={kind === 'group' ? 'New group' : 'New channel'}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sheet__head">
            <h2>{kind === 'group' ? 'New Group' : 'New Channel'}</h2>
            <button className="btn btn--ghost" onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className="profile__body">
            <label className="field">
              <span>{kind === 'group' ? 'Group name' : 'Channel name'}</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'group' ? 'My group' : 'My channel'} autoFocus maxLength={128} />
            </label>

            {kind === 'channel' ? (
              <label className="switchrow">
                <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                <span>Public channel (discoverable in search)</span>
              </label>
            ) : (
              <>
                <span className="profile__label">Add members ({selected.size})</span>
                <div className="memberpick">
                  {dmPeers.length === 0 && <p className="muted">Start a chat with someone first to add them.</p>}
                  {dmPeers.map((c) => (
                    <button
                      key={c.peer_id}
                      className={`memberpick__row${selected.has(c.peer_id) ? ' is-sel' : ''}`}
                      onClick={() => toggle(c.peer_id)}
                      type="button"
                    >
                      <Avatar name={c.peer?.name} phone={c.peer?.phone} size={34} />
                      <span className="memberpick__name">{c.peer?.name || c.peer?.phone}</span>
                      <span className="memberpick__check">{selected.has(c.peer_id) && <Check size={16} aria-hidden />}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {error && <p className="auth__error" role="alert">{error}</p>}
            <button className="btn btn--primary" onClick={create} disabled={busy}>
              {busy ? 'Creating…' : `Create ${kind}`}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
