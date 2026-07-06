# Chat Messenger — Architecture Diagram Suite

> GitHub-renderable Mermaid diagrams distilled from the 5-architect design pass
> (`security-admin`, `backend-datamodel`, `realtime-calls-media`, `frontend-ux`,
> `scope-premortem`) against `SPEC-SOURCE.md`. Each section pairs a diagram with a
> short reading guide. Stack: React 19 + Vite on Vercel → Caddy TLS → Fastify + `ws`
> → Postgres + Redis, with coturn (TURN) for WebRTC and the Telegram Gateway for OTP.

---

## 1. System Architecture

The browser app is served statically from Vercel and talks to a single origin,
`https://api.asadbe.uz`, terminated by **Caddy** (TLS + request-log token redaction).
Caddy reverse-proxies both REST (`/v1/*`) and the WebSocket upgrade to one **Fastify + ws**
process on the GCP VM. Fastify owns durable state in **Postgres** (users, conversations,
messages, attachments) and volatile/real-time state in **Redis** (presence, per-user fanout
channels `chat:channel:<userId>`, OTP challenges, rate-limit buckets). Two out-of-band
integrations sit beside the API: **coturn** on the same VM relays WebRTC media when direct
STUN candidate pairs fail (~20-30% of NAT topologies), sharing the `CALLS_TURN_SECRET` HMAC
scheme; and the **Telegram Gateway** delivers login OTP codes. Media blobs are content-addressed
and access-gated per request (no public bucket) to close the IDOR surface.

```mermaid
flowchart TB
    subgraph Client["Client (browser / mobile web)"]
        UI["React 19 + Vite SPA<br/>framer-motion, hand-written CSS tokens"]
        RTC["RTCPeerConnection<br/>+ control DataChannel"]
    end

    subgraph Edge["Vercel Edge"]
        CDN["Static SPA hosting<br/>chat-nine-opal.vercel.app"]
    end

    subgraph VM["GCP VM — api.asadbe.uz"]
        Caddy["Caddy<br/>TLS termination, reverse proxy,<br/>log token redaction"]
        subgraph Fastify["Fastify + ws process"]
            REST["REST API /v1/*<br/>auth, chat, calls, media, admin"]
            WS["WS gateway<br/>signaling relay + fanout<br/>(access-token only)"]
            Guards["authGuard / requireRole('admin')<br/>requireConversationAccess"]
        end
        Coturn["coturn (TURN/STUN)<br/>3478 udp/tcp, 5349/443 turns<br/>static-auth-secret = CALLS_TURN_SECRET"]
    end

    subgraph Data["Stateful backends"]
        PG[("Postgres<br/>users, conversations, messages,<br/>attachments, sessions, audit_log")]
        Redis[("Redis<br/>presence, chat:channel:*,<br/>otp:*, rate-limit buckets")]
    end

    TG["Telegram Gateway<br/>gateway.telegram.org<br/>OTP delivery"]

    UI -->|"HTTPS load"| CDN
    UI -->|"REST /v1/* (JWT access)"| Caddy
    UI <-->|"WSS upgrade (?access token / subprotocol)"| Caddy
    Caddy --> REST
    Caddy --> WS
    REST --> Guards
    WS --> Guards
    Guards --> PG
    Guards --> Redis
    WS <-->|"PUB/SUB fanout"| Redis
    REST -->|"request-code / verify-code"| TG
    RTC <-->|"offer/answer/ICE over WSS"| WS
    RTC <-->|"relayed media when P2P fails"| Coturn
    REST -->|"GET /v1/calls/ice-servers<br/>short-lived HMAC creds"| Coturn

    classDef store fill:#1f6feb22,stroke:#1f6feb;
    classDef ext fill:#8957e522,stroke:#8957e5;
    class PG,Redis store;
    class TG,Coturn ext;
```

---

## 2. Auth / OTP Sequence

