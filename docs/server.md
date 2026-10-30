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
  `y-websocket` + `y-monaco` page. Its HTML is the Thymeleaf template
  `src/main/resources/templates/worktogether/guest-template.html`; its JS/CSS
  and Monaco are built from `frontend/work-together-guest/` into
  `src/main/resources/static/work-together/` (git-ignored, see [Running](#running)).
- Signed, opaque tokens (HMAC-SHA256) carry role/session/link claims — no
  accounts, matching the spec's "possession of the link" trust model.
- In-memory only: sessions/links/connections live in process memory and are
  swept on TTL expiry; nothing is durably persisted (spec §7/§8). Size caps
  (below) keep that memory bounded.
- Client addresses (for rate limits) come from Tomcat's RemoteIpValve:
  `X-Forwarded-For` is trusted only from a local proxy — in production,
  `cloudflared` on the same host — and only the hop it added.

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
| `worktogether.rate-limit.max-per-minute` | `30` | Per-IP cap per minute on creating sessions, opening `/j/…` links and WebSocket connects |
| `worktogether.limits.max-content-bytes` | `1048576` (1 MB) | Largest file a session can be shared with (larger → 422); the request body is capped at about twice that (→ 413) |
| `worktogether.limits.max-message-bytes` | `4194304` (4 MB) | Largest WebSocket frame; a snapshot is the whole document. A bigger one closes the socket with 1009, which the app treats as final |
| `worktogether.limits.memory-budget-bytes` | `268435456` (256 MB) | Total content + snapshots of all live sessions; past it new sessions get 503 and bigger snapshots are dropped |
| `worktogether.limits.max-sessions-per-ip` | `20` | Live sessions one address may hold (more → 429) |

## Running

```
./gradlew bootRun
```

The guest editor page's JS/CSS/Monaco are build output and not in git. Build
them once before a local `bootRun` (and again after editing
`frontend/work-together-guest/`); tests don't need them:

```
cd frontend/work-together-guest && npm ci && npm run build
```

Deployment: a push to `main` that touches `server/` runs
[`.github/workflows/server-deploy.yml`](../.github/workflows/server-deploy.yml)
(guest page build → tests → jar → Docker Hub `romanew/all:aura-server` → `docker-compose.yml`
copied to the host and restarted). It can also be started by hand from the
Actions tab.
