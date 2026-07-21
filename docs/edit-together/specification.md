# Work Together backend — service specification

This document specifies the contract a **Work Together backend** must implement so
that any AuraPad instance can point at it (Settings → Work Together → Backend URL) and
share tabs through it. It is written so a third party can build a compatible service
without seeing AuraPad's source: everything AuraPad needs from the backend, and
everything the backend needs from AuraPad, is defined here.

It does not mandate a language or framework. It mandates: the REST endpoints, the
WebSocket wire protocol, the token/permission model, the presence data shape, and the
guest-facing web client the backend must serve.

## 1. Actors

- **Host** — the AuraPad instance that owns the tab being shared. Connects to the
  backend as a privileged, always-write participant.
- **Backend** — the service this spec describes. Owns sessions and share links for
  their lifetime, relays Yjs sync/awareness messages between participants, enforces
  read/write permissions and link expiry, and serves the guest-facing editor page.
- **Guest** — whoever opens a share link. No AuraPad install, no account: a browser
  and a valid link are sufficient. Role (read or read-write) comes from the link.

## 2. Core concepts

| Term | Meaning |
|---|---|
| **Session** | One shared tab: a live Yjs document plus its participants. Created by the Host, ends when the Host ends it, revokes all its links, or every link has expired. |
| **Link** | A minted, shareable URL for a session. Carries its own role and expiry, independent of other links on the same session (a host can mint one read-only link and one read-write link for the same file). |
| **Token** | The credential embedded in a link (and used by the Host to authenticate its own connection). Multi-use: everyone who opens the same link within its validity window joins with that link's role — there's no per-guest identity, only per-link. |
| **Role** | `host` (implicit write + session management), `write`, or `read`. |

## 3. REST API (Host ↔ Backend)

All endpoints are HTTPS. Base path `/v1`.

For endpoints that require the Host to authenticate (such as managing links, ending the session, or fetching session status), the `hostToken` returned from session creation must be provided in the `Authorization` header as a Bearer token: `Authorization: Bearer <hostToken>`.

### 3.1 Create a session

```
POST /v1/sessions
```

Request body:

```json
{
  "filePath": "src/App.tsx",
  "language": "typescript",
  "content": "<full text of the file at share time>",
  "maxTtlSeconds": 86400
}
```

- `content`/`language` are stored by the backend for the guest page's pre-sync
  placeholder paint and syntax highlighting (§6) — a backend is **not** required to
  construct an actual Yjs update from `content`. The real Yjs document only ever
  needs to exist in participants' own runtimes (the Host's, and each guest's
  browser page); a backend that never decodes Yjs' binary format at all — a pure
  byte-level relay of sync/awareness frames — is a valid, spec-compliant
  implementation, since the Host is always the first participant to connect and
  already holds the authoritative content locally. (An earlier draft of this spec
  suggested the backend synthesize the initial update itself; that's unnecessary
  and was removed as of the aura-server reference implementation.)
- `maxTtlSeconds` is a ceiling the backend enforces on any link minted for this
  session (see 3.2) — protects against a host accidentally requesting a year-long link.

Response `201`:

```json
{
  "sessionId": "sess_9fK3...",
  "hostToken": "eyJhbGciOi..."
}
```

`hostToken` is what the Host uses to open its own WebSocket connection (§4) with role
`host`. A session with no links yet and no connected participants should still be
reapable by the backend after some idle timeout of its own choosing (not specified
here — implementation detail), since a Host that never mints a link has nothing to
share.

### 3.2 Mint a share link

```
POST /v1/sessions/{sessionId}/links
```

```json
{ "role": "read", "ttlSeconds": 3600 }
```

`role` is `"read"` or `"write"` (never `"host"` — hosts only come from 3.1).
`ttlSeconds` must be ≤ the session's `maxTtlSeconds`; reject with `422` otherwise.

Response `201`:

```json
{
  "linkId": "lnk_2aQ1...",
  "token": "eyJhbGciOi...",
  "url": "https://collab.example.com/join/eyJhbGciOi...",
  "role": "read",
  "expiresAt": "2026-07-20T21:30:00Z"
}
```

