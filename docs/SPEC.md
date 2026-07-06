# Chat Messenger — Consolidated Technical Specification

> Single source of truth for the Telegram-class evolution of the existing 1:1 chat app.
> Synthesises the requirements in `docs/SPEC-SOURCE.md` with the 5-architect design pass
> (security-admin, backend-datamodel, realtime-calls-media, frontend-ux, scope-premortem).
> Supersedes ambiguous items in SPEC-SOURCE by RESOLVING every open fork below.

**Existing stack (do not rewrite):** TypeScript + Fastify + `ws` backend (GCP VM, Caddy TLS at
`https://api.asadbe.uz`), React 19 + Vite frontend (Vercel), Postgres + Redis, monorepo with a
shared `@chat/contract` package. Styling stays hand-written CSS token system (`apps/frontend/src/index.css`);
animation is added via **framer-motion**. Reference to port-and-adapt (calls, voice, video-notes, OTP,
mobile patterns): `C:/Users/hp/Desktop/sarbon-frontend-main`.

---

## 1. Overview & Goals

Evolve a working 1:1 messenger + WebRTC calling product into a Telegram-class app **without rewriting the
message core**. The delivery strategy is **additive and phased**: ship the ~80% of the spec that is
1:1-scoped on today's backend first, introduce a forward-compatible group seam early, and add
groups/channels last as an additive epic.

### Product goals
- **Auth**: phone-first login with Telegram-delivered OTP; register (name + nickname) for new numbers; an
  animated hero on the entry screen.
- **Profiles**: Telegram-style user model (id, name, unique @username, phone, avatar, bio, last-seen).
- **Navigation**: burger drawer (Profile, New Group, New Channel, Contacts, Calls, Saved, Settings,
  Switch account, theme toggle), resizable chat-list panel, tabs (All/Private/Group/Channel).
- **Chat**: reactions (emoji + text, multiple, counters), reply incl. reply-to-text-span, edit/delete/pin/
  copy/save, voice messages + round video-notes, per-chat themes/settings, in-chat search, toasts.
- **Peek**: press-and-hold a chat avatar to read messages silently (no read receipt).
- **Calls**: full-screen Telegram-style call modal (audio/video, upgrade, screen-share, mute, PiP, flip).
- **Groups & Channels**: N-way membership, roles, subscriber/member counts, broadcast permissions (phased last).

### Engineering goals (non-negotiable)
- **Security is first-class**: server-side authorization on every read/write, strict row-level isolation,
  media authorized on the message↔membership edge, hardened OTP, revocable rotating refresh sessions, and
  admin god-mode as a **separate audited surface** — never client-trusted.
- **No auth hatch reaches production**: the `136092` test OTP and `dev-login` are env-gated and cannot boot in prod.
- **The working DM + calls product must not regress**: additive migrations only; DM fast-paths preserved.
- **Accessibility & adaptivity**: WCAG 2.2 AA, reduced-motion honored through framer-motion, responsive from
  small phones to desktop, mobile single-pane vs desktop resizable two-pane.

### Success criteria
Every phase closes green through the mandatory `REVIEW → TEST → VERIFY` gate; auth/admin phases additionally
pass `SECURE`; user-facing phases pass `A11Y`. A phase is not done until its VERIFY observations are seen live.

---

## 2. Resolved Decisions (open forks settled)

| # | Fork (from SPEC-SOURCE §8) | **Resolution** |
|---|---|---|
| D1 | Admin: `136092` admin-only vs universal? Phone format? | **Admin = a real DB role** (`users.role='admin'`), provisioned by migration/seed for a single E.164 phone read from **`ADMIN_PHONE`** env. Role is NEVER settable via API or login payload. `136092` is NOT an admin unlock. |
| D2 | Is `136092` universal-for-all or admin-only? | **Universal test hatch, non-prod only.** It verifies the OTP step for ANY phone but ONLY when `AUTH_ALLOW_TEST_OTP==='true' && NODE_ENV!=='production' && code===AUTH_TEST_OTP`. It **never grants admin**. A boot invariant refuses to start if enabled in production. |
| D3 | `dev-login` future | **Retired in prod.** Mounted only under the same env gate as D2; never registered when `NODE_ENV==='production'`. Replaced by `request-code` / `verify-code`. |
| D4 | Telegram OTP delivery: Gateway-by-phone vs bot | **Validate FIRST (Phase 0 gate).** Target = Telegram Gateway (`gateway.telegram.org`) by phone via `TELEGRAM_GATEWAY_TOKEN`. If Gateway-by-phone is unavailable, fall back to an SMS provider or an explicit "open our bot" step. No auth UI is built until a real OTP send to an arbitrary phone is proven. |
| D5 | Groups & Channels: full build now vs phased | **PHASED (Approach B).** Ship 1:1-scoped features first; add groups/channels LAST. The **forward-compat seam is introduced in the first data slice** (polymorphic `conversations.type` + `conversation_members`), so groups are additive rows, never a message-core migration. |
| D6 | Data model shape for groups | **Unified polymorphic `conversations` + one `conversation_members` table.** No separate group/channel tables. `type IN ('dm','group','channel','saved')`. DM `user_a/user_b/unread_a/unread_b` + `messages.read_by_a/b` kept as a **DM fast-path**; group/channel read state uses the per-member cursor. |
| D7 | Peek vs double-blue read receipts | **Coexist.** `delivered` (grey ✓✓) = pure function of socket connectivity. `read` (blue ✓✓) = ONLY an explicit mark-read action, never a side effect of fetching. Peek = a dedicated silent-read fetch (`?peek=1`) contractually guaranteed to never advance read state, never stamp delivered, never emit `conversation_read`, never publish typing. |
| D8 | Media authorization | **Authorize on the message↔conversation/membership edge, never on the attachment row.** Content-addressed dedup means one blob backs N conversations; a `MediaService.canAccess(attachmentId, userId)` join gates every read. 404 (not 403) on miss. |
| D9 | Routing library | **react-router v6** (BrowserRouter). A persistent `ShellLayout` route hosts providers + the single WebSocket + gesture arbiter above `<Outlet/>`; chats, drawer, settings become real routes. |
| D10 | Styling & animation | **Keep hand-written CSS token system** (`index.css`); add **framer-motion** only. No CSS framework. Refactor tokens to a `data-theme` model for manual light/dark toggle. |
| D11 | Reactions semantics | Emoji OR free-text, **multiple per user**, per-key counters. Free text is length-capped + server-sanitized + escaped on render (untrusted). `UNIQUE(message_id,user_id,reaction_key)` makes toggle idempotent. |
| D12 | Reply-to-text-span storage | Store `reply_to_message_id` PLUS a **snapshot** (`quote_text` + `quote_start/quote_end`). Render from the snapshot so source edit/delete can't corrupt the quote; deep-link to the live message only when it still exists. |
| D13 | Layout regimes | **Two regimes split by breakpoint.** Desktop = resizable two-pane (2rem…60vw). Mobile (≤768) = route-driven single-pane list⇄thread swap. The resize handle is disabled on mobile. Not one mechanism for both. |
| D14 | Gestures & back-swipe | **One gesture arbiter** owns all pointer/wheel input; every gesture has a **visible non-gesture fallback treated as primary** (reply button, drag handle, back button) because browser back-swipe suppression is not guaranteed. |
| D15 | Recent searches storage | **Client-side per-account** (namespaced by `me.id` in the persist store) for v1. Server-side `recent_searches` table is available for cross-device sync (backend-datamodel) but client is the v1 source. |
| D16 | Per-chat settings storage | **Server-side** (`conversation_members.ui_settings` + notification flag) so theme/background/mute follow the user across devices. |
| D17 | Slug routing | Canonical **`/c/:conversationId`** ships now; pretty `/@:nickname` layers on after the username column exists and resolves server-side → 302 to canonical. Never rely on nickname presence; id fallback always. |
| D18 | Username namespace | **Shared `usernames(username citext PK, owner_type, owner_id)` registry** so `@foo` is globally unique across users AND public groups/channels. Requires `citext` + `pg_trgm`. |
| D19 | Saved Messages | A `type='saved'` conversation with a single self-membership row; sidesteps `CHECK(user_a<>user_b)` because a/b are NULL. Auto-created lazily on first save/open. |
| D20 | Toasts | Client-derived from the existing `message` kind when `sender_id!==me && conversation_id!==active`. `aria-live` region, cap 3 (4th → "+N more"), dedup by message id, suppress for active conversation / hidden tab. |

