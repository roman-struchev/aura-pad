# AuraPad — working notes for Claude

A lightweight text/code editor: Electron + React + Monaco. `src/main` (Node
side), `src/preload` (the typed `window.api` bridge, generated from
`src/shared/ipc.ts`), `src/renderer` (the app).

[README.md](README.md) is the user-facing description — what the app does,
feature by feature, plus install and release. Read it when you need to know
whether a behavior is intended, or when a change makes something there wrong:
**a feature change that contradicts the README means the README is part of the
change.**

## After you change anything

```bash
npm run smoke      # ~35s, 111 checks, throwaway profile — the actual gate
npm run typecheck
npm run lint       # pre-existing errors are noisy; compare, don't chase zero
```

`npm run smoke` launches the real app against a temp profile and drives it over
CDP. Run it before saying a change works. It is cheap enough that there is no
reason to skip it, and it catches the things reasoning alone doesn't.

## When you add or change a feature

Add or update a check in `scripts/smoke/cases/` (one module per area, listed in
`scripts/smoke/run.mjs`) in the same change. A feature with no check goes
unnoticed the next time someone refactors near it.

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
- **Single-instance lock**: a running AuraPad makes a second one exit silently
  with code 0. Always launch with `AURAPAD_USER_DATA_DIR` pointed somewhere
  disposable (the smoke runner does this for you).

## Docs

- `docs/TEST_CASES.md` — Part A (automated, maps ids to coverage), Part B
  (manual regressions, each naming the files it guards).
- `docs/BUGS.md` — known open issues, severity-ordered. Read §1 before touching
  the HTML preview.
- `.claude/skills/verify` — driving the app by hand when the suite isn't enough.
