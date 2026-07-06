import { AnimatePresence, motion } from 'framer-motion';
import type { ChatParticipant } from '@chat/contract';
import { Avatar } from './Avatar';
import { ThemeToggle } from './ThemeToggle';

// Telegram-style left menu. Items marked `soon` land in later phases (groups/channels/contacts/…).
const ITEMS: { key: string; icon: string; label: string; soon?: boolean }[] = [
  { key: 'group', icon: '👥', label: 'New Group', soon: true },
  { key: 'channel', icon: '📣', label: 'New Channel', soon: true },
  { key: 'contacts', icon: '📇', label: 'Contacts', soon: true },
  { key: 'calls', icon: '📞', label: 'Calls', soon: true },
  { key: 'saved', icon: '🔖', label: 'Saved Messages', soon: true },
  { key: 'settings', icon: '⚙️', label: 'Settings', soon: true },
];

interface Props {
  open: boolean;
  onClose: () => void;
  me: ChatParticipant;
  onOpenProfile: () => void;
  onLogout: () => void;
}

export function AppDrawer({ open, onClose, me, onOpenProfile, onLogout }: Props) {
  const openProfile = () => {
    onClose();
    onOpenProfile();
  };
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="drawer__backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <button className="drawer__profile" onClick={openProfile} type="button">
              <Avatar name={me.name} phone={me.phone} size={58} />
              <div className="drawer__id">
                <span className="drawer__name">{me.name || 'You'}</span>
                <span className="muted">{me.username ? `@${me.username}` : me.phone}</span>
              </div>
            </button>

            <nav className="drawer__nav">
              <button className="drawer__item" onClick={openProfile} type="button">
                <span aria-hidden>👤</span> Profile
              </button>
              {ITEMS.map((it) => (
                <button key={it.key} className="drawer__item" type="button" disabled={it.soon} title={it.soon ? 'Coming soon' : undefined}>
                  <span aria-hidden>{it.icon}</span> {it.label}
                  {it.soon && <span className="drawer__soon">soon</span>}
                </button>
              ))}
            </nav>

            <div className="drawer__foot">
              <span className="drawer__footlabel">Theme</span>
              <ThemeToggle />
              <button className="btn btn--ghost drawer__logout" onClick={onLogout} type="button">
                Sign out
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