Login is phone-first. `POST /v1/auth/request-code` normalizes to E.164, enforces per-phone
and per-IP Redis rate limits, stores only `SHA-256(code)` under `otp:req:<hash>` (300s TTL),
and dispatches the code via the Telegram Gateway — always answering a uniform `code_sent` so
account existence never leaks. `POST /v1/auth/verify-code` constant-time-compares against the
stored hash **or** the ENV-gated test OTP `136092` (honored only when
`AUTH_ALLOW_TEST_OTP && NODE_ENV!=='production'`; a boot invariant refuses to start prod
otherwise). On success the code is deleted (single-use), an `auth_sessions` row is created with
a rotating `jti`, and an access/refresh token pair is minted with `role` read **from the DB**,
never from client input. A brand-new number branches into registration (name + nickname) before
landing home; the test OTP verifies the phone step only and never grants admin.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant FE as Frontend (SPA)
    participant API as Fastify API
    participant R as Redis
    participant TG as Telegram Gateway
    participant DB as Postgres

    U->>FE: Enter phone number
    FE->>API: POST /v1/auth/request-code {phone}
    API->>API: Normalize to E.164
    API->>R: Check per-phone + per-IP limits
    alt Rate limit exceeded
        API-->>FE: 429 code_send_throttled
    else Allowed
        API->>API: Generate 6-digit code
        API->>R: SET otp:req:hash {SHA256(code), attempts:0} TTL 300s
        API->>TG: Deliver code to phone
        API-->>FE: 200 code_sent (uniform, no existence leak)
    end

    U->>FE: Enter code (real or test 136092)
    FE->>API: POST /v1/auth/verify-code {phone, code, nonce}
    API->>R: GET otp:req:hash
    alt attempts >= 5
        API->>R: Invalidate key
        API-->>FE: 429 otp_too_many_attempts
    else Verify
        API->>API: constant-time compare(code) OR<br/>env-gated test OTP (non-prod only)
        alt Code invalid
            API->>R: INCR attempts
            API-->>FE: 401 otp_invalid
        else Code valid
            API->>R: DEL otp:req:hash (single-use)
            API->>DB: getOrCreateByPhone(phone)
            alt New number (no account)
                API-->>FE: needs_registration
                U->>FE: Enter name + nickname
                FE->>API: POST /v1/auth/register {name, nickname}
                API->>DB: INSERT user (role='user')
            end
            API->>DB: Read role; INSERT auth_sessions {jti, family_id}
            API-->>FE: 200 {access (5-15m), refresh (rotating)}
            FE->>U: Home page
        end
    end

    note over API,DB: Later — refresh is stateful: verify jti not revoked,<br/>rotate (reuse ⇒ revoke family), re-read role from DB.
```

---

## 3. Call + WebRTC Lifecycle

The backend call REST stack (create/accept/decline/cancel/end + 30s ring sweep) is complete;
the frontend `useCallEngine()` drives the state machine below, fed by a typed `callBus`. Call
**lifecycle** transitions travel over REST; only `offer`/`answer`/`ice` travel over WSS, relayed
by the gateway after a call-membership check. Transceivers for both audio and video are warmed at
PeerConnection creation so an audio→video upgrade is a `replaceTrack` (no glare); the caller is the
impolite offerer under perfect-negotiation. In-call controls (mute, screen-share, camera flip,
upgrade request) ride an `RTCDataChannel`, not new WS frames. ICE failure triggers an ICE-restart
offer; a reload rehydrates an active call from `sessionStorage` + `GET /v1/calls/:id`.

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> Dialing: user starts call (Video/Audio)
    Idle --> Incoming: call.invite received

    Dialing --> Connecting: callee accepts (call.accepted)
    Dialing --> Ended: callee declines / cancel / 30s timeout (MISSED)

    Incoming --> Connecting: accept -> dismiss other devices (call.taken)
    Incoming --> Ended: decline / caller cancels

    state Connecting {
        [*] --> Signaling
        Signaling --> ICE: SDP offer/answer exchanged (WSS)
        ICE --> Media: candidate pair selected (STUN/TURN)
        Media --> [*]
    }

    Connecting --> Connected: iceConnectionState = connected
    Connecting --> Ended: signaling/ICE failure

    state Connected {
        [*] --> Active
        Active --> Active: replaceTrack (audio to video upgrade)
        Active --> Active: DataChannel control (mute / screenshare / camera)
        Active --> Reconnecting: ice disconnected/failed
        Reconnecting --> Active: createOffer iceRestart:true
        Reconnecting --> Recovering: page reload
        Recovering --> Active: sessionStorage + GET /v1/calls/:id
    }

    Connected --> Ended: hang up / peer ends / fatal ICE fail
    Ended --> [*]
```

---

## 4. Data-Model ERD

The recommended model keeps a **single polymorphic `conversations`** table
(`type ∈ dm | group | channel | saved`) rather than separate group/channel tables, so every
downstream table keys off one `conversation_id`. `conversation_members` is the per-user spine:
role, read cursor, unread count, archive/pin/mute, and clear-history cursor. DM rows keep the
legacy `user_a_id/user_b_id` fast-path (nullable, unique only `WHERE type='dm'`). Media
(`attachments`) is content-addressed by `sha256` and deduped globally, so authorization is on the
**message↔conversation edge**, never the attachment row. `auth_sessions` makes refresh tokens
revocable/rotating; the `otp` challenge state is short-lived (mirrored in Redis but shown here as
the durable contract). Reactions, pins, and per-chat settings hang off messages/conversations.

