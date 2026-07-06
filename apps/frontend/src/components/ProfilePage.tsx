import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { ChatParticipant } from '@chat/contract';
import { Avatar } from './Avatar';
import { getMe, updateProfile } from '../api/auth';

interface Props {
  open: boolean;
  onClose: () => void;
  me: ChatParticipant;
  onUpdated: (me: ChatParticipant) => void;
}

export function ProfilePage({ open, onClose, me, onUpdated }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.name ?? '');
  const [username, setUsername] = useState(me.username ?? '');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the full profile (bio, etc.) when opened.
  useEffect(() => {
    if (!open) return;
    setError(null);
    getMe()
      .then((p) => {
        setName(p.name ?? '');
        setUsername(p.username ?? '');
        setBio(p.bio ?? '');
      })
      .catch(() => undefined);
  }, [open]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await updateProfile({ name: name.trim(), username: username.trim(), bio });
      onUpdated({ ...me, name: p.name, username: p.username, photo_url: p.photo_url, has_photo: p.has_photo });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="sheet__backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="sheet"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            role="dialog"
            aria-modal="true"
            aria-label="Profile"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet__head">
              <h2>Profile</h2>
              <button className="btn btn--ghost" onClick={onClose} aria-label="Close">×</button>
            </div>

            <div className="profile__hero">
              <Avatar name={me.name} phone={me.phone} size={96} />
            </div>

            {!editing ? (
              <div className="profile__body">
                <div className="profile__row">
                  <span className="profile__label">Name</span>
                  <span className="profile__value">{name || '—'}</span>
                </div>
                <div className="profile__row">
                  <span className="profile__label">Username</span>
                  <span className="profile__value">{username ? `@${username}` : '—'}</span>
                </div>
                <div className="profile__row">
                  <span className="profile__label">Phone</span>
                  <span className="profile__value">{me.phone}</span>
                </div>
                <div className="profile__row">
                  <span className="profile__label">Bio</span>
                  <span className="profile__value">{bio || '—'}</span>
                </div>
                <button className="btn btn--primary" onClick={() => setEditing(true)}>Edit profile</button>
              </div>
            ) : (
              <div className="profile__body">
                <label className="field">
                  <span>Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
                </label>
                <label className="field">
                  <span>Username</span>
                  <div className="field__wrap">
                    <span className="field__prefix">@</span>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      maxLength={32}
                    />
                  </div>
                </label>
                <label className="field">
                  <span>Bio</span>
                  <textarea
                    className="composer__input"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={280}
                    rows={3}
                  />
                </label>
                {error && <p className="auth__error" role="alert">{error}</p>}
                <div className="profile__actions">
                  <button className="btn" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
                  <button className="btn btn--primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
