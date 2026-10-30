# Server (aura-server)

Backend for AuraPad's Work Together feature, in `server/` of this repo,
running at [aura-pad.struchev.com](https://aura-pad.struchev.com).
Paths and commands here are relative to `server/`.

## Work Together backend

Implements the **Work Together** collaborative-editing backend contract specified in
[`docs/edit-together/specification.md`](edit-together/specification.md)
of the editor
(see also [`feature-desc.md`](edit-together/feature-desc.md)
for the product framing). In short: AuraPad shares an open file by creating a
*session* here and minting a time-limited *link*; whoever opens that link — no
AuraPad install needed — gets a live Monaco editor synced over Yjs, relayed
through this server.

What's implemented, under `src/main/java/com/struchev/auraserver/worktogether/`:

- **REST API** (`/v1/sessions/...`) — create session, mint/revoke share links,
  end session, get status (spec §3). Everything but session creation requires
  `Authorization: Bearer <hostToken>` for that session.
- **WebSocket relay** (`/v1/sessions/{sessionId}/connect`) — relays Yjs sync +
  awareness frames between the Host and guests, enforces read-only links
  server-side, and closes sockets with the spec's close codes on
  expiry/revocation/session end (spec §4, §5).
- **Guest-facing editor page** (`/j/{linkId}`) — a self-hosted Monaco +
  `y-websocket` + `y-monaco` page (source in `frontend/work-together-guest/`,
  built assets committed under `src/main/resources/static/work-together/`);
  see [Running](#running) below for the rebuild command.
- Signed, opaque tokens (HMAC-SHA256) carry role/session/link claims — no
  accounts, matching the spec's "possession of the link" trust model.
- In-memory only: sessions/links/connections live in process memory and are
  swept on TTL expiry; nothing is durably persisted (spec §7/§8).

## Landing page

`/` serves a short static page (`src/main/resources/static/index.html`)
describing the AuraPad project with a link to its GitHub repo.

## Configuration

| Property | Default | Purpose |
|---|---|---|
| `worktogether.token-secret` (env `WORKTOGETHER_TOKEN_SECRET`) | random at startup | HMAC key signing tokens; set this for tokens to survive a restart |
| `worktogether.public-base-url` (env `WORKTOGETHER_PUBLIC_BASE_URL`) | derived from the request | Pin share/join links to one fixed host instead of the reverse proxy's forwarded headers |
| `worktogether.max-session-ttl-seconds` | `2592000` (30 days) | Hard ceiling on `maxTtlSeconds`; matches AuraPad's own `MAX_TTL_SECONDS` |
| `worktogether.cleanup-interval-seconds` | `30` | How often expired sessions/links are swept |
| `worktogether.rate-limit.max-per-minute` | `30` | Per-IP cap on `POST /v1/sessions` |

## Running

```
./gradlew bootRun
```

Guest editor assets are pre-built and committed, so plain `bootRun` is
enough unless you edit `frontend/work-together-guest/` — then rebuild first
with `npm run build` there.

Deployment: a push to `main` that touches `server/` runs
[`.github/workflows/server-deploy.yml`](../.github/workflows/server-deploy.yml)
(tests → jar → Docker Hub `romanew/all:aura-server` → `docker-compose.yml`
copied to the host and restarted). It can also be started by hand from the
Actions tab.