```mermaid
erDiagram
    users ||--o{ conversation_members : "belongs to"
    users ||--o{ messages : "sends"
    users ||--o{ auth_sessions : "owns"
    users ||--o{ message_reactions : "reacts"
    users ||--o{ conversation_settings : "customizes"
    users ||--o| conversations : "owns (group/channel)"

    conversations ||--o{ conversation_members : "has"
    conversations ||--o{ messages : "contains"
    conversations ||--o{ message_pins : "pins"
    conversations ||--o{ conversation_settings : "per-user prefs"

    messages ||--o{ message_reactions : "receives"
    messages ||--o| message_pins : "pinned as"
    messages ||--o| attachments : "references (payload.attachment_id)"
    messages ||--o| messages : "reply_to / forwarded_from"

    users {
        uuid id PK
        text phone UK "E.164, login id"
        citext username UK "@handle (nullable)"
        text name
        text bio
        text role "user | admin"
        timestamptz last_seen_at
        timestamptz created_at
    }

    conversations {
        uuid id PK
        text type "dm | group | channel | saved"
        uuid user_a_id FK "DM fast-path (nullable)"
        uuid user_b_id FK "DM fast-path (nullable)"
        uuid owner_id FK "group/channel"
        text title
        citext username UK "public @handle"
        boolean is_public
        int member_count
        timestamptz created_at
    }

    conversation_members {
        uuid conversation_id PK,FK
        uuid user_id PK,FK
        text role "owner | admin | member | subscriber"
        uuid last_read_message_id "read cursor"
        int unread_count
        boolean notifications_enabled
        boolean is_archived
        boolean is_pinned
        timestamptz cleared_before "clear-history cursor"
    }

    messages {
        uuid id PK
        uuid conversation_id FK
        uuid sender_id FK
        text body
        jsonb payload "attachment_id, links, waveform"
        uuid reply_to_message_id FK
        text quote_text "snapshot for span reply"
        timestamptz edited_at
        timestamptz created_at
    }

    attachments {
        uuid id PK
        text sha256 UK "content address, global dedup"
        text kind "image | voice | video | file"
        text mime
        bigint size_bytes
        int duration_ms "voice/video"
        int width
        int height
        text thumb_key
    }

    message_reactions {
        uuid id PK
        uuid message_id FK
        uuid user_id FK
        text kind "emoji | text"
        text reaction_key UK "unique per (msg,user,key)"
        timestamptz created_at
    }

    message_pins {
        uuid conversation_id PK,FK
        uuid message_id PK,FK
        uuid pinned_by FK
        timestamptz pinned_at
    }

    conversation_settings {
        uuid user_id PK,FK
        uuid conversation_id PK,FK
        jsonb theme "primary, bg"
        text background_attachment_id
        boolean muted
    }

    auth_sessions {
        uuid id PK
        uuid user_id FK
        text jti UK "hashed refresh id"
        uuid family_id "rotation family"
        timestamptz revoked_at
        inet ip
        timestamptz expires_at
    }

    otp {
        text phone_hash PK "SHA(phone)"
        text code_hash "SHA(code)"
        int attempts "cap 5"
        timestamptz expires_at "300s TTL"
    }
```

---

## 5. Message + Media Flow

Text messages validate against a schema (body ≤4096, whitelisted payload keys, server-built
links) and persist directly. Rich media — voice notes (`audio/webm;opus` + deterministic ≤64-bar
waveform + `duration_ms`) and round video-notes (square capture + poster frame) — upload as
multipart, routed **by fieldname** (`file/media/voice/video` → primary blob, `poster/thumb` →
thumbnail) so the poster is no longer dropped. `MediaService.store()` content-addresses by sha256
(dedup), sniffs the real MIME server-side, and persists metadata. Fanout is per-member via
`publishToConversation` (N=2 for DMs, looped members for groups; online-only push + fanout-on-read
for large channels). Every media **render** goes back through the auth-gated blob route
(`canAccess` join, 404 on miss, `nosniff` + attachment disposition), never a raw public URL.

