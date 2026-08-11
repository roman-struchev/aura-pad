---
name: verify
description: Run AuraPad's smoke suite (npm run smoke) and drive the app over CDP for runtime verification. Use after changing anything in src/, when adding a check for a new feature, or when asked to test, verify, or reproduce behavior in the real app.
---

# Verifying AuraPad changes

## Try the smoke suite first

```bash
npm run smoke              # 82 checks, ~20s, throwaway profile + fixture workspace
npm run smoke -- A4 A7     # only these cases (prefix match on the id)
npm run smoke -- --keep    # leave the app running on port 9333 to poke at it
```

`scripts/smoke/` already solves launching an isolated instance, waiting for
readiness, raising the window, clicking rows/tabs/buttons, and reading ground
truth. **Don't hand-roll another CDP harness** — if the change needs a check the
suite doesn't have, add a module to `scripts/smoke/cases/` (list it in
`run.mjs`) and you get the runner, the fixture and the reporting for free.
`docs/TEST_CASES.md` Part A maps each id to what it covers.

Everything below is for the cases the suite deliberately can't do: native-menu
accelerators, native dialogs, OAuth, the updater, and free-form poking.

## Launch

```bash
npm run dev -- -- --remote-debugging-port=9222
```

- Must run **unsandboxed** (Bash sandbox blocks `~/Library/Application Support/AuraPad/SingletonLock` and mach ports — the app dies instantly inside it).
- Single-instance lock: a running AuraPad (dev or installed) blocks a new one, and the loser exits **silently with code 0** right after the "DevTools listening" banner — looks like a mystery crash. The user often has the installed app open (`ps` for `/Applications/AuraPad.app`, not just the dev binary). Don't fight over the profile — run isolated:

  ```bash
  AURAPAD_USER_DATA_DIR=/tmp/claude/aura-verify-profile npm run dev -- -- --remote-debugging-port=9223 --inspect=9229
  ```

  (`AURAPAD_USER_DATA_DIR` is honored by `src/main/appIdentity.ts`; fresh profile = no workspaces/tabs, fine for UI tests. Delete the dir afterwards.) Only fall back to quitting the running instance via CDP `Browser.close` when the test *needs* the real profile — never `kill` blindly: it holds the user's real session/tabs.
- `--inspect=9229` opens a Node inspector into the **main process**: `Runtime.evaluate` with `require("electron")` can stub IPC handlers (e.g. neuter `apply-update` so the Install button doesn't run the real `curl | bash` installer) and `webContents.send(...)` fakes main→renderer events (updater notifications etc.) for end-to-end UI testing.
- Main-process changes need an app restart (`electron-vite dev` here runs without `--watch`); renderer changes hot-reload.

## Drive via CDP (no OS UI scripting on this machine)

Node 22 has a built-in WebSocket — no deps needed. Page target: `GET /json`, filter `type === "page"` and not `devtools://`. Evaluate with `Runtime.evaluate {returnByValue: true, awaitPromise: true}`.

- `window.api.*` (preload bridge) is reachable from evaluate — good for exercising IPC end to end (`getWorkspaces`, `createPath`, `createPty`, `getSettings`...).
- **Typing into Monaco**: it uses EditContext (`textarea.ime-text-area`), so `execCommand('insertText')` does nothing. Real click via `Input.dispatchMouseEvent` into `.monaco-editor`, then `Input.insertText`.
- Dirty-tab indicator: `span` with classes `bg-blue-500` + `rounded-full` in the tab bar.
- Tree vs tab nodes with the same filename: scope queries to the sidebar (element whose `innerText` starts with `"Files\nGit"`).
- App dialogs are in-DOM (buttons `Cancel`/`Confirm`), not native — clickable via evaluate.
- Terminal I/O checks: xterm renders to DOM here — read `.xterm-rows` innerText. `window.api.ptyWrite("term-0", "cat -v\r")` gives visible echo of control bytes (ESC shows as `^[`); real keystrokes go through `Input.dispatchKeyEvent` (modifiers: Shift=8) after focusing the xterm textarea.
- **Occluded-window rendering trap**: when the test window sits behind other windows, Chromium throttles rAF and Monaco stops repainting — `.view-lines` innerText goes stale even though the model/state updated fine. Never fail a test on view DOM alone: check ground truth via the module cache (`import("http://localhost:5173/@fs/<repo>/node_modules/.vite/deps/monaco-editor.js?v=<hash>")` — find the exact URL in `performance.getEntriesByType("resource")` — then `editor.getEditors()[0].getValue()`), or raise the window first (main inspector: `win.showInactive(); win.moveTop()`).
- React state isn't reachable from the console, but state changes leak observable side effects — e.g. any tabs-state change rewrites `openTabs.json` (check its mtime) — useful to tell "handler didn't run" from "view didn't repaint".
- Quit = browser-level socket (`/json/version` → `webSocketDebuggerUrl`) + `Browser.close`; goes through the app's own unsaved-changes flow.

## Gotchas

- The user's workspace lives in iCloud (`~/Library/Mobile Documents/...`) and there are **twin dirs differing only in Unicode normalization** — never retype paths into shell; pass them programmatically from `getWorkspaces()`.
- Autosave is on by default: anything typed into a real tab persists after ~1.2s. Create a scratch file via `window.api.createPath(root, name, 'file')` first, open it by clicking its tree node, type into that. Clean up with `find ... -name <scratch> -delete` (handles normalization).
- Session restore drops missing paths gracefully — deleting the scratch file before relaunch is fine.
- Restore the user's dev instance afterwards: `nohup npm run dev -- -- --remote-debugging-port=9222 &` (detached, unsandboxed).

## Regression checklist

Before signing off: run `npm run smoke` (it is cheap enough that there is no
reason not to), then, if the change touches an area with a known past bug, run
the matching Part B section of `docs/TEST_CASES.md` by hand — each section lists
the files it guards under `Guards:`, so match them against your diff and run only
that section. Don't run unrelated sections; a small change needs only its own.

When you fix a new bug that could plausibly come back (or add a load-bearing
behavior worth locking in), lock it in: a check in `scripts/smoke/cases/` if it
can be automated, a Part B case in `docs/TEST_CASES.md` if it can't — in the same
change, so the checklist stays current instead of drifting behind the code.