---

## 3. Security Model

Security is the highest-priority surface. The critical fixes below are must-do and are called out again in
the phasing plan under SECURE gates.

### 3.1 Authentication (Telegram OTP; dev-login retired)
- `POST /v1/auth/request-code {phone}`: normalize to E.164; enforce **per-phone AND per-IP Redis rate limits**
  (e.g. 1/60s, 3/hour, 5/day per phone; plus per-IP caps); generate a 6-digit code; store `SHA-256(code)` in
  `otp:req:<sha(phone)>` with 300s TTL + `attempts=0` + resend cooldown; deliver via Telegram Gateway; respond
  **uniformly `code_sent`** whether or not the account exists (no enumeration).
- `POST /v1/auth/verify-code {phone, code, request_nonce}`: load the OTP state; if `attempts>=5` → invalidate + 429;
  **constant-time compare** against the stored hash OR the env-gated test OTP; on success delete the key
  (single-use), `getOrCreateByPhone`, mint a token pair, create an `auth_sessions` row. New numbers proceed to
  registration (collect name + nickname) before home.
- **Test OTP** is honored ONLY when `AUTH_ALLOW_TEST_OTP==='true' && NODE_ENV!=='production' && code===AUTH_TEST_OTP`.
  It bypasses ONLY the code compare — never the rate limits — and **never grants admin**. Every accepted test-OTP
  login logs a loud warning.
- **Boot invariant** (`config/env.ts`): if `NODE_ENV==='production'` and (`AUTH_ALLOW_TEST_OTP` truthy OR dev-login
  is mounted) → **throw and refuse to start**.