```mermaid
flowchart TD
    Start(["User composes"]) --> Kind{Message kind?}

    Kind -->|Text| TVal["Schema validate<br/>body <= 4096, whitelist payload,<br/>server builds links"]
    Kind -->|Voice| VCap["MediaRecorder audio/webm;opus<br/>+ waveform (<=64 bars) + duration_ms"]
    Kind -->|Circle video-note| CCap["MediaRecorder video/webm<br/>square capture + poster JPEG"]

    VCap --> Up["POST multipart upload"]
    CCap --> Up
    Up --> Route["Route parts by FIELDNAME<br/>file/media/voice/video -> primary<br/>poster/thumb -> thumbnail"]
    Route --> Store["MediaService.store()<br/>sha256 dedup, server MIME sniff,<br/>persist duration/w/h/thumb_key"]
    Store --> ARow[("attachments row")]
    ARow --> MRef["Message payload gets attachment_id<br/>+ waveform (presentation)"]

    TVal --> Persist
    MRef --> Persist["INSERT message (Postgres)<br/>increment per-member unread"]

    Persist --> Fan["publishToConversation(convId)"]
    Fan --> DM{Conversation type?}
    DM -->|DM / group| PerMember["publishToUser per member<br/>chat:channel:userId (multi-device)"]
    DM -->|Large channel| Broadcast["online-only push<br/>+ fanout-on-read (pull history)"]

    PerMember --> Deliver["WS frame to online sockets"]
    Broadcast --> Deliver
    Deliver --> Render["Client dispatcher upserts cache"]

    Render --> Media{Has media?}
    Media -->|Yes| Blob["GET /v1/chat/media/:id<br/>canAccess join, 404 on miss,<br/>nosniff + attachment disposition"]
    Media -->|No| Show["Render bubble<br/>(escape untrusted body)"]
    Blob --> Show
    Show --> Toast["If not active convo:<br/>toast stack (cap 3, dedupe by msg id)"]
```

---

## 6. Responsive Layout Map

Layout is **two regimes split by one breakpoint** (~768px), never one resizable mechanism forced
onto both. A persistent `ShellLayout` route mounts the WS socket, stores, and gesture arbiter
**above** the router outlet, so navigating between chats and overlay routes (`/menu`, `/me`,
`/settings`, `/saved`) never remounts the socket. On **desktop**, the shell is a resizable
two-pane grid (`--sidebar-w`, clamped 2rem…60vw via a keyboard-operable `role="separator"` handle);
below ~72px the list collapses to an avatar-only rail. On **mobile**, the same routes drive a
single pane that swaps list ⇄ thread (the resize handle is disabled). Overlays — burger drawer,
peek modal, 3-dots menu, toasts, call modal — render as framer-motion layers governed by a shared
LIFO overlay stack so one `Esc` closes exactly one layer.

```mermaid
flowchart TD
    Root["ShellLayout (persistent)<br/>WS socket + stores + gesture arbiter<br/>ABOVE router outlet"] --> BP{Viewport width?}

    BP -->|"> 768px — Desktop / tablet"| Desk
    BP -->|"<= 768px — Phone"| Mob

    subgraph Desk["Desktop: resizable two-pane"]
        DGrid["grid-template-columns:<br/>var(--sidebar-w) 1fr"]
        DGrid --> DList["Left: chat list<br/>tabs (All/Private/Group/Channel),<br/>search, burger"]
        DGrid --> DHandle["Resize handle<br/>role=separator, Arrow/Home/End,<br/>clamp 2rem..60vw"]
        DGrid --> DThread["Right: thread<br/>or 'select a chat' empty state"]
        DHandle -.->|"width <= 72px"| DRail["List collapses to<br/>avatar-only icon rail<br/>(aria-label preserved)"]
    end

    subgraph Mob["Mobile: single-pane route swap"]
        MRoute{Current route?}
        MRoute -->|"/"| MList["List pane<br/>(no resize handle)"]
        MRoute -->|"/c/:id"| MThread["Thread pane<br/>--app-height + safe-area insets"]
        MList -->|"open chat"| MThread
        MThread -->|"back"| MList
    end

    Desk --> Overlays
    Mob --> Overlays

    subgraph Overlays["framer-motion overlay layers (LIFO Esc stack)"]
        direction LR
        Drawer["Burger drawer<br/>(/menu)"]
        Peek["Peek modal<br/>(silent read, no receipt)"]
        Menu["3-dots menu"]
        ToastL["Toast stack (cap 3)"]
        CallM["Call modal (fullscreen)"]
    end

    Overlays --> Esc["Esc pops topmost only:<br/>call > peek > drawer > menu > search"]
```
