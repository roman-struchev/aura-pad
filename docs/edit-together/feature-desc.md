# Work Together — real-time collaborative editing via a shared link

> The original design note for the feature, kept for the reasoning behind it. It shipped
> essentially as described; the settings key ended up as
> `{ enabled, backendUrl, displayName }` and `backendUrl` now defaults to a hosted
> instance. The backend contract lives in [specification.md](./specification.md), which is
> the document to follow when implementing one.

## Goal

Let a user grab a link to a tab that's open in AuraPad and hand it to someone else —
that person edits it live alongside them, or just reads it, in a plain web browser
(no AuraPad install required on their side). The link is only valid for a limited time
and carries an explicit permission level.

Concretely, this is a new toggle-able feature, same shape as dictation / read-aloud /
translation: **Settings → "Work Together"**, off by default. Turning it on reveals one
extra field: the **backend URL** — the address of the collaboration service AuraPad
should talk to (see [specification.md](./specification.md) for what that service must
implement). This mirrors how Google Tasks already asks for an OAuth client id/secret
once its toggle is flipped on — same "off until configured" pattern
(`src/shared/settings.ts`'s `ExtensionSettings`), so `workTogether` should live there
as `{ enabled: boolean, backendUrl: string }` (shipped with a `displayName` alongside,
for the name shown to guests).

## User-facing flow

1. User opens Settings, enables "Work Together", pastes the backend URL their team runs
   (or a hosted default, if we ever provide one).
2. On any open tab, a new "Share…" action (tab context menu, or a toolbar button next to
   the tab strip) lets the user pick:
   - **Permission**: read-only or read-write.
   - **Expiry**: e.g. 15 min / 1 hour / 1 day / custom.
3. AuraPad registers a session with the backend for that tab's content and gets back a
   shareable URL. The user copies it and sends it however they like (Slack, email, …) —
   AuraPad itself doesn't do the sending.
4. Whoever opens the link — in a regular browser, nothing installed — lands on a page
   the *backend* serves: a Monaco-based editor loaded with the file's current content,
   already wired for live sync. If the link grants read-only, editing is disabled and
   that's shown clearly (banner/lock icon).
5. From that point on, every keystroke on either side is synced through the backend in
   real time — no "refresh to see changes."
6. Back in AuraPad, the shared tab shows a small presence indicator: how many people are
   currently connected, and (via cursor/selection presence) roughly where each of them
   is working in the file. Same idea as Google Docs' avatar stack + colored cursors.
7. Once the link expires (or the host revokes it early), the guest's session is cut off
   and they see an "this link has expired" state instead of the editor.

## Collaboration engine

Don't reinvent this — **Yjs (CRDT) + `y-monaco` + the awareness protocol**:

- CRDT merges concurrent edits correctly without needing a "who wins" arbiter.
- `y-monaco` is a ready-made Yjs binding for Monaco — which is already AuraPad's editor
  (`@monaco-editor/react`, mounted in `src/renderer/src/App.tsx`), so no editor swap is
  needed on the host side, and the guest's browser-hosted editor uses the same stack.
- Awareness gives remote cursors/selections/presence for free — this is exactly what
  powers the "N people editing, here's where" indicator above.

Yjs's transport is a swappable provider: `y-websocket` (server-relayed, what we need
here since the guest has no direct path to the host's machine), `y-webrtc` (P2P +
signaling — not applicable, we need a durable link a browser can open cold), `y-indexeddb`
(local persistence — not relevant for this feature). The engine choice (Yjs) is
independent of the transport choice, which is why the backend contract in
`specification.md` is written around a WebSocket relay speaking the Yjs sync +
awareness wire protocol.

## Why a pluggable third-party backend

The relay/session server is deliberately *not* something AuraPad bundles or hosts —
it's a separate service, and its address is just a setting. That means:

- Teams can self-host it inside their own network (no file content ever leaves their
  infrastructure).
- The backend is also the thing serving the guest-facing web editor page, so joining a
  session never requires installing AuraPad.
- Anyone can build a compatible backend from the spec alone — `specification.md` defines
  the REST session/link API, the WebSocket wire protocol, the token/permission model,
  and the presence data shape needed to implement one from scratch.

## Non-goals (v1)

- No accounts/ACLs — anyone holding a valid, unexpired link gets the role it was minted
  with. Access control is "possession of the link," same trust model as most "anyone
  with the link" sharing features.
- One tab per share link — no multi-file sessions.
- The backend isn't a permanent file store: it holds the live document only for the
  session's lifetime; AuraPad's local file remains the source of truth and saves
  normally as edits arrive.
