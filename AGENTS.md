# AuraPad — working notes for coding agents

A lightweight text/code editor: Electron + React + Monaco, plus the small
backend for its Work Together feature.

- `desktop/` — the Electron app
  - `src/main` — Node side
  - `src/preload` — the typed `window.api` bridge, generated from `src/shared/ipc.ts`
  - `src/renderer` — the app
  - `scripts/smoke` — the smoke suite
- `server/` — Work Together backend (Spring Boot, Java 25, Gradle); see
  [Server](#server)
- `docs/` — all documentation lives here, never inside a component folder
- `scripts/` — repo-level scripts: `install.sh` (its URL is baked into
  installed apps' updater and the README — never move it) and `release.sh`
- `Makefile` — `make test` runs every component's checks

Unless a path says otherwise, paths and commands in the sections about the app
are relative to `desktop/`.

[README.md](README.md) is the user-facing description — what the app does,
feature by feature, plus install and release. Read it when you need to know
whether a behavior is intended, or when a change makes something there wrong:
**a feature change that contradicts the README means the README is part of the
change.**

## After you change anything

```bash
cd desktop
npm run smoke      # throwaway profile + fixture workspace — the actual gate
npm run typecheck
npm run lint       # pre-existing errors are noisy; compare, don't chase zero
```

`npm run smoke` launches the real app against a temp profile and drives it over
CDP. Run it before saying a change works. It is cheap enough that there is no
reason to skip it, and it catches the things reasoning alone doesn't.

```bash
npm run smoke -- A4 A7     # only these cases (prefix match on the id)
npm run smoke -- --keep    # leave the app running on the CDP port to poke at it
```

Case ids are in `scripts/smoke/run.mjs`. Run the cases for the area you touched
while iterating, the whole suite before you call the change done. Then, if the
change touches an area with a known past bug, run the matching Part B section
of `docs/TEST_CASES.md` by hand — each section lists the files it guards under
`Guards:`; match them against your diff and run only those.

## When you add or change a feature

Add or update a check in `scripts/smoke/cases/` (one module per area, listed in
`scripts/smoke/run.mjs`) in the same change. A feature with no check goes
unnoticed the next time someone refactors near it. The same goes for a fixed
bug that could plausibly come back.

`scripts/smoke/` already handles launching an isolated instance, waiting for
readiness, raising the window, clicking rows/tabs/buttons and reading ground
truth — **don't hand-roll another CDP harness**, add a case module instead.

If the behavior can't be automated — native-menu accelerators (Cmd+B, Cmd+S,
Option+Cmd+L…), native dialogs, OAuth, the updater — add a Part B case to
`docs/TEST_CASES.md` instead and say why it's manual.

## Traps that cost real time

- **Never assert on Monaco's DOM.** A window that isn't frontmost is treated as
  occluded, Chromium throttles rendering, and `.view-lines` reads back empty
  while edit events lag. Use `window.api.getOpenTabs()`, the file on disk, or
  `window.api.getSettings()` as ground truth.
- **CDP-injected keys never reach the native menu**, so menu accelerators can't
  be tested that way; drive the equivalent toolbar button instead.
- **Toolbar buttons sit in the title bar's drag region** and ignore synthetic
  mouse clicks — dispatch a DOM `.click()` for those.
- **Fixed colours are legible in exactly one theme.** There are four
  (`dark`, `light`, `monokai`, `solarized`), so `text-gray-200` or
  `text-emerald-300` reads on one side of that list and vanishes on the other.
  Use the tokens in `src/renderer/src/assets/main.css`: `fleet-text` /
  `fleet-textHover` for text, `accent-ok|warn|error|info` for status colours.
  `ui.contrastOf()` in the smoke suite measures a real WCAG ratio.
- **Single-instance lock**: a running AuraPad (dev or installed) makes a second
  one exit silently with code 0 right after the "DevTools listening" banner —
  it looks like a crash. Always launch with `AURAPAD_USER_DATA_DIR` pointed at
  a disposable directory (the smoke runner does this for you). Never kill an
  AuraPad you didn't start: it may hold someone's real session.
- **The smoke CDP port is fixed (9333).** If a run says something is already
  listening there, another run (or a `--keep` one) is still up — set
  `SMOKE_CDP_PORT` to a free port rather than killing processes you didn't
  start.
- **The HTML preview is an open security hole, on purpose for now.** The
  preview iframe needs `allow-scripts allow-same-origin` for real reports to
  render (`docs/TEST_CASES.md` §12), and that same pair hands a previewed file
  the full `window.api` bridge. Don't "fix" either half without the other.
- **Monaco model URIs come from `lib/modelUri.ts`.** Never build one with
  `Uri.parse(path)` — it reads the path as already-encoded, and two files end
  up sharing one model.

## Driving the app by hand

Only for what the smoke suite deliberately can't do, or for free-form poking.

```bash
AURAPAD_USER_DATA_DIR="$(mktemp -d)" npm run dev -- -- --remote-debugging-port=9223 --inspect=9229
```

- The app needs a real macOS session (window server, Application Support); a
  sandboxed shell can make it die on start.
- Main-process changes need an app restart; renderer changes hot-reload.
- `--inspect=9229` opens a Node inspector into the **main process**:
  `Runtime.evaluate` with `require("electron")` can stub IPC handlers (e.g.
  neuter `apply-update` so Install doesn't run the real installer) and
  `webContents.send(...)` fakes main→renderer events (updater notifications…).
- CDP: Node 22 has a built-in WebSocket, no deps needed. Page target: `GET
  /json`, `type === "page"` and not `devtools://`. Evaluate with
  `Runtime.evaluate {returnByValue: true, awaitPromise: true}`.
- `window.api.*` is reachable from evaluate — handy for exercising IPC end to
  end (`getWorkspaces`, `createPath`, `createPty`, `getSettings`…).
- **Typing into Monaco**: it uses EditContext, so `execCommand('insertText')`
  does nothing. Real click via `Input.dispatchMouseEvent` into
  `.monaco-editor`, then `Input.insertText`.
- App dialogs are in-DOM (`Cancel` / `Confirm` buttons), not native.
- Terminal: xterm renders to DOM — read `.xterm-rows` innerText.
  `window.api.ptyWrite("term-0", "cat -v\r")` echoes control bytes visibly.
- React state isn't reachable from the console, but changes leak side
  effects — e.g. any tabs change rewrites `openTabs.json` in the profile dir
  (check its mtime) — useful to tell "handler didn't run" from "view didn't
  repaint".
- Autosave is on by default: anything typed into a real tab is written after
  ~1.2s. Work in a scratch file created with `window.api.createPath(...)`.
- Quit through the browser-level socket (`/json/version` →
  `webSocketDebuggerUrl`) + `Browser.close`; it goes through the app's own
  unsaved-changes flow.

## Server

`server/` is the backend the Work Together feature talks to; its contract is
`docs/edit-together/specification.md`, details in `docs/server.md`.

```bash
cd server
./gradlew test       # run after touching anything under server/
./gradlew bootRun    # local instance
```

- The smoke suite does not cover it.
- The guest editor page's JS/CSS/Monaco are built from
  `server/frontend/work-together-guest/` (`npm ci && npm run build` there) into
  a git-ignored folder; CI builds them before the jar. Its HTML is the
  Thymeleaf template under `server/src/main/resources/templates/`.
- `WorkTogetherEndToEndTest` runs the real server on a port — the place to
  test anything about frames, headers or limits that mocks can't see.
- A push to `main` touching `server/` deploys it
  (`.github/workflows/server-deploy.yml`). A change to the spec usually means
  changing both the app and the server in the same commit.

## Docs

- `docs/TEST_CASES.md` — Part A (automated, maps ids to coverage), Part B
  (manual regressions, each naming the files it guards).
- `docs/edit-together/` — Work Together product framing and backend contract.
