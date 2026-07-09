import { AnimatePresence, motion } from 'framer-motion';
import { Users, Megaphone, Contact, Phone, Bookmark, Settings, User, type LucideIcon } from 'lucide-react';
import type { ChatParticipant } from '@chat/contract';
import { Avatar } from './Avatar';
import { ThemeToggle } from './ThemeToggle';

// Telegram-style left menu. Items marked `soon` land in later phases (groups/channels/contacts/…).
const ITEMS: { key: string; icon: LucideIcon; label: string; soon?: boolean }[] = [
  { key: 'group', icon: Users, label: 'New Group', soon: true },
  { key: 'channel', icon: Megaphone, label: 'New Channel', soon: true },
  { key: 'contacts', icon: Contact, label: 'Contacts', soon: true },
  { key: 'calls', icon: Phone, label: 'Calls', soon: true },
  { key: 'saved', icon: Bookmark, label: 'Saved Messages', soon: true },
  { key: 'settings', icon: Settings, label: 'Settings', soon: true },
];

interface Props {
  open: boolean;
  onClose: () => void;
  me: ChatParticipant;
  onOpenProfile: () => void;
  onLogout: () => void;
  onNewGroup?: () => void;
  onNewChannel?: () => void;
}

export function AppDrawer({ open, onClose, me, onOpenProfile, onLogout, onNewGroup, onNewChannel }: Props) {
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
                <User size={20} aria-hidden /> Profile
              </button>
              {ITEMS.map((it) => {
                const handler = it.key === 'group' ? onNewGroup : it.key === 'channel' ? onNewChannel : undefined;
                const enabled = !!handler;
                const Icon = it.icon;
                return (
                  <button
                    key={it.key}
                    className="drawer__item"
                    type="button"
                    disabled={!enabled}
                    title={enabled ? undefined : 'Coming soon'}
                    onClick={enabled ? () => { onClose(); handler!(); } : undefined}
                  >
                    <Icon size={20} aria-hidden /> {it.label}
                    {!enabled && <span className="drawer__soon">soon</span>}
                  </button>
                );
              })}
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