### 3.2 Admin god-mode as a separate, audited surface
- `users.role ∈ {'user','admin'}` (CHECK-constrained); admin provisioned only by migration/seed for `ADMIN_PHONE`.
- `claims.role` is stamped at login/refresh **strictly from the DB users row** (fixes the refresh path that
  currently trusts the old token's role).
- God-mode lives ONLY on a separate `/v1/admin/*` surface guarded by `requireRole('admin')`. Those handlers:
  (a) re-check role from the request, (b) deliberately bypass the membership predicate **inside that guarded handler
  only**, (c) are **SILENT** — never call `markConversationRead`, never stamp `delivered_at`, never emit
  `conversation_read`, never publish typing, never mutate unread/last-read, (d) write an **immutable `audit_log` row**
  (admin_id, action, target ids, ip, ts) per access. **Normal member routes never branch on role.**

### 3.3 Strict row-level isolation
- Every message/media/read/typing/conversation path resolves ownership through a single helper.
  - 1:1: `user_a/user_b` membership (existing `loadConversationForMember` pattern — correct, keep it).
  - Groups/channels: `conversation_members` lookup with **per-action capability checks** (channel: only owner/admin
    post, member/subscriber read; group: any member posts).
- No implicit "if it exists you can see it" anywhere. Admin god-mode is the ONLY cross-membership read, and only via
  the audited admin surface.

### 3.4 Media authorization (fixes the MEDIA IDOR — CRITICAL)
- **Flaw:** `streamMedia` (`routes/chat.ts`) streams any attachment by id after only `requireUserId` — a cross-tenant
  read of the most sensitive data. Attachments are content-addressed and globally deduped, so any authed user who
  learns/guesses a UUID downloads anyone's photos/voice/docs.
- **Fix:** add `MediaService.canAccess(attachmentId, userId)`:
  ```sql
  SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
   WHERE m.payload->>'attachment_id' = $1
     AND ( c.user_a_id = $2 OR c.user_b_id = $2
           OR EXISTS (SELECT 1 FROM conversation_members cm
                       WHERE cm.conversation_id = c.id AND cm.user_id = $2) )
  LIMIT 1;
  ```
  Call it in `streamMedia` before `readBlob`; **return 404 on miss** (no existence oracle). Authorize on the
  message↔conversation/membership edge, never the attachment row. Add `CREATE INDEX messages_attachment_idx ON
  messages ((payload->>'attachment_id'))` for the join. Admin access is an explicit audited branch, not an implicit skip.

### 3.5 Refresh rotation & revocation (fixes stale-role + no-logout)
- **Flaw:** refresh re-mints using `claims.role` from the OLD token, is unrevocable, does not rotate, and shares one
  secret with access tokens. Consequences: no logout, demoted admin keeps admin until expiry, replayable long-lived token.
- **Fix:** server-side `auth_sessions` store (Redis-mirrored). Refresh becomes **stateful + rotating**: store a hashed
  refresh id (`jti`) per session inside a rotation `family_id`. On refresh: verify jti exists + not revoked, rotate
  (issue new jti, revoke old); **reuse of a rotated jti ⇒ revoke the whole family** (theft detection). **Re-fetch role
  from the DB** on every refresh. Provide `POST /v1/auth/logout` (revoke this jti) and `logout-all`. Use a distinct
  `AUTH_REFRESH_SECRET` (separate from `AUTH_ACCESS_SECRET`). Keep access TTL short (5–15 min).

### 3.6 OTP hardening
Covered in §3.1: per-phone + per-IP limits, uniform responses, hashed single-use codes with TTL, 5-attempt cap then
hard invalidate, constant-time compare, code bound to phone + request nonce. The test OTP bypasses only the compare,
never the limits.

### 3.7 Content oracle & re-attach primitive (sha256 probe + media-ref) — HIGH
- **Flaw:** `POST /chat/files/probe` returns existence/mime/size/dims for ANY sha256; `media-ref` sends a message
  referencing ANY attachment found by sha256 — a cross-user confirm + re-attach.
- **Fix:** scope probe/dedup to the caller — `exists=true` only if the caller already has access to a message
  referencing that sha256 (or dedup only across the caller's own uploads). For `media-ref`, require the referenced
  attachment already be accessible to the sender (same `canAccess` join) or force a fresh upload. **Rate-limit probe.**

### 3.8 Phonebook enumeration (user-finder) — MEDIUM
- **Flaw:** `finder()` does `phone ILIKE '%q%'` on a 3-char query and returns full phone + **role** + name of all matches.
- **Fix:** match on normalized full E.164 (or a strong prefix ≥6–7 digits), cap results, **strip `role` from the finder
  DTO**, rate-limit per user. Prefer Telegram-style "add by exact number". Never expose `role` to non-admins anywhere.

### 3.9 WebRTC signaling authorization — MEDIUM
- **Flaw:** `handleSignal` relays `webrtc.offer/answer/ice` to the call peer, stamping `from_id`, but does not verify the
  sender is a participant — call spam / forced ringing / SDP-IP probing.
- **Fix:** before relaying, load the call by `call_id`, assert `from_id ∈ {caller_id, callee_id}`, the target is the
  other participant, and the call is in a live state; drop otherwise. Rate-limit signaling frames per user.

### 3.10 Input validation & media content-type safety — MEDIUM
- Validate every request body with a schema (Zod/Typebox): cap `body` length (≤4096), whitelist `payload` keys per
  message type, **reject client-supplied `links`/`attachment_id` on send** (server derives them), cap payload size.
- Media: add `X-Content-Type-Options: nosniff` on all media responses; force `Content-Disposition: attachment` for
  anything not on an explicit inline-safe allowlist (`image/*`, `audio/*`, `video/*`, `application/pdf`); **never serve
  `text/html` or SVG inline**. Sniff the real content type server-side instead of trusting `part.mimetype`. Prefer a
  separate cookieless media origin. Consider short-lived HMAC-signed media URLs (like `CALLS_TURN_SECRET`).

### 3.11 WS token in query string — MEDIUM
Keep only short-lived ACCESS tokens on the WS handshake (gateway already rejects non-access `typ` — do not regress).
Prefer a `Sec-WebSocket-Protocol` / first-message auth frame over `?token=`; redact `?token=` in request logs. Never
allow refresh tokens on WS.

### 3.12 Token model summary
- Access JWT: short TTL (5–15 min), `AUTH_ACCESS_SECRET`.
- Refresh JWT: longer TTL, `AUTH_REFRESH_SECRET`, backed by `auth_sessions` (rotating, revocable, reuse-detection).
- Splitting the single `JWT_SECRET` into two invalidates existing tokens — acceptable, force re-login.

---

## 4. Data Model

Two migration files land on top of `001_init.sql`. **`002` is the additive expansion**; the security/session tables
may live in `002` or a dedicated `003_auth.sql` — sequencing (below) is what matters, not the file split. All DDL is
idempotent (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

### 4.1 ERD (textual)

- **users** (1) ──< **conversation_members** >── (1) **conversations**  (N:M membership; the spine of per-user state)
- **users** (1) ──< **conversations** via `user_a_id`/`user_b_id` (DM fast-path, nullable)
- **conversations** (1) ──< **messages** (1) ──< **message_reactions**, **message_pins**, **message_hidden**
- **messages** self-ref: `reply_to_message_id`, `forwarded_from_message_id`
- **messages** (1) ──? **attachments** via `payload->>'attachment_id'` (soft join; deduped by sha256)
- **usernames** (registry) ── polymorphic → users OR conversations (global @handle namespace)
- **users** (1) ──< **auth_sessions** (rotating refresh families), **contacts**, **user_tabs**, **recent_searches**,
  **push_tokens**
- **users** (1, admin) ──< **audit_log** (append-only god-mode trail)
- **calls** ── caller/callee → users, conversation → conversations (unchanged from 001)

Entity groups: **Identity/auth** (users, usernames, auth_sessions, audit_log, otp state in Redis) · **Conversations**
(conversations, conversation_members) · **Messages** (messages, message_reactions, message_pins, message_hidden,
attachments) · **Personal state** (contacts, user_tabs, user_tab_conversations, recent_searches) · **Realtime/calls**
(calls, push_tokens).

### 4.2 Migration 002 — expansion DDL

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── USERS: Telegram-style profile ──────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username           citext,
  ADD COLUMN IF NOT EXISTS bio                 text,
  ADD COLUMN IF NOT EXISTS telegram_user_id    bigint,
  ADD COLUMN IF NOT EXISTS telegram_username   text,
  ADD COLUMN IF NOT EXISTS telegram_linked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at        timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN ('user','admin')) NOT VALID;
-- Admin seed (ops-only, NOT via API):
--   INSERT INTO users(phone,name,role) VALUES ($ADMIN_PHONE,'Admin','admin')
--   ON CONFLICT (phone) DO UPDATE SET role='admin';

-- ── Global @handle registry (users + public groups/channels share one namespace) ──
CREATE TABLE IF NOT EXISTS usernames (
  username    citext PRIMARY KEY,
  owner_type  text NOT NULL CHECK (owner_type IN ('user','conversation')),
  owner_id    uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id)
);
CREATE INDEX IF NOT EXISTS usernames_trgm_idx ON usernames USING gin (username gin_trgm_ops);

-- ── CONVERSATIONS: polymorphic dm|group|channel|saved ──────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS type         text NOT NULL DEFAULT 'dm'
                            CHECK (type IN ('dm','group','channel','saved')),
  ADD COLUMN IF NOT EXISTS title        text,
  ADD COLUMN IF NOT EXISTS description  text,
  ADD COLUMN IF NOT EXISTS username     citext,
  ADD COLUMN IF NOT EXISTS owner_id     uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS has_photo    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_url    text,
  ADD COLUMN IF NOT EXISTS member_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_public    boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ALTER COLUMN user_a_id DROP NOT NULL,
                          ALTER COLUMN user_b_id DROP NOT NULL;
-- Re-scope the pair-unique index to DMs so getOrCreate's ON CONFLICT stays valid ONLY for dm rows.
DROP INDEX IF EXISTS conversations_pair_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_dm_pair_uniq
  ON conversations (LEAST(user_a_id,user_b_id), GREATEST(user_a_id,user_b_id))
  WHERE type = 'dm';

-- ── MEMBERSHIP + all per-user conversation state (the spine) ────────────────
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id      uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                 text NOT NULL DEFAULT 'member'
                         CHECK (role IN ('owner','admin','member','subscriber')),
  joined_at            timestamptz NOT NULL DEFAULT now(),
  invited_by           uuid REFERENCES users(id),
  last_read_message_id uuid,
  last_read_at         timestamptz,
  unread_count         integer NOT NULL DEFAULT 0,
  notifications_enabled boolean NOT NULL DEFAULT true,
  is_archived          boolean NOT NULL DEFAULT false,
  is_pinned            boolean NOT NULL DEFAULT false,
  is_hidden            boolean NOT NULL DEFAULT false,   -- per-user "delete conversation"
  cleared_before       timestamptz,                     -- clear-history-for-me cursor
  ui_settings          jsonb,                           -- {theme_primary,theme_bg,background_attachment_id}
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conv_members_user_idx ON conversation_members (user_id, is_archived, is_hidden);
CREATE INDEX IF NOT EXISTS conv_members_conv_idx ON conversation_members (conversation_id, role);
-- Backfill DM members from a/b (two INSERT..SELECT ON CONFLICT DO NOTHING) BEFORE any code reads membership.

-- ── MESSAGES: edit / reply / quote-snapshot / forward + FTS ────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS reply_to_message_id       uuid REFERENCES messages(id),
  ADD COLUMN IF NOT EXISTS quote_text                text,
  ADD COLUMN IF NOT EXISTS quote_start               integer,
  ADD COLUMN IF NOT EXISTS quote_end                 integer,
  ADD COLUMN IF NOT EXISTS forwarded_from_message_id uuid,
  ADD COLUMN IF NOT EXISTS forwarded_from_user_id    uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS body_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body,''))) STORED;
