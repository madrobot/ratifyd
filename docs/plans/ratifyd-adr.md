# Architecture Decision Record — Ratifyd

**Project:** Ratifyd  
**Company:** Tenthbyte  
**Domain:** `ratifyd.io` (TBD)  
**Status:** Active / In Design  
**Last Updated:** 2026-03-21

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Product Decisions](#2-product-decisions)
3. [Technology Stack](#3-technology-stack)
4. [Application Architecture](#4-application-architecture)
5. [Room & Session Model](#5-room--session-model)
6. [Identity, RBAC & Security](#6-identity-rbac--security)
7. [Real-Time Sync](#7-real-time-sync)
8. [Frontend & Hosting](#8-frontend--hosting)
9. [Tooling Integrations](#9-tooling-integrations)
10. [Data Persistence & Ephemerality](#10-data-persistence--ephemerality)
11. [Future Commercial Considerations](#11-future-commercial-considerations)
12. [Decisions Log (Summary Table)](#12-decisions-log-summary-table)

---

## 1. Project Overview

Ratifyd is an open-source, ephemeral, browser-based technical interviewing platform. It provides a shared workspace for interviewers and candidates to collaborate in real time using a whiteboard and code editor — with no login, no mandatory backend, and no persistent server-side storage.

The name "Ratifyd" is derived from "ratified" — past tense, implying a verdict has been reached. The stylized drop of the "e" follows established startup naming conventions (Flickr, Tumblr). The terminal "d" is an intentional nod to Unix/Linux daemon naming conventions (`ratifyd` as a background process quietly validating candidates). It is pronounced "ratified."

### Goals

- Zero-friction session setup — a single button press creates a room
- No accounts, no login for any party
- Real-time collaboration across whiteboard and code editor
- Cryptographically enforced role-based access control, client-side only
- Replay-attack-resistant peer admission without a server
- End-to-end encrypted moderator notes and chat — opaque to guests even at the Yjs layer
- Fully static deployable — no server required for the OSS version
- Tab-refresh resilience

### Non-Goals (OSS Version)

- Code execution on a server
- Session recording or replay
- Persistent session history
- Authentication / SSO
- TURN server operation

---

## 2. Product Decisions

### 2.1 Name

**Decision:** Ratifyd  
**Rationale:** Clean, minimal, one-word. Carries authoritative connotation aligned with the interview evaluation context. The primary audience is tech companies evaluating software engineering, DevOps, and ML candidates — the name reads as professional without being tech-literal. Competitor names (Vetted, Cleared, Proven) were considered; Ratifyd was selected for its stronger sense of finality and the daemon naming easter egg appealing to technical audiences.

### 2.2 Landing Page Room Creation

**Decision:** Room creation is triggered explicitly by a button press on the landing page, not on page load.  
**Rationale:** Cleaner UX — the user consciously initiates a session. Cleaner code — no ambiguity around when keypair generation, room ID minting, and redirects should fire. Avoids accidental room creation on back-navigation or stale tab reloads.

### 2.3 Roles

Three roles are defined:

| Role        | Who                                    | Capabilities                                                                                  |
| ----------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `owner`     | Room creator — exactly one per session | Admits all peers. Mints JWTs. Distributes room key. Full sidebar access (notes + chat).       |
| `moderator` | Invited interviewers                   | Mints JWTs. Full sidebar access. Cannot admit peers. Cannot distribute room key.              |
| `guest`     | Interviewee (candidate)                | Whiteboard + code editor only. No sidebar. Cannot invite others. Never receives the room key. |

**Rationale for owner role:** separating the owner from moderators eliminates admission race conditions (only one peer ever calls `evaluateAdmission`), simplifies the Yjs sync gate requirement (only the owner's state needs to be fully synced before admission runs), and provides a clean anchor for room key distribution. If the owner disconnects, new peers cannot be admitted until they reconnect — acceptable given the owner is the session's root of trust.

**No login is required for any role.**

### 2.4 Ephemerality

**Decision:** Sessions are ephemeral. No server-side persistence of session state.  
**Rationale:** Simplicity. The OSS version is designed to run entirely client-side. Session state lives in the Yjs document, synced P2P and persisted locally via IndexedDB for tab-refresh resilience only. When all peers disconnect, the session is gone.

### 2.5 Moderator Sidebar

**Decision:** Owners and moderators have a persistent sidebar containing two panels: a markdown notes editor and an in-app moderator-only chat. Guests do not see the sidebar.

**Rationale:** Notes and chat are persistent companion tools — moderators need them visible alongside the main workspace. The sidebar is never rendered for guests. Its Yjs-stored content is AES-GCM encrypted, making it opaque to guests even if they inspect the raw Yjs document.

---

## 3. Technology Stack

| Concern                     | Decision                                               | Alternatives Considered                         | Rationale                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework                   | **Vite + React**                                       | Next.js                                         | No SSR, no API routes, no SEO requirements. Next.js adds friction with GitHub Pages static export. Vite is faster and zero-config for a pure SPA.                                                        |
| Whiteboard                  | **Excalidraw**                                         | tldraw, Whitebophir                             | Embeddable React component (MIT), built-in collaboration hooks, Yjs-compatible. Covers both whiteboard and diagramming.                                                                                  |
| Diagramming                 | ~~diagrams.net~~ **Dropped**                           | diagrams.net / draw.io                          | Excalidraw covers the use case and eliminates iframe/postMessage complexity.                                                                                                                             |
| Code Editor                 | **Monaco Editor**                                      | CodeMirror 6                                    | VS Code engine, syntax highlighting, optional LSP, first-class `y-monaco` binding.                                                                                                                       |
| Moderator Notes Renderer    | **react-markdown + remark-gfm + rehype-raw**           | MDXEditor, @uiw/react-md-editor                 | Most composable over Y.Text. remark-gfm adds GFM. rehype-raw enables native `<details>`/`<summary>` collapsibles.                                                                                        |
| Collapsible Sections        | **Native HTML `<details>`/`<summary>` via rehype-raw** | remark-collapse plugin                          | Zero extra packages. Familiar GitHub markdown syntax.                                                                                                                                                    |
| Moderator Chat              | **Custom Y.Array-backed implementation**               | @chatscope/chat-ui-kit-react, stream-chat-react | Append-only log maps perfectly to Y.Array. SaaS SDKs require their own backend. ~50 lines of React.                                                                                                      |
| Real-time sync (data layer) | **Yjs** (CRDT)                                         | plain WebSocket relay, ShareDB                  | Handles concurrent edits without a coordinating server. Bindings for Monaco and Excalidraw.                                                                                                              |
| Real-time sync (transport)  | **y-webrtc**                                           | y-websocket, y-dat                              | P2P via WebRTC data channels. Stateless signaling server only for WebRTC bootstrap.                                                                                                                      |
| Local persistence           | **y-indexeddb**                                        | localStorage                                    | Tab-refresh resilience via IndexedDB.                                                                                                                                                                    |
| Identity & JWT signing      | **RSASSA-PKCS1-v1_5, 2048-bit** via Web Crypto         | External JWT/crypto libraries                   | Native browser API. One keypair per peer — dual purpose: JWT signing (moderators/owner) + nonce identity proof (all peers).                                                                              |
| Room key distribution       | **RSA-OAEP, 2048-bit** via Web Crypto                  | ECDH key agreement                              | Asymmetric encryption of the AES-GCM room key. One OAEP keypair per owner/moderator. Guests have no OAEP keypair. RSA-OAEP is a separate algorithm from signing — key usages do not overlap.             |
| Content encryption          | **AES-GCM, 256-bit** via Web Crypto                    | ChaCha20-Poly1305, none                         | Symmetric encryption of moderatorNotes and moderatorChat before writing to Yjs. One room key per session, generated by owner, distributed to moderators on admission. Guests never receive the room key. |
| JWT format                  | **Standard JWT** (RS256)                               | custom token format, PASETO                     | Widely understood. Signed with RSA signing private key via Web Crypto.                                                                                                                                   |
| Signaling (OSS)             | **`wss://signaling.yjs.dev`** (public)                 | self-hosted y-webrtc-signaling                  | Stateless, free, never sees document content. Commercial version self-hosts.                                                                                                                             |
| Hosting                     | **GitHub Pages**                                       | Cloudflare Pages, Netlify                       | Free, static, zero-config for OSS.                                                                                                                                                                       |
| Build tool                  | **Vite**                                               | CRA, Webpack, Parcel                            | Fastest dev iteration. Native ESM.                                                                                                                                                                       |

---

## 4. Application Architecture

### 4.1 High-Level Diagram

```
Browser (Owner — room creator)
├── Landing page → "Start Session" button
├── Generates RSA signing keypair  → localStorage (privKey never leaves browser)
├── Generates RSA-OAEP keypair     → localStorage (privKey never leaves browser)
├── Generates AES-GCM room key     → localStorage (never transmitted to guests)
├── Generates roomId (UUID) + ownerId (UUID)
├── Self-issues owner JWT, self-admits
├── Redirects to /#token={jwt}     ← NO pubkeys in URL, ever
│
├── Yjs Document (shared state, moderatorNotes + moderatorChat ENCRYPTED)
│   ├── trustedSigningKeys: Y.Map  { peerId → base64 signing pubkey }
│   ├── burnedJTIs:         Y.Map  { jti → base64 signing pubkey }
│   ├── admittedPeers:      Y.Map  { peerId → { role, admittedAt } }
│   ├── moderatorChat:      Y.Array[ { id, senderId, senderLabel, iv, ciphertext } ]
│   ├── moderatorNotes:     Y.Map  { iv, ciphertext }   ← AES-GCM encrypted blob
│   └── roomState:          Y.Map
│       ├── editorContent   Y.Text
│       ├── editorLanguage  Y.Map  { lang: string }
│       └── excalidrawState Y.Map  { elements: JSON string }
│
├── y-webrtc provider ──── WebRTC (DTLS encrypted) ────► peers
└── y-indexeddb provider ──► IndexedDB resilience

Browser (Invited Moderator)
├── Arrives via /#token={jwt}
├── Generates RSA signing keypair  → localStorage
├── Generates RSA-OAEP keypair     → localStorage
├── Connects → two-round handshake with owner only
├── On admission: receives AES-GCM room key (RSA-OAEP wrapped by owner)
└── Decrypts room key → localStorage

Browser (Guest)
├── Arrives via /#token={jwt}
├── Generates RSA signing keypair  → localStorage (for nonce proof only)
├── No OAEP keypair. No room key. Ever.
└── Connects → two-round handshake with owner only

Signaling Server (stateless)
└── Brokers WebRTC bootstrap only. Never sees content.
    OSS: wss://signaling.yjs.dev
    Commercial: self-hosted
```

### 4.2 URL Structure

Everything in the **URL fragment (`#`)** — never query params or path. Fragments are never sent in HTTP requests; tokens are server-blind.

**Public keys are never in the URL for any role.** They travel exclusively over the DTLS-encrypted WebRTC data channel during the admission handshake.

| User                  | URL Shape                |
| --------------------- | ------------------------ |
| Owner (post-creation) | `/#token={ownerJWT}`     |
| Invited moderator     | `/#token={moderatorJWT}` |
| Invited guest         | `/#token={guestJWT}`     |

### 4.3 UI Layout by Role

**Owner / Moderator layout:**

```
┌──────────────────────────────────┬─────────────────────┐
│  Main Area (tabs)                │  Sidebar            │
│  [ Whiteboard ] [ Code ]         │  [ Notes ][ Chat ]  │
│                                  │                     │
│  <active panel content>          │  <encrypted content>│
├──────────────────────────────────┴─────────────────────┤
│  Header: Ratifyd  |  [Add Moderator]  [Add Guest]      │
└────────────────────────────────────────────────────────┘
```

**Guest layout:**

```
┌────────────────────────────────────────────────────────┐
│  Main Area (tabs)                                      │
│  [ Whiteboard ] [ Code ]                               │
│                                                        │
│  <active panel content>                                │
├────────────────────────────────────────────────────────┤
│  Header: Ratifyd — Interview Session                   │
└────────────────────────────────────────────────────────┘
```

| Panel                                | Owner     | Moderator | Guest |
| ------------------------------------ | --------- | --------- | ----- |
| Whiteboard (Excalidraw)              | ✅        | ✅        | ✅    |
| Code Editor (Monaco)                 | ✅        | ✅        | ✅    |
| Sidebar — Notes (encrypted markdown) | ✅        | ✅        | ❌    |
| Sidebar — Chat (encrypted)           | ✅        | ✅        | ❌    |
| Add Moderator button                 | ✅        | ✅        | ❌    |
| Add Guest button                     | ✅ (once) | ✅ (once) | ❌    |
| Admits peers                         | ✅ only   | ❌        | ❌    |
| Distributes room key                 | ✅ only   | ❌        | ❌    |

---

## 5. Room & Session Model

### 5.1 Room Creation Flow

```
1. User lands on ratifyd.io
2. User clicks "Start Session"
3. Client generates:
   a. RSA signing keypair (RSASSA-PKCS1-v1_5, 2048-bit, SHA-256)
      → private key: localStorage  (never transmitted)
      → public key:  localStorage  (transmitted over DTLS WebRTC only)
   b. RSA-OAEP keypair (RSA-OAEP, 2048-bit, SHA-256)
      → private key: localStorage  (never transmitted)
      → public key:  localStorage  (transmitted over DTLS WebRTC during admission)
   c. AES-GCM room key (256-bit)
      → localStorage  (never transmitted to guests; wrapped for moderators on admission)
   d. roomId  (UUID v4)
   e. ownerId (UUID v4 — permanent identity for this owner)
   f. Self-issued owner JWT:
      {
        "room": "<roomId>",
        "role": "owner",
        "iss":  "<ownerId>",
        "jti":  "<UUID>",
        "iat":  <now>,
        "exp":  <now + 86400>
      }
      Signed with own RSA signing private key (RS256)
4. Self-admit:
   - trustedSigningKeys.set(ownerId, ownSigningPubKey)
   - burnedJTIs.set(jti, ownSigningPubKey)
   - admittedPeers.set(ownerId, { role: 'owner', admittedAt: now })
5. Redirect to /#token={jwt}
```

### 5.2 Inviting Participants

Any owner or moderator can mint invite JWTs. Only the owner admits peers and distributes the room key.

**Add Moderator:**

```
1. Click "Add Moderator"
2. Mint JWT: { room, role: "moderator", iss: myId, jti: <UUID>, exp: now+24h }
3. Sign with own RSA signing private key
4. Invite URL: /#token={jwt}    ← no pubkeys in URL
```

**Add Guest** (once per session):

```
1. Click "Add Guest"
2. Mint JWT: { room, role: "guest", iss: myId, jti: <UUID>, exp: now+24h }
3. Sign with own RSA signing private key
4. Invite URL: /#token={jwt}
```

### 5.3 JWT Payload Schema

```json
{
  "room": "550e8400-e29b-41d4-a716-446655440000",
  "role": "owner | moderator | guest",
  "iss": "issuerId-uuid",
  "jti": "unique-invite-uuid",
  "iat": 1710000000,
  "exp": 1710086400
}
```

**Token lifetime:** 24 hours. Hard session boundary enforced on all admission paths including reconnection.

---

## 6. Identity, RBAC & Security

### 6.1 Design Philosophy

This is a **self-sovereign PKI** design. The owner is the root of trust and the sole admitter. All cryptographic operations run in the browser via the Web Crypto API. No auth server.

**Key hierarchy:**

| Keypair / Key       | Type              | Who holds it            | Purpose                                                    |
| ------------------- | ----------------- | ----------------------- | ---------------------------------------------------------- |
| RSA signing keypair | RSASSA-PKCS1-v1_5 | All peers               | JWT signing (owner/moderator) + nonce identity proof (all) |
| RSA-OAEP keypair    | RSA-OAEP          | Owner + moderators only | Receiving the AES-GCM room key from owner                  |
| AES-GCM room key    | AES-GCM 256-bit   | Owner + moderators only | Encrypting/decrypting moderatorNotes and moderatorChat     |

Guests hold only a signing keypair. They never receive an OAEP keypair or the room key. The room key never appears in Yjs, in any URL, or in any WebRTC message addressed to a guest.

### 6.2 Key Management

**RSA Signing Keypair (all peers):**

| Aspect        | Detail                                                                             |
| ------------- | ---------------------------------------------------------------------------------- |
| Algorithm     | RSASSA-PKCS1-v1_5, 2048-bit, SHA-256                                               |
| Who generates | All peers on first load                                                            |
| Private key   | `localStorage: ratifyd:sign:priv:{peerId}` — never transmitted                     |
| Public key    | `localStorage: ratifyd:sign:pub:{peerId}` — transmitted over DTLS during handshake |
| Purpose       | JWT signing (owner/moderators); nonce signature for identity proof (all peers)     |

**RSA-OAEP Keypair (owner + moderators only):**

| Aspect        | Detail                                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| Algorithm     | RSA-OAEP, 2048-bit, SHA-256                                                       |
| Who generates | Owner at room creation; moderators on first load                                  |
| Private key   | `localStorage: ratifyd:oaep:priv:{peerId}` — never transmitted                    |
| Public key    | `localStorage: ratifyd:oaep:pub:{peerId}` — sent to owner in Round 1 of handshake |
| Purpose       | Receiving the AES-GCM room key encrypted by the owner                             |

**AES-GCM Room Key (owner + moderators only):**

| Aspect            | Detail                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Algorithm         | AES-GCM, 256-bit                                                                                         |
| Generated by      | Owner at room creation                                                                                   |
| Owner storage     | `localStorage: ratifyd:roomkey:{roomId}`                                                                 |
| Distribution      | Owner wraps with each moderator's RSA-OAEP public key; sends wrapped key in admission response (Round 4) |
| Moderator storage | Received, unwrapped with own OAEP private key, stored: `localStorage: ratifyd:roomkey:{roomId}`          |
| Guest access      | Never. Guests have no OAEP keypair and receive no room key.                                              |
| Reconnect         | Room key already in localStorage — not re-sent on reconnection                                           |

### 6.3 Admission Protocol — Owner-Only, Two-Round Handshake

**Only the owner runs peer admission.** Moderators do not verify incoming peers. This eliminates race conditions between moderators competing to admit the same peer, and confines the Yjs sync gate requirement to the owner's browser only.

If the owner is offline when a new peer arrives, the peer waits in a lobby screen until the owner reconnects.

**Round 1 — Peer → Owner:**

```
{
  jwt,
  signingPubKey,           ← transmitted over DTLS WebRTC, never in URL
  oaepPubKey               ← only present for moderator-role peers; omitted for guests
}
```

**Round 2 — Owner → Peer:**

```
{ nonce }   ← cryptographically random bytes, freshly generated per attempt
```

The owner issues the nonce. Verifier-issued nonce is the replay-prevention mechanism — a captured handshake cannot be replayed.

**Round 3 — Peer → Owner:**

```
{ sig = sign(nonce, signingPrivateKey) }
```

**Round 4 — Owner evaluates and responds:**

_Path A — First Admission (JTI not in burnedJTIs):_

```
1. Look up issuer: issuerSigningPubKey = trustedSigningKeys.get(jwt.iss)
   (owner's own key for moderator-issued JWTs; owner's key for guest JWTs)
2. Verify JWT signature against issuerSigningPubKey
3. Verify JWT not expired (exp > now)
4. Verify jwt.room === current roomId
5. Verify sig(nonce) against signingPubKey from Round 1
6. All pass:
   a. burnedJTIs.set(jti, signingPubKey)
      ← JTI permanently bound to this device's signing key
   b. admittedPeers.set(peerId, { role: jwt.role, admittedAt: now })
   c. If role === moderator:
      - trustedSigningKeys.set(peerId, signingPubKey)
      - encryptedRoomKey = RSA-OAEP.encrypt(roomKey, oaepPubKey)
      - Send to peer: { admitted: true, role, encryptedRoomKey }
   d. If role === guest:
      - Send to peer: { admitted: true, role }
      ← No room key ever sent to guests
7. Any check fails → send { admitted: false, reason } → disconnect
```

_Path B — Reconnection (JTI found in burnedJTIs):_

```
1. Verify JWT signature against trustedSigningKeys[jwt.iss]
2. Verify JWT not expired   ← 24h hard boundary enforced on reconnect too
3. storedSigningPubKey = burnedJTIs.get(jwt.jti)
4. Assert signingPubKey (Round 1) === storedSigningPubKey   ← same device
5. Verify sig(nonce) against storedSigningPubKey
6. All pass → send { admitted: true, role from admittedPeers }
   ← Room key NOT re-sent on reconnect; already in moderator's localStorage
7. Any check fails → disconnect
```

The burned JTI is a **routing trigger** (first vs. reconnect), not a rejection. JWT validity is enforced on both paths.

### 6.4 Owner — Implicit Trust (Self-Admit)

The owner is the root of trust. Requiring a third party to verify them is circular — they signed all other JWTs.

**Implicit trust applies if and only if ALL of the following are true:**

```
1. jwt.role === 'owner'
2. ownerId exists in localStorage
3. jwt.iss === ownerId      ← self-issued; owner only
4. No other peers connected
```

Condition 3 is the critical gate. Invited moderators have `jwt.iss` equal to someone else's ID. Guests fail condition 1.

On self-admit: owner burns their own JTI, writes their signing pubkey to `trustedSigningKeys`, writes themselves to `admittedPeers`. Idempotent — safe on repeated solo reloads. When other peers are present, the owner goes through the normal two-round handshake like anyone else.

### 6.5 Non-Owner Peers Alone — Lobby State

If a moderator or guest arrives and the owner is not connected:

```
→ Render lobby/waiting screen: "Waiting for the session owner to rejoin..."
  No whiteboard, editor, notes, or chat rendered
  Observe Yjs peer presence → when owner connects, trigger handshake automatically
```

**Critically:** if the owner leaves and only a guest remains, the guest is suspended in lobby on reload. A guest can never gain moderator or owner privileges. Moderators already admitted can continue their session — they do not need the owner present to use notes/chat (their room key is in localStorage). They cannot admit new peers in the owner's absence.

### 6.6 Moderator JWT Minting

Moderators mint their own invite JWTs signed with their own RSA signing private key. Their signing public key is registered in `trustedSigningKeys` at admission time by the owner. This means the owner can verify moderator-issued JWTs by looking up the issuer's key in `trustedSigningKeys`. No hierarchical CA chain beyond owner as root.

### 6.7 Content Encryption — AES-GCM

All writes to `moderatorNotes` and `moderatorChat` are encrypted with the AES-GCM room key before being stored in Yjs. The Yjs document contains only ciphertext — plaintext never touches the CRDT.

**Write path (notes):**

```
plaintext → AES-GCM encrypt (roomKey, randomIV) → { iv, ciphertext } → yjsDoc.moderatorNotes
```

**Read path (notes):**

```
yjsDoc.moderatorNotes → { iv, ciphertext } → AES-GCM decrypt (roomKey, iv) → plaintext → render
```

**Chat messages:**

```
Each message: { id, senderId, senderLabel, iv, ciphertext }
plaintext = JSON.stringify({ text, timestamp })
ciphertext = AES-GCM encrypt (roomKey, randomIV)
```

A guest inspecting IndexedDB or the live Yjs document sees only `{ iv: "a3f9...", ciphertext: "8b2e..." }` — useless without the room key.

**IV handling:** a fresh random 96-bit IV is generated for every encrypt operation. IVs are stored alongside ciphertext and are not secret.

### 6.8 JTI→SigningPubKey Binding

`burnedJTIs` is a `Y.Map` of `{ jti → base64 signingPubKey }`. This binding permanently ties each invite token to the specific browser keypair that first used it. A stolen JWT URL is useless without the corresponding signing private key — the attacker cannot pass the nonce signature challenge.

**Known pre-use race condition:** if a link is shared before first use, a second person could race to be admitted first. First connector wins; subsequent use fails (JTI now bound to the winner's keypair). Acceptable for the OSS version.

### 6.9 Yjs Sync Gate

Admission logic depends on `burnedJTIs` and `trustedSigningKeys` being fully restored from IndexedDB before any peer connection is evaluated. Because only the owner runs admission, this gate only needs to hold in the owner's browser. Admission MUST be gated on `indexeddbProvider.on('synced')` — enforced by `YjsProvider` which does not render children until sync completes.

### 6.10 Security Scope

| Threat                                | Mitigation                                              |
| ------------------------------------- | ------------------------------------------------------- |
| Stolen invite URL                     | Nonce challenge — attacker has no private key           |
| Link reuse after first use            | JTI burned and bound to specific keypair                |
| Replay attack                         | Verifier-issued nonce, never reused                     |
| Guest reading notes/chat via Yjs      | AES-GCM encryption — ciphertext only in Yjs             |
| Guest reading notes/chat via DevTools | Same — no room key, ciphertext is opaque                |
| Admission race between moderators     | Eliminated — only owner admits                          |
| Guest gaining elevated role           | Lobby state; role encoded in signed JWT; owner verifies |
| Network eavesdropping                 | DTLS on WebRTC channels                                 |

**Remaining limitations (OSS v1):**

- Pre-use link sharing race condition (two people open link simultaneously)
- Private keys in localStorage are vulnerable to XSS — mitigated by CSP header
- Owner offline = no new admissions until reconnect
- Excalidraw and Monaco content (whiteboard, code) are not encrypted — visible to guests in Yjs

---

## 7. Real-Time Sync

### 7.1 Yjs + y-webrtc

Both are required and serve separate concerns:

- **Yjs** — CRDT data structure layer, transport-agnostic
- **y-webrtc** — WebRTC transport layer, syncs Yjs between browsers

### 7.2 Shared Document Structure

```
yjsDoc
│
├── trustedSigningKeys  Y.Map
│     { peerId → base64 signingPubKey }
│     Written by owner when a peer is admitted.
│     Used to verify JWT signatures from moderator-issued invites.
│
├── burnedJTIs          Y.Map
│     { jti → base64 signingPubKey }
│     Y.Map (NOT Y.Array) — maps token to the device signing key that first used it.
│     Written on first admission. Never deleted.
│     Dual purpose: routing trigger (first vs. reconnect) + device binding.
│
├── admittedPeers       Y.Map
│     { peerId → { role, admittedAt } }
│     Written by owner on successful admission.
│     Used for: lobby detection, reconnect role lookup.
│
├── moderatorChat       Y.Array
│     [ { id, senderId, senderLabel, iv, ciphertext } ]
│     Append-only. AES-GCM encrypted — plaintext never stored in Yjs.
│     Guests see only ciphertext. Only peers with roomKey can decrypt.
│
├── moderatorNotes      Y.Map
│     { iv: string, ciphertext: string }
│     AES-GCM encrypted blob. Replaced on every save.
│     Guests see only ciphertext. Only peers with roomKey can decrypt.
│
└── roomState           Y.Map
      ├── editorContent   Y.Text   (bound to Monaco via y-monaco — NOT encrypted)
      ├── editorLanguage  Y.Map    { lang: string }
      └── excalidrawState Y.Map    { elements: JSON string — NOT encrypted }
```

**Note:** `editorContent` and `excalidrawState` are not encrypted. They are visible to all peers including guests. This is by design — the whiteboard and code editor are the shared collaboration space.

### 7.3 Tab-Refresh Resilience

y-indexeddb restores the Yjs document from IndexedDB on reload. Room key and keypairs are in localStorage and survive reload independently. After restore:

- Owner alone → self-admits via implicit trust path
- Owner with peers present → runs two-round handshake
- Moderator → runs reconnection handshake with owner (Path B); room key already in localStorage
- Guest → runs reconnection handshake with owner (Path B)
- Any non-owner peer alone → lobby state until owner reconnects

### 7.4 Signaling

- **OSS:** `wss://signaling.yjs.dev` — stateless, never sees content
- **Commercial:** self-hosted `y-webrtc-signaling`
- Room isolation via `roomId` as the y-webrtc room name

---

## 8. Frontend & Hosting

### 8.1 Framework: Vite + React

Next.js rejected — no SSR, no API routes, GitHub Pages export papercuts. Vite provides instant HMR and zero config for a pure SPA.

### 8.2 Hosting: GitHub Pages (OSS)

Fully static. Tokens in URL fragments — never sent to GitHub servers. Hash-based routing requires no server-side config.

### 8.3 Routing

Hash-based (`/#...`). Single `hashchange` listener in `App.jsx`. No router library. No 404 fallback needed.

---

## 9. Tooling Integrations

### 9.1 Whiteboard — Excalidraw

- `@excalidraw/excalidraw` React component, MIT licensed
- Scene state synced via `yjsDoc.roomState.excalidrawState`
- Covers whiteboard and diagramming — diagrams.net dropped
- Not encrypted — visible to all peers by design

### 9.2 Code Editor — Monaco Editor

- VS Code engine; syntax highlighting; optional LSP
- `y-monaco` binding for collaborative editing
- Not encrypted — visible to all peers by design

### 9.3 Moderator Notes — react-markdown Stack + Encryption

```
Packages: react-markdown, remark-gfm, rehype-raw
```

- Plaintext written to a local buffer; AES-GCM encrypted before every Yjs write
- `yjsDoc.moderatorNotes` stores `{ iv, ciphertext }` — never plaintext
- On read: decrypt with room key → pass plaintext to react-markdown
- Supports: headers, tables, task lists, strikethrough, code blocks, collapsible sections
- **Collapsible section syntax:**

  ```markdown
  <details>
  <summary>Hint for Q2</summary>

  Sliding window, O(n). Watch for empty input edge case.

  </details>
  ```

### 9.4 Moderator Chat — Custom Y.Array Implementation + Encryption

- `yjsDoc.moderatorChat` — `Y.Array` of `{ id, senderId, senderLabel, iv, ciphertext }`
- `ciphertext` = AES-GCM encrypt of `JSON.stringify({ text, timestamp })`
- On render: decrypt each message with room key → display
- No third-party chat library
- Append-only; messages pushed to array, never modified or deleted
- Real-time sync to all connected moderators via Yjs
- Guests see only ciphertext blobs — useless without room key

### 9.5 Cryptography — Web Crypto API

All operations use `window.crypto.subtle` exclusively. No external library.

| Algorithm                   | Usage                                     | Key Storage                                    |
| --------------------------- | ----------------------------------------- | ---------------------------------------------- |
| RSASSA-PKCS1-v1_5, 2048-bit | JWT signing + nonce identity proof        | `localStorage: ratifyd:sign:priv/pub:{peerId}` |
| RSA-OAEP, 2048-bit          | Room key wrapping/unwrapping              | `localStorage: ratifyd:oaep:priv/pub:{peerId}` |
| AES-GCM, 256-bit            | moderatorNotes + moderatorChat encryption | `localStorage: ratifyd:roomkey:{roomId}`       |

---

## 10. Data Persistence & Ephemerality

| Data                      | Where it lives           | Who has it                  | Lifetime                   |
| ------------------------- | ------------------------ | --------------------------- | -------------------------- |
| RSA signing private key   | `localStorage`           | All peers                   | Until manually cleared     |
| RSA signing public key    | `localStorage`           | All peers                   | Until manually cleared     |
| RSA-OAEP private key      | `localStorage`           | Owner + moderators          | Until manually cleared     |
| RSA-OAEP public key       | `localStorage`           | Owner + moderators          | Until manually cleared     |
| AES-GCM room key          | `localStorage`           | Owner + moderators          | Until manually cleared     |
| `ownerId` / `moderatorId` | `localStorage`           | Owner + moderators          | Until manually cleared     |
| Guest `peerId`            | `sessionStorage`         | Guests                      | Until tab is closed        |
| `trustedSigningKeys`      | `yjsDoc` + `y-indexeddb` | All peers (public data)     | Session + tab refresh      |
| `burnedJTIs`              | `yjsDoc` + `y-indexeddb` | All peers (public data)     | Session + tab refresh      |
| `admittedPeers`           | `yjsDoc` + `y-indexeddb` | All peers (public data)     | Session + tab refresh      |
| `moderatorNotes`          | `yjsDoc` + `y-indexeddb` | All peers (ciphertext only) | Session + tab refresh      |
| `moderatorChat`           | `yjsDoc` + `y-indexeddb` | All peers (ciphertext only) | Session + tab refresh      |
| Editor content            | `yjsDoc` + `y-indexeddb` | All peers (plaintext)       | Session + tab refresh      |
| Whiteboard state          | `yjsDoc` + `y-indexeddb` | All peers (plaintext)       | Session + tab refresh      |
| All session state         | Yjs P2P mesh             | —                           | Until all peers disconnect |

**No data is ever sent to a server beyond the stateless WebRTC signaling handshake.**

---

## 11. Future Commercial Considerations

| Feature                           | OSS                              | Commercial                         |
| --------------------------------- | -------------------------------- | ---------------------------------- |
| Hosting                           | GitHub Pages (static)            | Cloudflare / AWS                   |
| Signaling                         | Public `signaling.yjs.dev`       | Self-hosted, SLA-backed            |
| TURN server                       | None                             | Coturn or managed (Xirsys, Twilio) |
| Session recording                 | ❌                               | Yjs update log → S3 (encrypted)    |
| Code execution                    | ❌                               | Sandboxed (Judge0, Firecracker)    |
| Auth / SSO                        | ❌                               | SSO, org management                |
| Persistent history                | ❌                               | DB-backed session archive          |
| JTI burn atomicity                | Client-side race possible        | Server-side atomic redemption      |
| Editor/whiteboard encryption      | ❌ (visible to guests by design) | Optional field-level encryption    |
| Advanced RBAC                     | owner / moderator / guest        | Org roles, session templates       |
| Analytics                         | ❌                               | Interview scoring, time-on-task    |
| Owner offline = no new admissions | ❌ workaround                    | Delegated admission capability     |

---

## 12. Decisions Log (Summary Table)

| #   | Decision                      | Outcome                                                                          | Key Reason                                                              |
| --- | ----------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | Project name                  | Ratifyd                                                                          | Authoritative, minimal, daemon easter egg                               |
| 2   | Framework                     | Vite + React (not Next.js)                                                       | No SSR needed, GitHub Pages simplicity                                  |
| 3   | Whiteboard                    | Excalidraw                                                                       | Embeddable React component, MIT, Yjs-compatible, covers diagramming     |
| 4   | Diagramming                   | Dropped (Excalidraw covers it)                                                   | Eliminates iframe/postMessage complexity                                |
| 5   | Code editor                   | Monaco Editor                                                                    | VS Code engine, y-monaco binding, LSP-ready                             |
| 6   | Real-time sync                | Yjs + y-webrtc (both required)                                                   | CRDT data layer + WebRTC transport are separate concerns                |
| 7   | Local persistence             | y-indexeddb                                                                      | Tab-refresh resilience                                                  |
| 8   | Signaling (OSS)               | `wss://signaling.yjs.dev`                                                        | Stateless, free, sufficient                                             |
| 9   | Hosting                       | GitHub Pages                                                                     | Free, static, sufficient for OSS                                        |
| 10  | Room creation trigger         | Button press on landing page                                                     | Explicit user intent, cleaner code                                      |
| 11  | URL design                    | Hash fragments only; JWT only; no pubkeys ever in URL                            | Keys transmitted over DTLS WebRTC channel only                          |
| 12  | RSA signing keypair           | One per peer (all roles)                                                         | Dual-purpose: JWT signing + nonce identity proof                        |
| 13  | RSA-OAEP keypair              | One per owner/moderator (not guests)                                             | Receives AES-GCM room key from owner; guests never receive room key     |
| 14  | AES-GCM room key              | Generated by owner; distributed to moderators on admission                       | Encrypts notes and chat in Yjs; guests only see ciphertext              |
| 15  | Content encryption            | AES-GCM on moderatorNotes + moderatorChat before Yjs write                       | Plaintext never touches CRDT; opaque to guests at every layer           |
| 16  | Room key distribution         | Owner wraps with moderator's RSA-OAEP pubkey; sent in admission response         | Atomic with admission; only owner distributes; not re-sent on reconnect |
| 17  | Roles                         | `owner`, `moderator`, `guest`                                                    | Owner role separates admission authority from moderator capabilities    |
| 18  | Owner-only admission          | Only owner runs `evaluateAdmission`                                              | Eliminates moderator race conditions; confines Yjs sync gate to owner   |
| 19  | Trusted signing key registry  | `yjsDoc.trustedSigningKeys` Y.Map `{ peerId → signingPubKey }`                   | JWT signature verification for moderator-issued tokens                  |
| 20  | Burned JTI structure          | `yjsDoc.burnedJTIs` Y.Map `{ jti → signingPubKey }`                              | Binds token to device; reconnect identity check                         |
| 21  | Admitted peers registry       | `yjsDoc.admittedPeers` Y.Map `{ peerId → { role, admittedAt } }`                 | Lobby detection; reconnect role lookup                                  |
| 22  | Admission protocol            | Two-round handshake; owner-issued nonce; owner evaluates                         | Verifier nonce prevents replay; sig proves device continuity            |
| 23  | First admission vs. reconnect | JTI in burnedJTIs routes to reconnect path; JWT validity on both                 | Reconnect doesn't re-burn JTI; room key not re-sent                     |
| 24  | Owner implicit trust          | Self-admit ONLY when jwt.role==='owner' AND jwt.iss===ownerId AND no other peers | Circular to require self-verification; tightly gated                    |
| 25  | Non-owner alone               | Lobby screen; no content rendered                                                | Prevents sensitive content exposure; guest never gains elevated access  |
| 26  | Moderator JWT minting         | Any owner or moderator can mint; only owner admits                               | Moderators can invite; admission authority stays with owner             |
| 27  | Room ID in JWT                | Inside signed payload                                                            | Cryptographically binds token to room; cleaner URL                      |
| 28  | Token lifetime                | 24 hours                                                                         | Covers full interview day; hard boundary on all paths                   |
| 29  | Cryptography                  | Web Crypto API (native) only                                                     | No dependency; covers all operations                                    |
| 30  | Yjs sync gate                 | `indexeddbProvider.on('synced')` before any admission                            | Prevents race where burnedJTIs not yet restored from IndexedDB          |
| 31  | Guest invite limit            | Once per session (client-enforced)                                               | Prevents open invite abuse                                              |
| 32  | Ephemerality                  | Full — no server-side persistence                                                | OSS simplicity; commercial adds persistence                             |
| 33  | Moderator sidebar             | Notes + chat in persistent sidebar                                               | Always-visible companion; never rendered for guests                     |
| 34  | Notes markdown renderer       | react-markdown + remark-gfm + rehype-raw                                         | Composable; collapsibles via native HTML; no editor framework overhead  |
| 35  | Collapsible sections          | Native `<details>`/`<summary>` via rehype-raw                                    | Zero extra packages; familiar GitHub markdown syntax                    |
| 36  | Moderator chat                | Custom Y.Array-backed implementation                                             | Append-only log; zero bundle cost; naturally encrypted via room key     |
