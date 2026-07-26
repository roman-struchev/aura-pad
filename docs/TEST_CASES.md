# Regression test cases

A checklist tied to bugs already fixed in AuraPad. Run the relevant section
before a release (or after touching the named files) so a fixed bug doesn't
come back. Each case names the file(s) it guards, concrete steps, and the
expected result — the wording of "expected" is the assertion.

Most UI cases are driven the way `.claude/skills/verify` describes: launch an
isolated instance
(`AURAPAD_USER_DATA_DIR=/tmp/claude/aura-test npm run dev -- -- --remote-debugging-port=9222`)
and drive it over CDP. Two ground-truth tricks used below, because an occluded
window throttles Monaco/DOM repaints and makes `.view-lines`/DOM reads stale:

- **Active tab / open tabs**: read `<userDataDir>/openTabs.json` — the renderer
  persists `{ paths, activeTabPath, pinnedPaths }` there ~0.5 s after any change.
- **File on disk**: read the file directly; autosave persists ~1.2 s after typing.

---

## 1. File encoding (no data loss on non-UTF-8 files)

Guards: `src/main/encoding.ts`, `readFileContent`/`writeFileContent` in
`src/main/workspaces.ts`, `getDiff` in `src/main/git.ts`.

Setup — create test files (Node, with the app's own iconv-lite):

```js
const iconv = require('./node_modules/iconv-lite')
const fs = require('fs')
fs.writeFileSync('cp1251.txt', iconv.encode('Привет мир\nвторая строка\n', 'windows-1251'))
fs.writeFileSync('utf16.txt', iconv.encode('UTF16 Привет\n', 'utf-16le', { addBOM: true }))
fs.writeFileSync('bin.dat', Buffer.from([1, 0, 2, 0, 3]))
```

| # | Steps | Expected |
|---|-------|----------|
| 1.1 | `window.api.readFile(cp1251.txt)` | `success:true`, content starts `Привет мир` — **not** `?????` or `�` |
| 1.2 | `window.api.saveFile(cp1251.txt, 'Привет мир!\nправка\n')`, then read the raw bytes | Bytes decode as windows-1251 to the exact string; **no** `0xEF 0xBB 0xBF` BOM, **no** UTF-8 multibyte (`0xD0…`) — file stays cp1251 |
| 1.3 | `readFile(utf16.txt)` → edit → `saveFile` → read raw bytes | Content correct; first two bytes still `0xFF 0xFE` (UTF-16LE BOM preserved) |
| 1.4 | `readFile(bin.dat)` | `success:false`, error "looks like a binary file" |
| 1.5 | Open cp1251 file, edit one character, wait for autosave (~1.2 s) | On-disk bytes still valid cp1251 of the edited text — the original data-loss bug (autosave writing U+FFFD replacement chars) must not recur |
| 1.6 | Without opening it first, `window.api.saveFile(cp1251.txt, 'Привет мир!\nправка\n')` (simulates an entry evicted from the encoding cache by `ENCODING_MAP_LIMIT`) | Bytes are still cp1251 — `encodeFileContent` re-detects from disk instead of defaulting to UTF-8 and transcoding the file |

**Root bug:** everything was read as UTF-8, so legacy files showed `�` and
autosave wrote the replacement chars back, corrupting the file irreversibly.

---

## 2. Window closes even when the renderer is dead/hung

Guards: `mainWindow.on('close', …)`, `unresponsiveWindows`, `did-navigate` in
`src/main/index.ts`.

| # | Steps | Expected |
|---|-------|----------|
| 2.1 | With no unsaved tabs, click the window close button / Cmd+Q | App quits (macOS: Cmd+Q actually quits, not just closes the window) |
| 2.2 | With unsaved tabs, Cmd+Q → decline the prompt | App stays open; a **later** plain window close does not wrongly quit the whole app |
| 2.3 | Simulate a hung renderer (main inspector: block the renderer, or trust the `isCrashed()`/`unresponsive` guard), then close | Window closes without waiting forever for a `confirm-close` that can't arrive |
| 2.4 | Open a file via Finder "Open With" during a Cmd+R reload | The file still opens (not dropped) — `rendererReady` resets on `did-navigate` and the open request is queued |

**Root bug:** `close` unconditionally waited for the renderer's
`confirm-close`; a crashed/hung renderer left the window (and Cmd+Q) stuck.

---

## 3. Autosave never corrupts across a git branch switch

Guards: `saveAllDirtyFileTabs` + `beforeCheckout` in `useTabs.ts`/`useGitStatus.ts`,
external-change handler in `useTabs.ts`.

| # | Steps | Expected |
|---|-------|----------|
| 3.1 | Type in a file (tab dirty, autosave timer armed), then switch git branch via the branch selector before the ~1.2 s autosave fires | The dirty tab is saved to the **current** branch first; the old branch's buffer is **not** written over the new branch's file after checkout |
| 3.2 | Have a clean tab open; change the file on disk externally (git checkout in a terminal), and start typing in that tab within the read window | Your typed characters are not clobbered by the disk content; the "changed on disk" banner appears instead (the handler re-checks `isSaved` after the async read) |
| 3.3 | Type in tab A, then switch to tab B **before** the ~1.2 s autosave fires and stay there | A is written to disk anyway (autosave covers every dirty tab, not just the active one) and its dirty dot clears. Autosave used to be keyed on the active tab, so leaving A left it unsaved until you came back |
| 3.4 | Same as 3.3, but A is showing the "changed on disk" banner | A is **not** written — a tab whose file changed underneath it waits for the user's Reload/Ignore choice |

---

## 4. Monaco runs uncontrolled — undo & cursor survive; programmatic edits are undoable

Guards: `defaultValue`+`keepCurrentModel` on `<Editor>` in `App.tsx`,
`applyContentToModel`/`setFileContent` in `useTabs.ts`.

| # | Steps | Expected |
|---|-------|----------|
| 4.1 | Type into a file; wait ~1.2 s | Text persists to disk (autosave); tab shows dirty dot while unsaved |
| 4.2 | In a `.md` file: type, toggle Show Preview, toggle back to Source | Content intact **and** undo history intact — Cmd+Z still walks back the edits (regression: preview toggle used to dispose the model and wipe undo) |
| 4.3 | Open the Google Tasks tab, then switch back to a file tab | The file's undo stack is still intact |
| 4.4 | Format Document (Option+Cmd+L) on a `.json`, then Cmd+Z | The format is a single undoable step that reverts to the pre-format text |
| 4.5 | Click "Reload" on the external-change banner | Content replaced; Cmd+Z restores the previous buffer (reload is an undoable model edit, not a setValue) |

---

## 5. Preview eye toggle (tree hover icon)

Guards: `togglePreview` in `useTabs.ts`, `previewMarkdown` in `App.tsx`.

| # | Steps | Expected |
|---|-------|----------|
| 5.1 | Hover report A in the tree, click its eye → hover report B, click its eye | Both show **preview**; clicking a different report's eye never lands on source/code (the original bug: it was read as a repeat toggle) |
| 5.2 | Click the eye on an already-previewing file again | Flips back to source |
| 5.3 | Rapidly click eye A then eye B (different files) | Both preview; no file shows code |

**Note:** verify the *preview* state via the iframe/markdown presence, and the
*active file* via `openTabs.json`, not via a possibly-stale screenshot.

---

## 6. Active tab doesn't jump on concurrent opens

Guards: `openSeqRef` guard in `openTab` (`useTabs.ts`).

| # | Steps | Expected |
|---|-------|----------|
| 6.1 | Multi-tab mode: open file A then file B back-to-back (before A's read resolves) | Both open as tabs; **B** (last opened) is active — `openTabs.json` shows `activeTabPath` = B, regardless of which read finished first |
| 6.2 | Single-tab mode (`tabsEnabled=false`): open A then B rapidly | Exactly one tab, and `activeTabPath` equals the single open tab's path — never a path that isn't in `paths` (blank editor). This is the case the multi-tab guard must **not** break |

---

## 7. Sidebar toggle

Guards: `sidebarVisible` in `settings.ts`, toggle in `App.tsx`/`AppHeader.tsx`,
`toggle-sidebar` menu item in `menu.ts`.

| # | Steps | Expected |
|---|-------|----------|
| 7.1 | Click the sidebar toggle button (next to the terminal toggle) | The file tree disappears; editor widens; `getSettings().sidebarVisible === false` |
| 7.2 | Press Cmd+B | Toggles the sidebar the same way |
| 7.3 | Hide sidebar, then quit & relaunch | Sidebar stays hidden (persisted in `settings.json`) |
| 7.4 | Hide sidebar, then click a file-tree git branch badge / "reveal in tree" | Sidebar re-appears (those actions un-hide it) |
| 7.5 | Hide sidebar, use a tree keyboard shortcut region | No crash — `sidebarRef.current` is null and the hotkey guard is null-safe |

---

## 8. Google account connect UX

Guards: `waitForAuthCode` focus in `src/main/googleTasks.ts`,
`useGoogleAccounts`, `GoogleTasksConfigModal`, `GoogleTasksTab`.

Note: a full OAuth round-trip needs a real client; stub the token endpoints
(`AURAPAD_GTASKS_*` env vars) or the IPC in the main inspector per the verify skill.

| # | Steps | Expected |
|---|-------|----------|
| 8.1 | Connect an account (finish the browser sign-in) | The app window comes to the front automatically; the new account appears with a transient green "Connected" highlight (config modal) or becomes the active account (tab) |
| 8.2 | Connect from the Settings modal, then from the tab | Both paths add the account, show the alert on failure, and refresh the list (shared `useGoogleAccounts`) |
| 8.3 | Disconnect an account from the tab | Confirm dialog; on confirm the account and its cached lists are dropped; the active account falls back to another connected one |

---

## 9. macOS update install auto-relaunches

Guards: macOS block in `scripts/install.sh`.

Hard to fully e2e without a signed release; verify the script logic:

| # | Steps | Expected |
|---|-------|----------|
| 9.1 | Run the install script while AuraPad is running | The old process is quit (osascript) or force-killed (`pkill -9`) **before** `open`; after install a fresh instance launches — the "spinner hangs, no restart" symptom does not occur |
| 9.2 | Run with unsaved changes in the app | The polite quit is held by the unsaved-changes prompt, then SIGKILL forces it within a few seconds; relaunch still happens |

**Root bug:** `open` on a still-running app only re-activates it (single-instance
lock); the old app survived `osascript`/SIGTERM because the app's own close
handler defers the quit, so it never died and the update never relaunched.

---

## 10. Modal accessibility

Guards: focus trap/autofocus/restore in `src/renderer/src/components/Modal.tsx`,
`data-autofocus` in `DialogHost.tsx`/`NameInputModal.tsx`.

| # | Steps | Expected |
|---|-------|----------|
| 10.1 | Open any modal (Settings, rename, confirm), press Tab repeatedly | Focus cycles **within** the modal, never onto the app behind the overlay |
| 10.2 | Open the rename dialog | The name input is focused (and its text selected) on open |
| 10.3 | Open an alert / confirm dialog, press Enter | Confirms the safe default (OK / Cancel) — the default button is focused |
| 10.4 | Close a modal | Focus returns to wherever it was before the modal opened |

---

## 11. Config caching correctness

Guards: `readConfigFile`/`writeConfigFile` cache in `src/main/configFile.ts`.

| # | Steps | Expected |
|---|-------|----------|
| 11.1 | Change a setting, then read it back via `getSettings` | The new value is returned (cache updated on write) |
| 11.2 | Add/remove a workspace, then `get-workspaces` | Reflects the change immediately (cache invalidated on `saveWorkspaces`) |
| 11.3 | Trigger many fs events (e.g. `git checkout` in a large repo) | No settings.json re-read per event (cache), and the app stays responsive |

---

## 12. HTML preview (current behavior — do NOT regress into a blank render)

Guards: `src/renderer/src/components/HtmlPreview.tsx`.

The security hardening was intentionally reverted because isolation attempts
broke real reports. Until a proper `WebContentsView` isolation lands, the test
is simply: **the reports render.**

| # | Steps | Expected |
|---|-------|----------|
| 12.1 | Open each report in `~/git/java-guild/public/pages/*.html`, toggle preview | The report renders (tables/charts), including the "wrapper" ones (`report-port-component`, `report-aggregated`, `report-employees-stats`, `report-port-mentor-domain`) that `document.write` into a nested iframe |
| 12.2 | If you change the iframe sandbox, re-run 12.1 | Dropping `allow-same-origin` (opaque origin) makes the wrapper reports render **blank** — that's the regression to avoid |

---

## 13. Startup waits for the persisted settings

Guards: `settingsLoaded` in `useSettings.ts`, the restore effect in `useTabs.ts`,
the resume/teardown effects in `useWorkTogether.ts`.

Both of these run **once** at startup off a single setting, and `settings` starts
out as `DEFAULT_SETTINGS` until main answers — so acting before that silently
picks the default instead of the user's choice.

| # | Steps | Expected |
|---|-------|----------|
| 13.1 | With two tabs open, set `tabsEnabled: false` in settings.json, relaunch | Only the previously active tab is restored, not the whole list (the restore used to run against the default `true`) |
| 13.2 | Set `tabsEnabled: true`, relaunch with two tabs persisted | Both tabs come back — the gate must not break the normal path |
| 13.3 | Plant a session in `<userDataDir>/workTogetherSessions.json` pointing at a dead backend (e.g. `http://127.0.0.1:9`), leave Work Together **disabled**, relaunch | The file is left untouched: nothing connects, nothing is resumed. A disabled extension used to reconnect every persisted session anyway (and would have dropped this one as gone) |
| 13.4 | With that session planted, switch Work Together **on** in Settings → Configure… | Resume runs right away without a relaunch: the dead session is dropped from the file (`{"sessions":[]}`) |
| 13.5 | Share a file, then switch Work Together **off** | The local session is torn down (no socket, no relaying) but its record survives, so 13.4 picks it back up. Ending it for good stays "Stop Sharing" only |

---

## 14. Preload exposes nothing but the typed api

Guards: `src/preload/index.ts`, `src/preload/index.d.ts`.

| # | Steps | Expected |
|---|-------|----------|
| 14.1 | In the renderer console: `typeof window.electron` | `"undefined"` — the generic `electronAPI` bridge (unrestricted `ipcRenderer` for any channel) must stay unexposed, especially while the HTML preview can run scripts in this renderer (§12) |
| 14.2 | `window.api.platform` | The platform string (`darwin`/`win32`/`linux`) - what the old bridge was actually used for; the tree context menu's "Open in Finder"/"Reveal in File Explorer" wording and `runPythonFile`'s quoting depend on it |

---

## Fast pre-release smoke (5 min)

1. Open a folder → tree loads; open a file → edits autosave to disk.
2. cp1251 file opens readable and round-trips on save (case 1.2).
3. `.md` preview toggle → back to source → undo still works (case 4.2).
4. Sidebar Cmd+B hides/shows and survives relaunch (7.1–7.3).
5. Open two files fast → the second is active (case 6.1 via `openTabs.json`).
6. Quit with no unsaved tabs → app exits cleanly (case 2.1).
