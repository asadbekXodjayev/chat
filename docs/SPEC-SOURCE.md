# Chat Messenger — Evolution Spec (source of truth, captured from user)

> Raw + structured capture of ALL requirements given across the session. This is the input
> to the pressure-test/design pass and the eventual Technical Specification + diagrams.
> Existing stack: TS+Fastify backend (GCP VM, Caddy TLS `https://api.asadbe.uz`) + React 19 + Vite
> frontend (Vercel `chat-nine-opal.vercel.app`), monorepo w/ shared `@chat/contract`. Postgres + Redis.
> Styling decision: KEEP hand-written CSS token system (index.css); add **framer-motion** for animation.
> Reference to mirror (port-and-adapt): `C:/Users/hp/Desktop/sarbon-frontend-main` (complete WebRTC
> calls, voice messages w/ waveform, round video-notes, phone+OTP auth, mobile-adaptive patterns).

## 0. Global
- Adaptive/responsive for ALL screen sizes (small/medium/large phones → desktop). WSS must work flawlessly.
- Animation via **framer-motion** (smooth drawer open/close, transitions, hero).
- Security is first-class throughout (auth, per-user data isolation, media access, admin scope).

## 1. Auth (login / registration)
- Entry screen has a **cool animated hero**.
- **Login by phone number.**
  - If an account already exists for this number → send **OTP to Telegram** (via `@VerificationCodes` —
    to confirm: Telegram Gateway `gateway.telegram.org` vs a bot) → on OTP success → log in.
  - If new number → **register** → collect **name, nickname** → then home page.
- **Universal / test OTP `136092`** always verifies (test hatch).
- **Admin account:** phone `+99899…` (format TBC) with OTP `136092`. Admin can **see every conversation
  of every user and every message** (god-mode read). Regular users see ONLY their own conversations.
  Must be secure (server-side authorization, never client-trusted).

## 2. User / profile model (Telegram-like)
- Fields: unique **id**, **name** (display), **nickname/username** (UNIQUE @handle), **phone** (unique,
  login identifier), **profile image**, plus essential data (bio, last-seen, created_at, telegram link).
- **Profile page** replaces the current bottom-left name+phone `div`.

## 3. Left navigation drawer (Telegram burger menu)
- **Top-left burger icon** opens a **left slide-in sidebar** with very smooth framer-motion animation.
- Contents: **Profile** (header: avatar+name+phone), **New Group**, **New Channel**, **Contacts**,
  **Calls**, **Saved** (Saved Messages / self-chat), **Settings**, **Switch profile / Add account**,
  **Night / Light theme** toggle.

## 4. Home / chat list (left panel)
- Left = chats list + right = "select a chat" screen (already exists).
- **Resizable left panel**: min **2rem** (only rounded profile pics visible) → max **60% of screen**.
- **Sections/tabs**: All, Private (users), Group, Channel. Tab order **changeable, add/remove**.
- Per-chat actions: **delete, archive** (for now).
- **Press-and-hold a chat's profile pic → peek modal** showing the messages inside, WITHOUT sending a
  read receipt (read silently; the other user is NOT notified you saw it).
- Profile pic has a small **status dot**: online → blue, offline → grey (as now).
- Top of chats section: **burger icon** + **search bar**.
  - Search by **nickname or phone number**. On focus, chat list is replaced by **recent searches**
    (previously searched profiles/chats, each deletable). Results update **per keystroke**.
  - Search has sections too: All, Users, Group, Channel.

## 5. Chat / message view
- Clicking a chat opens a **slug route** keyed by nickname (or id if no nickname).
- **Top bar**: left = nickname + last seen (group/channel → member/subscriber count); right =
  **search-in-chat** icon + **call** button (users only).
- **Call modal (full-screen, Telegram-like):** first prompt = [Video call] [Audio call] [Cancel];
  during an audio call you can **switch on video**; plus **screen-share, mute mic, hang up**, and other
  essentials (speaker, minimize/PiP, camera flip, ringtone, reconnect).
- **3-dots menu:** notifications on/off, open profile, set custom theme colors, background images, info,
  clear history (for me / for both), delete chat.
- **Message list UI** needs work (functional today).
- **My messages:** edit, delete, copy, pin, reply, **reply to a specific text span** within a message.
- **Partner messages:** select, pin, save, delete.
- **Reactions (all messages):** emoji OR text reactions; **multiple** allowed; each has a **counter**.
- **Voice messages** + **circle (round video-note) messages** (port from sarbon).
- **New-message toast:** small modal top-right, **max 3** stacked.

## 6. Interactions / gestures / keyboard
- Reply: **two-finger reverse swipe** (trackpad) OR drag-swipe toward opposite side.
- **Arrow Up** → edit; edit specific message (move up/down).
- **Ctrl + Arrow Up/Down** → reply to a specific message.
- **Esc** → close the message section.
- In the chat-tabs section: **drag/two-finger swipe → toggle tabs**.
- On home (or past the last tab): **drag/two-finger swipe left → open burger menu**.
- In chat list: **Arrow Up/Down** selects chats, **Enter** opens.

## 7. Security rules (explicit)
- Admin (`+99899…` / OTP `136092`) reads all conversations + messages.
- Regular users read only their own conversations/messages/media. Enforce server-side.
- "Make it secure in any way" — validate input, authorize every read/write, protect media, rate-limit,
  protect the 136092/admin hatch, no client-trust for scope.

## 8. Known flaws / ambiguities to RESOLVE during pressure-test
- Admin phone `+99899` — exact format (full E.164 vs prefix)? Is `136092` admin-only or universal-for-all?
- `@VerificationCodes` delivery — Telegram Gateway (by phone, no bot start) vs a bot (needs /start + contact link)?
- **Groups & Channels** are NOT in the current 1:1 backend — this is a MAJOR data-model + authz expansion
  (membership, roles, subscriber counts, broadcast permissions). Confirm full build vs phased.
- **Peek-without-read-receipt** vs the existing read-receipt/double-blue feature — privacy/consistency design.
- Gesture conflicts (two-finger swipe reply vs browser back/nav; arrow keys vs input focus).
- Resizable panel min 2rem vs mobile single-pane layout — how they coexist.
- Reactions with BOTH emoji and free text + counters — data model + WS fanout.
- Reply-to-specific-text-span — how a sub-range of a message is referenced/stored/rendered.
- Custom per-chat themes/backgrounds + notification prefs — per-user per-conversation settings storage.
- Saved Messages = self-conversation; Contacts model; recent-searches storage (client vs server).
- Multi-device + the toast/new-message modal interplay with WS.