CREATE INDEX IF NOT EXISTS messages_tsv_idx        ON messages USING gin (body_tsv);
CREATE INDEX IF NOT EXISTS messages_body_trgm_idx  ON messages USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS messages_attachment_idx ON messages ((payload->>'attachment_id')); -- media authz join

CREATE TABLE IF NOT EXISTS message_hidden (           -- delete-for-me (targeted)
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_pins (             -- multiple pins per conversation
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by       uuid NOT NULL REFERENCES users(id),
  pinned_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, message_id)
);
CREATE INDEX IF NOT EXISTS pins_conv_idx ON message_pins (conversation_id);

CREATE TABLE IF NOT EXISTS message_reactions (        -- emoji OR text, multiple per user/message
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('emoji','text')),
  emoji           text,
  text_value      text,           -- length-capped + sanitized at the service layer
  reaction_key    text NOT NULL,  -- emoji char, or 't:'||lower(trim(text_value))
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, reaction_key)
);
CREATE INDEX IF NOT EXISTS reactions_msg_idx ON message_reactions (message_id);

-- ── Personal state: contacts, tabs/folders, recent searches ────────────────
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
CREATE TABLE IF NOT EXISTS user_tab_conversations (   -- phase-2 custom folders
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
  dedup_key   text NOT NULL                          -- coalesce(target_id::text, lower(query))
);
CREATE UNIQUE INDEX IF NOT EXISTS recent_searches_uniq
  ON recent_searches (user_id, target_type, dedup_key);
```

### 4.3 Auth / security tables (migration 002 or 003_auth.sql)

```sql
-- Refresh/session store: revocation + rotation + theft detection
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

