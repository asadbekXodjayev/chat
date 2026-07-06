-- §15.3 persistence. Idempotent: safe to run repeatedly.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (not detailed in §6 but required: conversations reference user ids, user-finder searches people).
CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL UNIQUE,
  name        text,
  role        text NOT NULL DEFAULT 'user',
  has_photo   boolean NOT NULL DEFAULT false,
  photo_url   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_phone_idx ON users (phone);

-- Conversations: 1:1, unique on the UNORDERED pair {user_a_id, user_b_id} (§15.3).
CREATE TABLE IF NOT EXISTS conversations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id          uuid NOT NULL REFERENCES users(id),
  user_b_id          uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  last_message_id    uuid,
  last_message_at    timestamptz,
  unread_a           integer NOT NULL DEFAULT 0,
  unread_b           integer NOT NULL DEFAULT 0,
  CHECK (user_a_id <> user_b_id)
);
-- Unordered-pair uniqueness: canonicalize as (least, greatest).
CREATE UNIQUE INDEX IF NOT EXISTS conversations_pair_uniq
  ON conversations (LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id));

-- Messages. read_by_a / read_by_b = whether user_a / user_b has read the message.
CREATE TABLE IF NOT EXISTS messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL REFERENCES users(id),
  type             text NOT NULL DEFAULT 'text',
  body             text,
  payload          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  delivered_at     timestamptz,
  read_by_a        boolean NOT NULL DEFAULT false,
  read_by_b        boolean NOT NULL DEFAULT false,
  client_request_id text
);
CREATE INDEX IF NOT EXISTS messages_conv_created_idx ON messages (conversation_id, created_at DESC, id);
-- Client-side idempotency for send (§ NFR-10): dedup per (conversation, client_request_id).
CREATE UNIQUE INDEX IF NOT EXISTS messages_client_req_uniq
  ON messages (conversation_id, client_request_id) WHERE client_request_id IS NOT NULL;

-- Attachments: SHA-256 dedup (§5.4 / §15.3).
CREATE TABLE IF NOT EXISTS attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256       text NOT NULL UNIQUE,
  kind         text,
  mime         text,
  size_bytes   bigint,
  duration_ms  integer,
  width        integer,
  height       integer,
  has_thumb    boolean NOT NULL DEFAULT false,
  storage_key  text NOT NULL,
  thumb_key    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Calls (§6.8 / §15.3). client_request_id unique for idempotent create.
CREATE TABLE IF NOT EXISTS calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid REFERENCES conversations(id),
  caller_id         uuid NOT NULL REFERENCES users(id),
  callee_id         uuid NOT NULL REFERENCES users(id),
  status            text NOT NULL DEFAULT 'RINGING',
  call_type         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  ended_at          timestamptz,
  ended_by          uuid,
  ended_reason      text,
  client_request_id text UNIQUE
);
CREATE INDEX IF NOT EXISTS calls_ringing_idx ON calls (status, created_at) WHERE status = 'RINGING';

-- FCM push tokens (§8.1 #16/#17). Stores X-Language for localized push.
CREATE TABLE IF NOT EXISTS push_tokens (
  token       text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language    text,
  device_type text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
