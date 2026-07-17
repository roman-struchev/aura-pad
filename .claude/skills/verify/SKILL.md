---
name: verify
description: Build, launch, and drive AuraPad (Electron) for runtime verification via CDP
---

# Verifying AuraPad changes

## Launch

```bash
npm run dev -- -- --remote-debugging-port=9222
```

- Must run **unsandboxed** (Bash sandbox blocks `~/Library/Application Support/AuraPad/SingletonLock` and mach ports — the app dies instantly inside it).
- Single-instance lock: a running AuraPad (dev or installed) blocks a new one. Check with `curl -s http://127.0.0.1:9222/json/version` and `ps`. Quit the old one gracefully via CDP `Browser.close` — never `kill` blindly: dev and prod share the same userData profile and the user's real session/tabs.
- Main-process changes need an app restart (`electron-vite dev` here runs without `--watch`); renderer changes hot-reload.

## Drive via CDP (no OS UI scripting on this machine)

Node 22 has a built-in WebSocket — no deps needed. Page target: `GET /json`, filter `type === "page"` and not `devtools://`. Evaluate with `Runtime.evaluate {returnByValue: true, awaitPromise: true}`.

- `window.api.*` (preload bridge) is reachable from evaluate — good for exercising IPC end to end (`getWorkspaces`, `createPath`, `createPty`, `getSettings`...).
- **Typing into Monaco**: it uses EditContext (`textarea.ime-text-area`), so `execCommand('insertText')` does nothing. Real click via `Input.dispatchMouseEvent` into `.monaco-editor`, then `Input.insertText`.
- Dirty-tab indicator: `span` with classes `bg-blue-500` + `rounded-full` in the tab bar.
- Tree vs tab nodes with the same filename: scope queries to the sidebar (element whose `innerText` starts with `"Files\nGit"`).
- App dialogs are in-DOM (buttons `Cancel`/`Confirm`), not native — clickable via evaluate.
- Quit = browser-level socket (`/json/version` → `webSocketDebuggerUrl`) + `Browser.close`; goes through the app's own unsaved-changes flow.

## Gotchas

- The user's workspace lives in iCloud (`~/Library/Mobile Documents/...`) and there are **twin dirs differing only in Unicode normalization** — never retype paths into shell; pass them programmatically from `getWorkspaces()`.
- Autosave is on by default: anything typed into a real tab persists after ~1.2s. Create a scratch file via `window.api.createPath(root, name, 'file')` first, open it by clicking its tree node, type into that. Clean up with `find ... -name <scratch> -delete` (handles normalization).
- Session restore drops missing paths gracefully — deleting the scratch file before relaunch is fine.
- Restore the user's dev instance afterwards: `nohup npm run dev -- -- --remote-debugging-port=9222 &` (detached, unsandboxed).
