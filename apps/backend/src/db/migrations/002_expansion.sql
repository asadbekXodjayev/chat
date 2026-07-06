-- 002 — Telegram-class expansion (profiles, @handle registry, polymorphic conversations,
-- membership spine, message edit/reply/quote, reactions/pins, personal state, auth sessions, audit).
-- FULLY IDEMPOTENT: the migrate runner re-applies every file on each run (no ledger), so every
-- statement must be safe to repeat. Additive on top of 001_init.sql. See docs/SPEC.md §4.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── USERS: Telegram-style profile ───────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username           citext,
  ADD COLUMN IF NOT EXISTS bio                 text,
  ADD COLUMN IF NOT EXISTS telegram_user_id    bigint,
  ADD COLUMN IF NOT EXISTS telegram_username   text,
  ADD COLUMN IF NOT EXISTS telegram_linked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at        timestamptz,
  ADD COLUMN IF NOT EXISTS photo_attachment_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_chk') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN ('user','admin')) NOT VALID;
  END IF;
END $$;

-- ── Global @handle registry (users + public groups/channels share one namespace) ──
CREATE TABLE IF NOT EXISTS usernames (
  username    citext PRIMARY KEY,
  owner_type  text NOT NULL CHECK (owner_type IN ('user','conversation')),
  owner_id    uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id)
);
CREATE INDEX IF NOT EXISTS usernames_trgm_idx ON usernames USING gin (username gin_trgm_ops);

-- ── CONVERSATIONS: polymorphic dm|group|channel|saved ───────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS type         text NOT NULL DEFAULT 'dm',
  ADD COLUMN IF NOT EXISTS title        text,
  ADD COLUMN IF NOT EXISTS description  text,
  ADD COLUMN IF NOT EXISTS username     citext,
  ADD COLUMN IF NOT EXISTS owner_id     uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS has_photo    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_url    text,
  ADD COLUMN IF NOT EXISTS member_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_public    boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_type_chk') THEN
    ALTER TABLE conversations ADD CONSTRAINT conversations_type_chk
      CHECK (type IN ('dm','group','channel','saved'));
  END IF;
END $$;

ALTER TABLE conversations ALTER COLUMN user_a_id DROP NOT NULL;
ALTER TABLE conversations ALTER COLUMN user_b_id DROP NOT NULL;

-- Re-scope the pair-unique index to DMs so getOrCreate's ON CONFLICT stays valid ONLY for dm rows.
DROP INDEX IF EXISTS conversations_pair_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_dm_pair_uniq
  ON conversations (LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id))
  WHERE type = 'dm';

-- ── MEMBERSHIP + per-user conversation state (the spine) ────────────────────
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id       uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                  text NOT NULL DEFAULT 'member'
                          CHECK (role IN ('owner','admin','member','subscriber')),
  joined_at             timestamptz NOT NULL DEFAULT now(),
  invited_by            uuid REFERENCES users(id),
  last_read_message_id  uuid,
  last_read_at          timestamptz,
  unread_count          integer NOT NULL DEFAULT 0,
  notifications_enabled boolean NOT NULL DEFAULT true,
  is_archived           boolean NOT NULL DEFAULT false,
  is_pinned             boolean NOT NULL DEFAULT false,
  is_hidden             boolean NOT NULL DEFAULT false,   -- per-user "delete conversation"
  cleared_before        timestamptz,                     -- clear-history-for-me cursor
  ui_settings           jsonb,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conv_members_user_idx ON conversation_members (user_id, is_archived, is_hidden);
CREATE INDEX IF NOT EXISTS conv_members_conv_idx ON conversation_members (conversation_id, role);

-- Backfill DM membership from existing a/b BEFORE any code reads membership.
INSERT INTO conversation_members (conversation_id, user_id, role)
  SELECT id, user_a_id, 'member' FROM conversations WHERE type = 'dm' AND user_a_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO conversation_members (conversation_id, user_id, role)
  SELECT id, user_b_id, 'member' FROM conversations WHERE type = 'dm' AND user_b_id IS NOT NULL
ON CONFLICT DO NOTHING;
UPDATE conversations SET member_count = 2 WHERE type = 'dm' AND member_count <> 2;

-- ── MESSAGES: edit / reply / quote-snapshot / forward + FTS ─────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS reply_to_message_id       uuid REFERENCES messages(id),
  ADD COLUMN IF NOT EXISTS quote_text                text,
  ADD COLUMN IF NOT EXISTS quote_start               integer,
  ADD COLUMN IF NOT EXISTS quote_end                 integer,
  ADD COLUMN IF NOT EXISTS forwarded_from_message_id uuid,
  ADD COLUMN IF NOT EXISTS forwarded_from_user_id    uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS body_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED;
CREATE INDEX IF NOT EXISTS messages_tsv_idx        ON messages USING gin (body_tsv);
CREATE INDEX IF NOT EXISTS messages_body_trgm_idx  ON messages USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS messages_attachment_idx ON messages ((payload->>'attachment_id')); -- media authz join

CREATE TABLE IF NOT EXISTS message_hidden (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_pins (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by       uuid NOT NULL REFERENCES users(id),
  pinned_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, message_id)
);
CREATE INDEX IF NOT EXISTS pins_conv_idx ON message_pins (conversation_id);

CREATE TABLE IF NOT EXISTS message_reactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('emoji','text')),
  emoji           text,
  text_value      text,
  reaction_key    text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, reaction_key)
);
CREATE INDEX IF NOT EXISTS reactions_msg_idx ON message_reactions (message_id);

-- ── Personal state: contacts, tabs/folders, recent searches ─────────────────
CREATE TABLE IF NOT EXISTS contacts (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias_name      text,
  favorite        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, contact_user_id),
  CHECK (user_id <> contact_user_id)
);

CREATE TABLE IF NOT EXISTS user_tabs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  filter_type text NOT NULL DEFAULT 'all'
                CHECK (filter_type IN ('all','dm','group','channel','custom')),
  position    integer NOT NULL DEFAULT 0,
  is_default  boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS user_tabs_idx ON user_tabs (user_id, position);
CREATE TABLE IF NOT EXISTS user_tab_conversations (
  tab_id          uuid NOT NULL REFERENCES user_tabs(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  PRIMARY KEY (tab_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS recent_searches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('user','conversation','query')),
  target_id   uuid,
  query       text,
  searched_at timestamptz NOT NULL DEFAULT now(),
  dedup_key   text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS recent_searches_uniq
  ON recent_searches (user_id, target_type, dedup_key);

-- ── Auth / security tables ──────────────────────────────────────────────────
-- Refresh/session store: revocation + rotation + theft detection.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti          text NOT NULL UNIQUE,       -- current refresh id (hashed)
  family_id    uuid NOT NULL,              -- rotation family; reuse of a rotated jti ⇒ revoke family
  revoked_at   timestamptz,
  user_agent   text,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id) WHERE revoked_at IS NULL;

-- Immutable admin god-mode audit trail (append-only).
CREATE TABLE IF NOT EXISTS audit_log (
  id                     bigserial PRIMARY KEY,
  admin_id               uuid NOT NULL REFERENCES users(id),
  action                 text NOT NULL,
  target_user_id         uuid,
  target_conversation_id uuid,
  target_attachment_id   uuid,
  ip                     inet,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Unique @handle per user (partial: only when set). Registry table enforces global uniqueness;
-- this guards direct users.username writes too.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uniq ON users (username) WHERE username IS NOT NULL;