-- Immutable admin god-mode audit trail (append-only)
CREATE TABLE IF NOT EXISTS audit_log (
  id                     bigserial PRIMARY KEY,
  admin_id               uuid NOT NULL REFERENCES users(id),
  action                 text NOT NULL,   -- 'read_conversation'|'read_message'|'read_media'|'list_users'
  target_user_id         uuid,
  target_conversation_id uuid,
  target_attachment_id   uuid,
  ip                     inet,
  created_at             timestamptz NOT NULL DEFAULT now()
);
```

**OTP state is Redis-only** (no table needed):
`otp:req:<sha(phone)>` → `{codeHash, attempts, exp}` TTL 300s · `otp:rl:phone:<sha(phone)>` /
`otp:rl:ip:<ip>` → fixed-window counters · `otp:cooldown:<sha(phone)>` → resend cooldown ·
`chat:rl:signal:<userId>` / `chat:rl:probe:<userId>` / `chat:rl:finder:<userId>` → new limiter buckets ·
`conv:members:<convId>` → fanout membership cache (invalidated on membership change).

### 4.4 Migration invariants (gotchas)
- **Extensions first** (`citext`, `pg_trgm`) — must precede username/tsv columns.
- The pair-unique index DROP+CREATE must be a single migration; `ConversationService.getOrCreate`'s `ON CONFLICT`
  target references the old index expression and stays valid only for `dm` rows — keep it `dm`-scoped.
- Backfill DM `conversation_members` rows BEFORE any code reads membership.
- `member_count` maintained transactionally on join/leave (increment in-tx or trigger); never `COUNT(*)` per render.
- Unread: pick ONE per type — DM uses `unread_a/b`; group/channel increments `conversation_members.unread_count` for
  all members except the sender in the send tx. Never both.
- Saved Messages `type='saved'` bypasses `CHECK(user_a<>user_b)` only because a/b are NULL — never set `a=b`.

---

## 5. REST + WS API Surface

All REST paths are under `/v1`. Envelope, headers (`X-User-Token`, `X-Language`, …), and `sendOk`/`ApiError` are
unchanged. New error codes: `otp_invalid`, `otp_expired`, `otp_too_many_attempts`, `code_send_throttled`,
`forbidden_admin_only`.

### 5.1 Auth
| Method | Path | Body → Response |
|---|---|---|
| POST | `/v1/auth/request-code` | `{phone}` → `{status:'code_sent'}` (uniform) |
| POST | `/v1/auth/verify-code` | `{phone, code, request_nonce}` → `{user, token, needs_registration?:boolean}` |
| POST | `/v1/auth/register` | `{name, username}` (authed, post-verify) → `{user, token}` |
| POST | `/v1/auth/refresh` | `{refresh_token}` → `{token}` (stateful, rotating, role re-read from DB) |
| POST | `/v1/auth/logout` | `{}` (authed) → revoke this jti |
| POST | `/v1/auth/logout-all` | `{}` (authed) → revoke all sessions for user |
| ~~POST~~ | ~~`/v1/auth/dev-login`~~ | **env-gated; never mounted in prod** |

### 5.2 Users / profile
| Method | Path | Notes |
|---|---|---|
| GET | `/v1/users/me` | full self profile |
| PATCH | `/v1/users/me` | `{name?, username?, bio?}` |
| GET | `/v1/users/:id` | `PublicUserProfile` |
| GET | `/v1/users/username-available?username=` | `{available:boolean}` |
| POST / DELETE | `/v1/users/me/photo` | avatar upload/remove |
| GET | `/v1/chat/user-finder?phone=&limit=` | **full/near-full E.164 match, role stripped, rate-limited** |

### 5.3 Conversations / chat-list
| Method | Path | Notes |
|---|---|---|
| GET | `/v1/chat/conversations?limit=&type=&tab=&archived=` | filtered list |
| POST | `/v1/chat/conversations` | create DM (existing) |
| GET / PATCH | `/v1/chat/conversations/:id` | detail / `{title?,description?,username?}` |
| POST | `/v1/chat/conversations/:id/archive` · `/unarchive` | chat-list state |
| DELETE | `/v1/chat/conversations/:id` | per-user hide (`is_hidden`) |
| POST | `/v1/chat/conversations/:id/clear` | `{scope:'me'\|'both'}` |
| POST | `/v1/chat/conversations/:id/read` | explicit mark-read (existing) |
| GET | `/v1/chat/tabs` · POST · PATCH `/:id` · DELETE `/:id` · PUT `/tabs/reorder` | tabs CRUD |

### 5.4 Messages
| Method | Path | Notes |
|---|---|---|
| GET | `/v1/chat/conversations/:id/messages?limit=&cursor=&before=&mark_read=&peek=1` | history; **`peek=1` = silent, zero side effects** |
| POST | `/v1/chat/conversations/:id/messages` | `SendTextRequest` (+ reply/quote) |
| POST | `/v1/chat/conversations/:id/messages/media` | multipart; fieldname-routed (see §5.7) |
| POST | `/v1/chat/conversations/:id/messages/media-ref` | requires sender already has access to the sha256 |
| POST | `/v1/chat/files/probe` | **caller-scoped existence only, rate-limited** |
| PATCH / DELETE | `/v1/chat/messages/:id` | edit `{body}` / delete `?scope=me\|both` |
| POST | `/v1/chat/messages/bulk-delete` | `{message_ids, scope}` |
| POST | `/v1/chat/messages/save` | bulk save → Saved Messages |
| GET / POST | `/v1/chat/conversations/:id/pins` · DELETE `/pins/:mid` | pins |
| GET | `/v1/chat/saved` | Saved Messages contents |

### 5.5 Reactions
| Method | Path | Notes |
|---|---|---|
| PUT | `/v1/chat/messages/:id/reactions` | `{emoji?}` or `{text?}`; idempotent via UNIQUE + ON CONFLICT DO NOTHING |
| DELETE | `/v1/chat/messages/:id/reactions/:key` | remove by `reaction_key` |
| GET | `/v1/chat/messages/:id/reactions` | actor list (aggregated) |

### 5.6 Search · Contacts · Settings
| Method | Path | Notes |
|---|---|---|
| GET | `/v1/chat/search?q=&section=` | global (users + is_public groups/channels) |
| GET | `/v1/chat/conversations/:id/messages/search?q=&cursor=` | in-chat (membership-gated) |
| GET / POST / DELETE | `/v1/chat/recent-searches(/:id)` | server-side recent searches (optional v1) |
| GET / POST / DELETE | `/v1/chat/contacts(/:uid)` | contacts |
| GET / PATCH | `/v1/chat/conversations/:id/settings` | notifications, theme, background |
| POST | `/v1/chat/conversations/:id/settings/background` | background upload |

### 5.7 Media upload (multipart) — part router + metadata
Replace the arrival-order file loop with **fieldname routing**: `file|media|voice|video` → primary buffer (first
non-empty wins); `poster|thumb` → thumbnail buffer (stored as `thumb_key`, `has_thumb=true`); anything else → drain
(keeps the legacy duplicate-voice client working). Parse and clamp `duration_ms` (≥0), `width`/`height` (0<x≤4096),
`waveform` (JSON, ≤64 bars each 0..1). Persist `duration_ms/width/height/has_thumb/thumb_key` via `MediaService.store()`
(columns already exist in 001) and mirror `duration_ms/width/height` into the message payload; `waveform` goes into the
message payload JSON only (presentation, not a dedup key).

### 5.8 Calls (backend already complete — do NOT rebuild)
`GET /v1/calls` · `POST /v1/calls` · `GET /v1/calls/ice-servers` · `GET /v1/calls/:id` · `POST /v1/calls/:id/accept`
· `/decline` · `/cancel` · `/end`. **Frontend MUST call `GET /v1/calls/ice-servers` before every `RTCPeerConnection`**
(currently unused). Deploy **coturn** on the VM (`static-auth-secret == CALLS_TURN_SECRET`, 3478 udp/tcp + 5349 turns,
bounded port range) so cross-NAT calls connect.

### 5.9 Admin (separate audited surface)
| Method | Path | Notes |
|---|---|---|
| GET | `/v1/admin/users` | audited |
| GET | `/v1/admin/conversations?user_id=` | god-mode list; audited |
| GET | `/v1/admin/conversations/:id/messages` | **silent**, audited |
| GET | `/v1/admin/media/:id` | audited media read |
| GET | `/v1/admin/audit` | (suggested) read-only audit feed |

All guarded by `requireRole('admin')` (role from DB), silent (no receipts/delivered/typing/last-read), each writes an
`audit_log` row.

### 5.10 WebSocket
Socket stays **receive-mostly**. Outbound vocabulary UNCHANGED: `ping`, `typing`, `typing_stop`, `webrtc.offer`,
`webrtc.answer`, `webrtc.ice`. Canonical signaling frame (must match `gateway.handleSignal` which reads `data.call_id`
+ `data.payload` and stamps `from_id`):
```
OUT offer  { type:'webrtc.offer',  data:{ call_id, payload:{ type:'offer',  sdp } } }
OUT answer { type:'webrtc.answer', data:{ call_id, payload:{ type:'answer', sdp } } }
OUT ice    { type:'webrtc.ice',    data:{ call_id, payload:{ candidate, sdpMid, sdpMLineIndex } } }
INBOUND    identical, server adds data.from_id
```
Call lifecycle (invite/accept/decline/cancel/end) stays REST; only offer/answer/ice go over WS. **In-call control**
(mute, screen-share, camera-flip, upgrade-request, speaking level) travels over a reliable ordered **RTCDataChannel
`control`**, NOT new WS frames.

**New server→client kinds** (add to `WsInternalKind` + `WIRE_TYPE_TO_KIND`):
`message_reaction` (`reaction.added`/`reaction.removed`), `message_pinned`/`message_unpinned`
(`message.pinned`/`message.unpinned`), and group kinds `conversation_update`, `member_joined`, `member_left`,
`member_role`. Edit/delete reuse existing `message_update`/`message_delete` (backend emits only, no new kinds).

**Group fanout:** add `publishToConversation(convId, frame, {excludeUserId?})` in `ws/bus.ts` — resolves members from
the `conv:members:<id>` Redis set (lazily hydrated, invalidated on membership change) and loops `publishToUser`,
preserving per-member delivered/read. **Switch every existing 1:1 emit to `publishToConversation(conv.id, …)`** so DMs
are just N=2 and groups are drop-in. Channels (thousands of subscribers) get a phase-2 dedicated
`chat:broadcast:<convId>` single-PUBLISH path.

---

## 6. @chat/contract Additions

New/changed types in `packages/contract/src`. Add matching `queryKeys` and `endpoints` builders.

**`users.ts`** — `Role = 'user'|'admin'`. Extend `ChatUserFinderItem` with `username?: string|null`; **strip `role`**
from the finder DTO surfaced to non-admins.

**`profile.ts`** (new) — `PublicUserProfile{id,name,username?,bio?,phone?,has_photo,photo_url,last_seen?:number|null}`;
`UpdateProfileRequest{name?,username?,bio?}`; `UsernameAvailableResponse{available:boolean}`.

**`conversations.ts`** — `ConversationType='dm'|'group'|'channel'|'saved'`. Extend `ChatConversation` with
`{type, title?, username?, description?, member_count?, my_role?:'owner'|'admin'|'member'|'subscriber', is_archived?,
is_muted?, is_pinned?, can_post?}`. New: `CreateGroupRequest{title,member_ids:string[],username?,description?}`,
`CreateChannelRequest{title,username?,description?,is_public?}`, `UpdateConversationRequest{title?,description?,username?}`,
`ConversationMember{user_id,role,joined_at,user:ChatParticipant}`,
`ConversationDetail(ChatConversation & {members_preview?:ConversationMember[]})`.

**`members.ts`** (new) — `MemberRole`; `AddMembersRequest{user_ids:string[]}`; `SetMemberRoleRequest{role:MemberRole}`.

**`messages.ts`** — extend `ChatMessage` with `{edited_at:string|null, reply_to:ChatReplyRef|null,
forwarded_from:{user_id,message_id}|null, is_pinned?:boolean, reactions?:ChatReactionAggregate[]}`. New
`ChatReplyRef{message_id, sender_id?, preview?:string|null, quote_text?:string|null, quote_start?:number|null,
quote_end?:number|null}`. Extend `SendTextRequest{body, reply_to_message_id?, quote?:{start,end,text}, client_request_id?}`.
New `DeleteScope='me'|'both'`; `DeleteMessageRequest{scope}`; `BulkDeleteRequest{message_ids,scope}`;
`SaveMessageRequest{message_ids}`; `PinMessageRequest{message_id}`. Extend `ChatMediaPayload` with
`waveform?: number[]|null` (≤64 normalized 0..1). `SendMediaRefRequest`/media multipart may carry
`duration_ms,width,height,waveform`.

**`reactions.ts`** (new) — `ChatReactionAggregate{key, kind:'emoji'|'text', emoji?, text?, count, reacted_by_me,
user_ids?:string[]}`; `ToggleReactionRequest{emoji?:string, text?:string}`; `ReactionActorsResponse`.

**`tabs.ts`** (new) — `TabFilterType`; `ChatTab{id,title,filter_type,position,is_default}`;
`ReorderTabsRequest{ordered_ids:string[]}`; `UpsertTabRequest{title,filter_type,conversation_ids?}`.

**`search.ts`** (new) — `GlobalSearchResponse{users:ChatUserFinderItem[], groups:ChatConversation[],
channels:ChatConversation[]}`; `MessageSearchResult{message:ChatMessage, rank?:number}`;
`RecentSearch{id,target_type,target_id?,query?,searched_at}`.

**`settings.ts`** (new) — `ConversationSettings{notifications_enabled, theme?:{primary?,bg?},
background_attachment_id?:string|null}`; `UpdateConversationSettingsRequest` (partial).

**`contacts.ts`** (new) — `Contact{user:ChatParticipant, alias_name?, favorite}`;
`AddContactRequest{user_id, alias_name?}`.

**`ws.ts`** — add to `WsInternalKind`: `message_reaction | message_pinned | message_unpinned | conversation_update |
member_joined | member_left | member_role`. Add `WIRE_TYPE_TO_KIND` entries (`reaction.added`/`reaction.removed`,
`message.pinned`/`message.unpinned`, `conversation.updated`, `member.joined`/`member.left`/`member.role`). New payloads
`WsReactionData{conversation_id, message_id, reactions:ChatReactionAggregate[], actor_id}`,
`WsPinData{conversation_id, message_id, pinned:boolean, pinned_by}`,
`WsMemberData{conversation_id, user_id, role?, member_count}`. Add optional `WsServerFrame.meta?:{sender_name?,
sender_photo_url?}` for toast enrichment (backward-compatible; `data` stays the `ChatMessage`). Signaling authz
requires call-membership; document the optional subprotocol/first-frame auth channel. **Client outbound vocabulary
unchanged.**

**`endpoints.ts`** — add builders for every path in §5 (auth, users/profile, groups/channels member ops, chat-list
archive/clear/tabs, messages delete/bulk/save/pins, reactions, search, contacts, settings, admin).

**`queryKeys.ts`** — add `profile(userId)`, `conversationDetail(id)`, `members(convId)`, `reactions(messageId)`,
`pins(convId)`, `tabs()`, `contacts()`, `recentSearches(userId)`, `search(q)`, `messageSearch(convId,q)`,
`savedMessages()`, `callHistory()`, `conversationSettings(convId)`.

---

## 7. Frontend Architecture

Styling stays hand-written CSS tokens (`index.css`); animation via **framer-motion** (new dep). Port-and-adapt from
`sarbon-frontend-main` (calls modal, voice/video-note recorders, mobile patterns) — adapt sarbon's socket send to THIS
project's `socketBus.sendWsFrame` and the exact `{type:'webrtc.offer', data:{call_id, payload}}` shape (sarbon's frame
names differ — do not copy them).

### 7.1 Routing (react-router v6)
A persistent **`ShellLayout`** route hosts `AppProviders` + `useChatWebSocket` + the gesture arbiter **ABOVE**
`<Outlet/>`, so navigating never remounts the socket, the zustand store, or the QueryClient (verify `wsConnected`
does not flap on navigation). Routes:
- `/` — desktop: empty "select a chat"; mobile: the list.
- `/c/:conversationId` — canonical chat (navigate with `replace:false` so back closes the chat).
- `/@:nickname` — pretty slug, resolves server-side → `history.replace` to canonical (deferred until username column exists).
- Overlay routes rendered as framer-motion layers over the shell: `/menu`, `/me`, `/settings`, `/contacts`, `/calls`,
  `/saved`, `/new/group`, `/new/channel`. On mobile the same routes drive which single pane is visible.

### 7.2 App shell & resizable panel
Replace `grid-template-columns:340px 1fr` with `var(--sidebar-w,340px) 1fr`, written by a **`ResizeHandle`**
(`role="separator"`, `aria-orientation="vertical"`, `aria-valuemin/max/now`, focusable, Arrow ±16px, Home/End = min/max,
double-click reset) clamped 2rem…60vw, persisted (px) in the ui store. Below the mobile breakpoint (≤768) drop to one
column, route decides which pane mounts, handle disabled. At width ≤72px rows collapse to avatar-only (icon rail) but
keep `aria-label`/title with name + preview. Add `--app-height` (visualViewport) + safe-area insets (from sarbon) so
composer and call modal survive mobile URL-bar collapse.

### 7.3 Burger drawer + profile + theme
Left slide-in via framer-motion (`x:-100%→0`, spring, backdrop fade), portaled at shell level with a focus trap,
`aria-modal`, Esc via the escape stack, focus restore to the burger button. Header = avatar + name + phone (replaces
the bottom-left self div; entry to the Profile page). Items: Profile, New Group, New Channel, Contacts, Calls, Saved,
Settings, Switch/Add account, and a **segmented Night/Light/System theme control**.

**Theme system (fixes the manual toggle):** refactor tokens to `data-theme` — keep `:root` light defaults, add
`:root[data-theme="dark"]{…}`, and scope the `@media (prefers-color-scheme:dark)` block to `:root:not([data-theme])`
(system mode only). Persist `theme:'light'|'dark'|'system'` in a zustand persist store; on boot/change set
`document.documentElement.dataset.theme` (remove for system) and keep `color-scheme` in sync.

**Profile page** (`/me`): avatar (editable), name, @nickname, phone, bio, last-seen, created_at.

### 7.4 Peek modal (silent read)
Press-and-hold an avatar (or a menu "Peek" item, or Space on a roving-focused row) opens a centered framer-motion
dialog rendering the conversation's messages **READ-ONLY**. Critical: fetch with `?peek=1`, render into an isolated
ephemeral view that **NEVER sets `activeConversationId`** and **NEVER calls `markConversationRead`** — device-level
`delivered` still fires (already happened on receipt); only READ (blue-tick / `conversation_read`) is suppressed.
Labelled "Preview — read silently". Long-press is progressive enhancement: 450ms timer on pointerdown, cancel on
move>10px, `preventDefault` + `user-select:none` + `-webkit-touch-callout:none` to suppress native callout.

### 7.5 Search UX
On focus, the sidebar list is replaced by a **Recent Searches** view (deletable rows, stored per-account in the persist
store). Per-keystroke results (keep the existing 350ms debounce, show a "searching…" state) with section headers
All / Users / Group / Channel (Group/Channel render but show "coming soon"/empty until that backend lands). Reuse the
existing `userFinder` query; don't fork it.

### 7.6 Chat view
**Top bar:** left = name + last-seen (or member/subscriber count for group/channel); right = search-in-chat icon +
call button (1:1 only, hidden for group/channel v1). **3-dots menu** (dropdown, roving keyboard, Esc-stack):
notifications on/off, open profile, custom theme colors + background image, info, clear history (me/both), delete chat.
**Message action menus** are context-sensitive — own message → edit/delete/copy/pin/reply/reply-to-selected-span;
peer message → select/pin/save/delete. **Reactions bar:** emoji picker + free-text reaction, multiple allowed, each a
pill with a counter and a "mine" highlight; hover/long-press reveals the reactor list; reaction-burst animation via
framer-motion on `reaction.added`. **Composer** gains voice-record + round-video-note controls (port sarbon
`useVoiceRecorder` + `useVideoNoteRecorder`, `ChatVoiceMessage`/`ChatVideoNoteMessage`) with a mic⇄send morph and a
hold-to-record circle button. Media is always fetched through the authed-blob path (`apiFetchBlob` / GET
`/v1/chat/media/:id`), never raw `<img src>`.

### 7.7 Gestures & keyboard (single owners)
Centralize in two hooks. **`useSwipeArbiter`** owns all pointer/wheel input, routing by hit-tested region + axis lock
decided in the first 12px: reply-swipe only inside a `.bubble` (`|dx|>56 && |dx|>2*|dy|`, springs back on release);
tab-swipe only on the tab strip / list background; burger only within 24px of the left edge or a rightward swipe on the
first tab. Set `overscroll-behavior-x:contain` on the app root, `touch-action:pan-y` on scrollers, and `preventDefault`
on wheel events with `|deltaX|>0` inside the message list (listener `passive:false`) so browser back-swipe never
competes. **`useChatHotkeys`** (one document-level handler consulting `activeElement` + the overlay stack): ArrowUp→edit
only when composer focused AND empty AND caret at 0; list ArrowUp/Down only when focus is in the sidebar list (roving
tabindex); Enter sends only from composer, opens only the focused list row; **Esc pops a LIFO overlay stack**
(`useEscapeStack`: call modal > peek > drawer > 3-dots > emoji picker > search-focus > close chat) so one Esc never
closes two things; Ctrl+Arrow reply-target scoped to the message list with `preventDefault`. **Every gesture has a
visible non-gesture fallback treated as primary.** Honor `useReducedMotion()` in every animated component;
`MotionConfig reducedMotion="user"` at app root; keep the CSS `prefers-reduced-motion` rule for CSS keyframes only (it
cannot tame JS motion, so do not rely on its `!important`).

### 7.8 Calls (frontend — the biggest piece; backend is complete)
Two wiring edits end the dead-calls bug: (1) add cases for the 6 call/webrtc kinds in the `useChatWebSocket` dispatcher
(currently `default: break` drops them) that re-emit onto a new typed `lib/callBus.ts`; (2) outbound signaling uses the
existing `socketBus.sendWsFrame`. A single **`useCallEngine()`** mounted at App level subscribes to `callBus` and owns
the `RTCPeerConnection` + modal (keep the dispatcher a pure router — no PC logic in it). Port sarbon
`GlobalAudioCallModal`: full-screen overlay, initial `[Video][Audio][Cancel]` prompt, **warm audio+video transceivers**
at PC creation (upgrade = `replaceTrack`, no new m-line), `tuneSdpOpus`, caller ringback + callee ringtone, mute, hang
up, speaker, minimize/PiP, camera flip (`getUserMedia` new deviceId → `replaceTrack`), screen-share (`getDisplayMedia`
→ `replaceTrack` on the warm video sender, peer notified via control DataChannel), audio→video upgrade via
**perfect-negotiation** (caller = impolite/offerer, callee = polite; callee requests, caller renegotiates), ICE restart
on `disconnected`/`failed` (`createOffer{iceRestart:true}` from caller), and reload recovery (persist `{call_id, role,
call_type}` to sessionStorage on ACTIVE; on load `GET /v1/calls/:id`; reconnect via ICE restart). Fetch
`/v1/calls/ice-servers` before every PC. On accept, fan a `call.accepted`/`call.taken` frame to the callee's OTHER
devices so their ringtone dismisses.

### 7.9 Voice & circle video-notes (port sarbon)
Voice = `MediaRecorder audio/webm;codecs=opus`; compute a deterministic waveform (`decodeAudioData` → downsample to
≤64 normalized peaks) + `duration_ms` on the client, send both as multipart fields; persist `duration_ms` on the
attachment, `waveform` in the message payload. Circle video-notes = `MediaRecorder video/webm`: square capture, canvas
selfie-mirror, mid-record camera switch via `replaceTrack` into the canvas capture stream, round CSS render, a poster
JPEG (first frame) sent as a `poster` multipart part → stored as `thumb_key`. Single-playing via IntersectionObserver.
Both ride the fieldname-based part router (§5.7).

### 7.10 Toasts & multi-device
Toasts are client-derived from the `message` kind when `sender_id!==me && conversation_id!==activeConversationId`.
Render in an `aria-live="polite"` region (never modal, never autofocus), cap the visible stack at 3 (4th collapses
oldest into "+N more"), auto-dismiss ~5s (pause on hover/focus, honor reduced-motion), **dedup by message id**, suppress
for the active conversation or a hidden tab. Click routes to the chat. Track **presence per-connection** (ref-count
sockets), suppress self-originated echoes across a user's own devices. Persist store namespaced by account id so
"Switch/Add account" doesn't leak recent searches, sidebar width, or theme across users.

### 7.11 Auth hero & adaptivity
Animated hero on the login screen: layered gradient/aurora or particle field via framer-motion, static fallback under
reduced-motion; the login card sits above it with sufficient contrast (WCAG). Breakpoints: small ≤360, medium ≤414,
large ≤480, tablet ≤768 (single-pane cutover, standardize sarbon's 767), desktop >768. Status dot: keep blue=online/
grey=offline as the visual but add a **non-color cue** (filled vs hollow ring) + `aria-label`/visually-hidden
"Online"/"Last seen …" (WCAG 1.4.1). Design language stays off AI-slop defaults — lean on the existing green accent
token, intentional typography, layered surfaces, subtle spring motion.

### 7.12 Store additions (zustand)
- **`useUiStore`** (NEW, persist, namespaced by account id): `theme`, `sidebarWidthPx`, `tabOrder`+`activeTab`,
  `recentSearches`, `reducedMotionOverride?`.
- **Extend `useChatRealtimeStore`** (ephemeral, NOT persisted): `drawerOpen`, `peekConversationId`, `toasts` (cap 3 +
  overflow), `incomingCall` (fed by the extended dispatcher), `composerMode` (replyTo/editing per conversation),
  `selectedMessageIds`, `listCursorIndex`, `overlayStack` (LIFO for Esc).

---

## 8. Phasing Plan

Ordered, independently shippable slices. Each closes with the mandatory **REVIEW (`code-review`) → TEST
(`test-driven-development`/`qa-tester`) → VERIFY (`verify`)** gate. **SECURE** (`security-and-hardening`) is added where
auth/admin/untrusted-input is touched; **A11Y** (`a11y-audit`) where the surface is user-facing UI. A slice is not done
until every non-skipped role is green and VERIFY observations are seen live.

> **Validate FIRST, before their slice:** (1) Telegram Gateway can OTP an arbitrary phone without a bot `/start`
> (prototype a real send) — else phone-first onboarding changes (D4). (2) `136092` is a test hatch, never a prod
> universal password (D2). (3) Groups add additively via the seam with zero DM-core migration — proven in Phase 1 by
> the backfill + full DM/calls regression. (4) Browser back-swipe cannot be reliably suppressed — ship the button/
> drag-handle fallback as primary (D14).

### Phase 0 — Auth hardening + real OTP + admin **[SECURE]**
Config gate first (`config/env.ts` boot invariant; split `AUTH_ACCESS_SECRET`/`AUTH_REFRESH_SECRET`). Land the
**MEDIA IDOR fix immediately** (smallest, highest-severity, independent): `MediaService.canAccess()` + 404-on-miss +
`messages_attachment_idx` + nosniff/attachment-disposition/mime-sniffing in the same PR. Add `auth_sessions`; rewrite
refresh to stateful+rotating with role re-read from DB; add `logout`/`logout-all`. Add `request-code`/`verify-code`
(reuse the `rateLimit()` plugin); mount `dev-login` ONLY under the test gate. Add `routes/admin.ts` with
`requireRole('admin')`, silent audited read handlers, `audit_log`. Seed admin from `ADMIN_PHONE`.
*Gate: validate Telegram delivery before building auth UI.*
**VERIFY:** second user cannot GET another conversation's `/media/:id` (404); revoked refresh cannot mint access;
demoted admin loses god-mode on next refresh.

### Phase 1 — Telegram-OTP auth UI + profiles + forward-compat seam **[SECURE, A11Y]**
See the self-contained build spec below (§ Phase 1 detail). Adds the profile columns (`username/bio/last_seen/telegram_*`),
`usernames` registry, the `conversations.type` + `conversation_members` seam **backfilled from DM a/b**, the animated
auth hero, phone-entry, OTP-entry, and register (name + nickname) screens, and the Profile page. **Prove all DM + calls
paths still green after the backfill** (validates the groups-are-additive assumption).

### Phase 2 — Navigation + layout **[A11Y]**
framer-motion left drawer; theme `data-theme` refactor + persist store; react-router `ShellLayout` (socket above
Outlet — verify no reconnect on nav); desktop resizable pane (2rem…60vw) vs mobile single-pane swap (sarbon
`useIsMobile`/`--app-height`/safe-area); tabs as filters (Group/Channel empty states); search (nickname/phone + recent
searches + rate-limit). Build `useSwipeArbiter` + `useChatHotkeys` + the Esc LIFO stack as the single owners.

### Phase 3 — Message UX **[A11Y]**
Reactions (emoji+text, capped, sanitized) + WS reaction event; reply + reply-to-span (snapshot); edit/delete/pin/copy/
save; message list redesign; gestures + keyboard with visible fallbacks; contract additions (`reactions`, `reply_to`,
`pinned`, `edited_at`).

### Phase 4 — Rich media **[A11Y]**
Fix `store()` metadata drop + fieldname part router FIRST, then voice + waveform and round video-notes (port sarbon
recorders + single-playing IntersectionObserver), and peek-without-receipt via the silent-read `?peek=1` path.
**VERIFY:** a peek produces no `conversation_read` WS frame and leaves unread unchanged.

### Phase 5 — Calls frontend **[SECURE-sensitive]**
`lib/callBus.ts`; the 6 dispatcher cases forwarding to callBus; `useCallEngine()` at App level; port
`GlobalAudioCallModal` (warm transceivers, `tuneSdpOpus`, ICE restart, reload-recovery, ringtones, PiP, flip,
screen-share, perfect-negotiation upgrade); fetch `ice-servers` per PC; deploy **coturn/TURN** on the VM (land before
real-world testing). Add the signaling call-membership authz check server-side (§3.9).

### Phase 6 — Toasts + multi-device
Per-connection presence ref-count; self-echo suppression; toast stack cap 3 deduped by message id; multi-account switch
(uses Phase 0 sessions). Test with two concurrent sessions for the same user.

### Phase 7 — Groups & Channels **[SECURE, A11Y]**
Additive on the Phase 1 seam: create group/channel + member endpoints; roles + per-action capability checks (channel:
only owner/admin post; group: any member posts); subscriber/member counts (maintained in-tx); N-way fanout via
`publishToConversation`; group read model (per-member cursor, "seen by N"); per-chat themes/backgrounds/notif prefs;
`usernames` for public groups/channels; global search returns is_public groups/channels. Flag large-channel push as a
known scaling ceiling requiring a broadcast queue later.

### Pre-mortem (designed-out failure causes)
1. **Auth hatch reached production** → mass takeover + admin abuse. Designed out by Phase 0: env-gated `136092`/
   dev-login, boot invariant, revocable rotating sessions, per-query admin authz + audit log.
2. **Groups bolted on as a rewrite** → DM/receipts/presence/calls regressions. Designed out by Approach B + the Phase 1
   seam; never migrate the message core; full DM+calls regression gates the Phase 7 merge.
3. **Mobile/gesture layer unusable** → churn. Designed out by the two-regime split, focus-aware gestures with visible
   fallbacks, real-device testing + A11Y gate each phase.
4. **Correctness erosion in a trust-critical app** (peek leaks receipts, media metadata lost, multi-device desync).
   Designed out by the dedicated silent-read path with a no-`conversation_read` test, persisted media metadata,
   per-connection presence + idempotent toast dedup.

### Suggested additions (not in the original spec, load-bearing for production)
Push notifications for offline users; admin audit viewer (`/v1/admin/audit`) + optional user-visible transparency;
active-sessions UI (per-device revoke); blocklist / privacy controls (who can find me by phone / call me); failed-send
retry queue + delivery states for flaky mobile networks; account deletion / data export (GDPR); moderation/report path
for free-text reactions and media; "seen by N" reader list for groups; invite links for public groups/channels; draft-
per-conversation persistence; command palette (Ctrl/Cmd+K); voice playback speed + scrubbable waveform; call-quality HUD
from `getStats()`; attachment GC (refcount by sha256 before unlink); gitleaks/env-secrets pre-commit + startup
secret-strength check.
