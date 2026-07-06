# Chat Messenger

A 1:1 real-time chat messenger with WebRTC audio/video/screen-share calling, built to the
normative spec in [`CHAT_MESSENGER_TZ.md`](./CHAT_MESSENGER_TZ.md) (single source of truth for
every REST path, WS event, envelope shape, Redis TTL, and timer).

## Monorepo layout

```
packages/contract   # shared wire types + endpoint constants + WS kind map + query keys
apps/backend        # Fastify REST + `ws` gateway + ioredis presence/typing + pg durable rows
apps/frontend       # React 19 + Vite + TanStack Query + Zustand
```

`packages/contract` is imported by **both** ends so the wire contract cannot drift.

## Architecture in one paragraph

The WebSocket is **receive-mostly**: clients only send `ping`, `typing`, `typing_stop`, and the
WebRTC signaling frames (`webrtc.offer/answer/ice`). **Every state mutation goes over REST**; the
WS just notifies the peer. Redis holds presence/typing with hard TTLs (65s / 15s); Postgres holds
durable message/call rows; call media is pure P2P (server relays only SDP + ICE). See spec §3.

## Quick start

```bash
# 1. infra (Postgres 16 + Redis 7)
cp .env.example .env
npm install
npm run infra:up

# 2. migrate the database
npm run migrate

# 3. run both apps (builds the contract first)
npm run dev
```

Backend on `http://localhost:8080`, frontend on `http://localhost:5173`.

## Load-bearing contract facts (get these wrong = broken app)

- Canonical signaling names are `webrtc.offer` / `webrtc.answer` / `webrtc.ice`
  (inbound `webrtc.candidate` accepted as an alias). Spec §9.4.
- Redis TTLs are exact: presence 65s, typing 15s, last-seen 30d. Spec §10.1.
- Every REST response is wrapped in `{status, code, description, data}`; `description` is
  server-localized by `X-Language`. Timestamps are RFC3339Nano UTC. Spec §7.
- Auth header is `X-User-Token` (backend also accepts `Authorization: Bearer`); WS auth is the
  `token` query param only (browsers can't set WS headers). Spec §7 / Q1.

## Acceptance target for this foundation slice

Two browsers: send text → single → double-gray on delivery → double-blue on read; green presence
dot ≤1s after peer connect; "typing…" appears within the throttle window and clears within 1.2s of
stop. Spec §16.
"# chat" 