`url` is the full, human-shareable link — this is the string AuraPad shows the user to
copy. Opening it in a browser must be sufficient to join; the token round-trips through
the URL (path segment or query param, backend's choice) rather than requiring the guest
to paste anything separately.

### 3.3 Revoke a link

```
DELETE /v1/sessions/{sessionId}/links/{linkId}
```

`204` on success. Any guest currently connected via that link is disconnected
immediately (see close codes, §5). Future joins with that token must fail with the
"revoked" reason.

### 3.4 End a session

```
DELETE /v1/sessions/{sessionId}
```

`204`. All connections (host and every guest) are closed, all outstanding links become
invalid, and any Yjs state the backend was holding for the session may be discarded —
the backend is not a durable store; AuraPad's local file is the source of truth.

### 3.5 Session status

```
GET /v1/sessions/{sessionId}
```

```json
{
  "sessionId": "sess_9fK3...",
  "filePath": "src/App.tsx",
  "createdAt": "2026-07-20T20:30:00Z",
  "links": [
    { "linkId": "lnk_2aQ1...", "role": "read", "expiresAt": "2026-07-20T21:30:00Z", "revoked": false }
  ],
  "participants": [
    { "connectionId": "conn_1", "role": "host", "displayName": "Roman", "joinedAt": "2026-07-20T20:30:01Z" },
    { "connectionId": "conn_2", "role": "read", "displayName": "Guest 1", "joinedAt": "2026-07-20T20:41:12Z" }
  ]
}
```

This is what AuraPad polls (or receives via its own WebSocket control messages, §5.3)
to render the "N people editing" presence indicator.

## 4. WebSocket protocol (sync + awareness)

```
GET /v1/sessions/{sessionId}/connect?token={token}
```
upgraded to a WebSocket. `token` is the `hostToken` (role `host`) or a link `token`
(role `read`/`write`) from §3. The backend must:

1. Validate the token: signature, matching `sessionId`, not expired, not revoked.
   Reject the upgrade (HTTP 401/403) if invalid — don't accept-then-close, since a
   guest-facing web client should be able to show a clean "invalid link" state before
   ever opening a socket, if it chooses to pre-validate via a lightweight check.
2. On successful connect, run the standard **Yjs sync protocol** handshake: send the
   connecting client the document's current state (sync step 1/2), matching what
   `y-websocket`'s reference server does — reusing `y-protocols/sync` and
   `y-protocols/awareness` encoding directly is strongly recommended so the Host side
   can use the stock `y-websocket` client provider unmodified. A relay-only backend
   (§3.1) that holds no Yjs document of its own satisfies this by replaying its cached
   snapshot (§4.4) on connect and letting other live participants answer the client's
   own sync-step-1 through the relay.
3. Thereafter relay every sync **update** message it receives to all other connected
   participants in the same session, and likewise relay every **awareness** message.

Message framing: reuse `y-websocket`'s convention — first byte is a message-type tag
(`0` = sync, `1` = awareness), binary frames. A backend that already speaks this wire
format is drop-in compatible with the Yjs client ecosystem; a backend implementing a
custom encoding must still preserve the two categories below since they have different
permission rules (§4.1). Two further tags are used outside the plain relay path:
`2` = control (server → Host only, §5) and `4` = snapshot (client → backend only, §4.4).

### 4.1 Enforcing read-only

`read`-role connections must:
- Receive full sync + awareness traffic (they can see everything, including everyone's
  cursors).
- Have any **sync update** message they send **rejected/dropped** by the backend — the
  enforcement is server-side; a modified guest client that fakes a write must not be
  able to mutate the document. Only `awareness` messages from a read-only connection
  are relayed (their cursor still moves, they just can't edit).

`write` and `host` connections may send both message types freely.

### 4.2 Awareness state shape

Each participant's awareness state (the payload carried inside awareness messages) is
an application-level JSON object. Note that `y-monaco` expects the display name and color to be nested inside a `user` object:

```json
{
  "user": {
    "name": "Guest 1",
    "color": "#5B8DEF"
  },
  "role": "read",
  "cursor": { "line": 42, "column": 7 },
  "selection": { "startLine": 42, "startColumn": 7, "endLine": 44, "endColumn": 1 }
}
```

`user.name`/`user.color` for guests are picked client-side ad hoc (like anonymous Google
Docs guests — "Guest 1", "Guest 2", assigned a color from a fixed palette by join
order); the Host's own display name can come from local AuraPad settings if set, or
default similarly. This is what both the Host's presence indicator and the guest
editor's remote cursors render from.

**Implementation note on `cursor`/`selection`:** an implementation built on `y-monaco`
(as both the Host and the aura-server reference guest page are) doesn't actually need to
populate these two fields itself. `y-monaco`'s `MonacoBinding` already tracks and
publishes the local selection on its own awareness field, encoded as Yjs relative
positions (`Y.createRelativePositionFromTypeIndex`) rather than raw line/column — those
stay valid across concurrent remote edits, whereas a plain `{line, column}` snapshot
goes stale the moment someone else's edit shifts the document above it. `MonacoBinding`
also renders remote decorations from that same field automatically. A second, independent
`awareness.setLocalState(...)` call updating `cursor`/`selection` on every
`onDidChangeCursorPosition`/`onDidChangeCursorSelection` event — on top of the one
`MonacoBinding` already installs — is redundant at best; at worst the two can race (each
awareness `'change'` event re-triggers decoration rendering, which can itself fire another
cursor-position event), and Monaco's own recursion guard on `deltaDecorations` will throw.
Losing that exception inside a Yjs observer callback can abort an in-flight remote update
partway through applying, which is capable of corrupting the document content itself, not
just the cursor decorations — this was the root cause of a real content-corruption bug in
the reference implementation. If a non-`y-monaco` client genuinely needs plain
`cursor`/`selection` line/column data, compute it from `MonacoBinding`'s own relative
position (`Y.createAbsolutePositionFromRelativePosition`) rather than tracking it a second
time independently.

### 4.3 Line-ending normalization (LF vs CRLF)

Collaborative text editing relies on synchronized, character-accurate offsets. Monaco Editor uses platform-default line endings by default: **CRLF (`\r\n`)** on Windows (2 characters) and **LF (`\n`)** on macOS/Linux (1 character). If one client uses CRLF and another uses LF, their character offsets will diverge on the very first newline. This leads to immediate text corruption, interleaved characters, and cursor drift during typing.

To guarantee synchronization across all platforms and operating systems, all clients MUST strictly enforce **LF (`\n`)** as the sole End-of-Line (EOL) sequence.

#### EOL Enforcement Rules:
1. **Model EOL Enforcement**: All clients must intercept newly created Monaco models and set their EOL sequence to LF immediately.
2. **Value Change EOL Lock**: When `model.setValue()` is called (which happens during Yjs state synchronization inside bindings like `y-monaco`), Monaco silently resets the model's EOL setting back to the platform default (CRLF on Windows). All clients MUST listen to model content changes (`model.onDidChangeContent`) and immediately set the EOL back to LF if it has changed.
3. **Initial Content Normalization**: Any text loaded from a file or external resource before seeding the Yjs document or creating a Monaco model MUST have its carriage returns removed (e.g., `.replace(/\r\n|\r/g, '\n')`).

#### Reference Implementation (Monaco Setup):
```javascript
// Force LF globally for any created Monaco model and keep it locked
monaco.editor.onDidCreateModel((model) => {
  model.setEOL(monaco.editor.EndOfLineSequence.LF);
  model.onDidChangeContent(() => {
    if (model.getEndOfLineSequence() !== monaco.editor.EndOfLineSequence.LF) {
      model.setEOL(monaco.editor.EndOfLineSequence.LF);
    }
  });
});
```

### 4.4 Snapshot resync (reconnect into an empty room)

The relay in §4 step 3 only works while at least one participant stays connected to
answer a (re)connecting client's sync handshake. When *every* participant drops at once
— the common case after a shared Wi-Fi outage — a client that reconnects first finds no
live peer to sync from, and (since the backend is a relay that holds no Yjs document of
its own, §3.1) would be left with a blank editor. Without this section, that is exactly
the "reconnect shows an empty tab" failure.

To close this without turning the backend into a full Yjs host, the backend keeps a
single **opaque snapshot** per session:

- **Push (client → backend), tag `4`:** a `write`/`host` connection MAY send a snapshot
  frame `[4][<a complete sync message>]` — the inner bytes being an ordinary sync
  **update** message (tag `0`) encoding the client's full document state
  (`Y.encodeStateAsUpdate`). The backend stores the inner message **verbatim**,
  replacing any previous snapshot; it MUST NOT decode the Yjs payload, and MUST NOT
  relay a snapshot frame to other participants. A `read` connection's snapshot frame is
  dropped (same rule as §4.1). Clients SHOULD push once right after connecting if they
  already hold content, and then throttled after local edits (a snapshot is the whole
  document, so pushing on every keystroke is wasteful — the reference clients rate-limit
  to at most one push every ~20s, which is fine because ordinary edits already relay
  immediately as sync updates; the snapshot only backstops the all-offline case).
- **Replay (backend → client):** immediately after accepting any new WebSocket
  connection, the backend sends the stored snapshot (if any) to just that client, as-is.
  Because the stored bytes are a plain sync message, the client applies them through its
  normal sync handling — a stock `y-websocket` client needs no snapshot-specific code on
  the receive side. `Y.applyUpdate` is idempotent, so a snapshot that turns out
  redundant (a live peer also answers) is harmless.

Tag `4` is used (rather than `3`) specifically because `y-websocket` clients emit tag
`3` (queryAwareness) on connect; keeping snapshot on `4` means a stock guest's
queryAwareness can never be misread as a snapshot push.

The snapshot is in-memory and per-session; it is discarded when the session ends (§3.4),
consistent with §7 (no document persistence beyond a session's lifetime).

## 5. Session lifecycle events (control plane)

Beyond raw Yjs traffic, the Host connection should receive out-of-band notifications
so its presence UI stays live without polling §3.5:

- **join**: a participant connected — `{ type: "join", connectionId, role, displayName }`
- **leave**: a participant disconnected — `{ type: "leave", connectionId }`
- **link-revoked**: one of this session's links was revoked (from a call to §3.3) —
  informational for the Host UI.

These can be carried as a third message-type tag on the same socket (e.g. tag `2` =
control) alongside the sync/awareness tags from §4.

### 5.1 Disconnect / close codes

When a link expires or is revoked, the backend must close that connection with a
distinguishable WebSocket close code/reason so the guest-facing client can render the
right message instead of a generic "connection lost":

| Code | Reason |
|---|---|
| `4001` | link expired |
| `4002` | link revoked |
| `4003` | session ended |
| `4004` | invalid/unknown token |

## 6. The guest-facing web client

Because a guest has no AuraPad install, **the backend itself must serve the page the
share link resolves to** — this is not optional, it's the whole point of the feature.
That page must:

1. Read the token from the URL and open the WebSocket from §4.
2. Run Monaco + `y-monaco`, bound to the same Yjs doc, so edits sync live.
3. If the granted role is `read`, put Monaco in read-only mode and show that plainly
   (e.g. a banner) — don't rely on server-side write rejection alone for UX, it's a
   defense-in-depth backstop, not the primary signal to the user.
4. Render remote awareness state as Monaco cursor/selection decorations plus a small
   participant list, using the `displayName`/`color` fields from §4.2.
5. On a close code from §5.1, replace the editor with a corresponding static message
   ("This link has expired", "This link was revoked", "This session has ended").
6. Load the editor's syntax highlighting from the `language` given at session creation
   (§3.1) so the guest's view matches the Host's.

## 7. Security requirements

- HTTPS/WSS only — no plaintext.
- Tokens are opaque to the client and must be verified server-side (signature + `exp`)
  on every REST call and on WebSocket upgrade — never trust claims a client asserts
  about its own role.
- Enforce `maxTtlSeconds` at link-mint time (§3.2); reject requests for longer-lived
  links.
- Rate-limit session creation and connection attempts per Host/IP to prevent abuse of
  a shared/multi-tenant backend deployment.
- No account or PII is required to join as a guest — the link itself is the sole
  credential, consistent with the "anyone with the link" trust model this feature is
  built on (see feature-desc.md's non-goals).
- The backend should not persist document content beyond a session's lifetime unless
  a deployment explicitly opts into that (e.g. for audit purposes) — by default,
  ending a session (§3.4) should be free to discard its state.

## 8. Non-goals (v1)

- No user accounts, SSO, or per-guest ACLs — role is entirely a property of which link
  was opened.
- One session = one file/tab. No multi-file or whole-project sessions.
- No offline/local persistence provider (`y-indexeddb`) — the backend is the only
  source of shared state during a session; AuraPad's local file remains authoritative
  once the session ends.
- No P2P/WebRTC transport — everything relays through the backend, since the guest
  side is a cold browser tab with no signaling relationship to the Host.
