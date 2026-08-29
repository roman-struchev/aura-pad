# Test cases

Two parts:

- **Part A — baseline.** Does the app still do the things it exists for? These
  are automated: `npm run smoke` runs all of them against a throwaway profile in
  about 20 seconds. Run it before every release and after any change you can't
  fully reason about.
- **Part B — regressions.** One section per bug already fixed, naming the files
  it guards. Run the sections whose `Guards:` match your diff. Most are manual;
  the ones Part A already covers say so.

```bash
npm run smoke              # everything, ~20s
npm run smoke -- A5 A10    # only these ids (prefix match)
npm run smoke -- --keep    # leave the app up afterwards to poke at it
```

The suite lives in `scripts/smoke/`: `run.mjs` launches the app with
`AURAPAD_USER_DATA_DIR` pointed at a temp profile and a planted workspace
(`fixture.mjs`), then drives it over CDP with real mouse and key events
(`ui.mjs`). One launch covers every case; add a case by dropping a module into
`scripts/smoke/cases/` and listing it in `run.mjs`.

## What automation can't reach

Keep these manual — they are the reason Part B still has prose in it:

- **Native-menu accelerators** (Cmd+B, Cmd+S, Cmd+W, Cmd+Q, Option+Cmd+L,
  Cmd+Shift+F, Cmd+D…). The menu is owned by the main process and only ever
  sees real keystrokes; CDP-injected keys go straight to the page. Where a
  toolbar button triggers the same action, the suite uses that instead.
  Renderer-level shortcuts (double-Shift quick open, the tree's Cmd+C/V/⌫,
  Escape) *are* injectable and are covered.
- **Native dialogs** — the folder picker behind "Open Folder", Finder
  interaction, the OS clipboard shared with other apps.
- **OAuth round-trips, the updater, and signed-build behavior** (§8, §9).
- **Anything judged by eye**: theme colors, layout, fonts.

## Ground truth, when writing a case

An app window that isn't frontmost is *occluded*, and Chromium then throttles
rendering: Monaco's `.view-lines` reads back empty and its edit events lag, so a
case that asserts on editor DOM measures window stacking, not the app. The suite
raises the window at startup through the main-process inspector, and still
prefers these:

- **Open tabs / active tab**: `window.api.getOpenTabs()`.
- **File contents**: read the file from disk (autosave lands ~1.2 s after typing).
- **Settings**: `window.api.getSettings()` or `<userDataDir>/settings.json`.
- **Terminal output**: collect `window.api.onPtyData`, not the xterm DOM.

And two helpers worth reaching for instead of a `sleep`:

- `ui.openFile(path)` — waits for the tree row, clicks it, waits until that tab
  is the active one. Almost every case starts with this; hand-rolling it is
  where the "the tree kept shifting under the click" flakes came from.
- `ui.waitForRow(path)` — for a file the case just wrote. The tree's watcher is
  debounced, and "long enough on my machine" is how a case goes red on someone
  else's. Note that a file first written and then only ever saved *through the
  app* may never reach the tree at all: the watcher suppresses its own writes,
  so wait for the row before those saves.

---

# Part A — baseline (automated)

`npm run smoke`. Each id below is a module in `scripts/smoke/cases/`; the
"covers" column is what breaks in the app if the case goes red.

| id | Case | Covers |
|---|---|---|
| A1 | Workspace tree | Roots and children render; `node_modules`/dotfiles and `.gitignore` entries stay hidden; folders expand and collapse |
| A2 | Open, edit, autosave | Clicking a file opens it, the editor mounts, typing reaches disk, the dirty dot clears; an outside edit to a file the app itself saved reaches the tab instead of being silently overwritten by the next autosave (§8) |
| A3 | Tabs | Several files open at once, the last opened is active, clicking switches, closing removes, the session is persisted, files from outside a workspace open and are remembered; a crowded strip scrolls, offers the full tab list, and keeps the active tab in view in both directions; the tab menu copies the file's relative path; the empty part of the strip is a drag region (the window can be moved by it) while the tabs themselves are not |
| A4 | File operations | Create (through the tree's own dialog), duplicate-name refusal, rename, move, move-onto-existing refusal, Cmd+C/Cmd+V copy, Cmd-click multi-select, ⌫ delete with confirmation, the context menu's Copy Path / Copy Relative Path (and Open in Default App being offered, and refused for a path outside the workspaces), the right-click menu staying inside the window with the sidebar docked right (§15), and its text keeping a WCAG-AA contrast ratio in the light theme, at rest and under the mouse |
| A5 | Text encodings | cp1251 and UTF-16 read and round-trip byte-for-byte; binary files are refused (§1) |
| A6 | Search, options and replace | Full-text search finds matches and skips ignored paths; double-Shift opens quick open, filters, and closes on Escape; switching between quick open and search-in-files swaps the one dialog and carries the query both ways; match case / whole word / regex / file filter each narrow as advertised and an unfinished regex is reported not thrown; replace-in-files rewrites what it says it did, refuses paths outside the allowed folders, and one Undo puts it back — driven through the API and through the overlay (preview, Replace All, Undo) |
| A16 | Markdown image paste | An image on the clipboard pasted into a `.md` file lands in `assets/` next to it, the document gets a relative link, the preview renders it as a data: URL, the same paste in a non-Markdown file writes nothing, and a document path outside the allowed folders is refused |
| A17 | Local history | A save stores the state it replaced, a second save moments later is coalesced into it, replace-across-files always stores one, versions read back byte-for-byte, an unknown id and a file outside the allowed folders are refused, and the tab menu's Local History restores a picked version into the tab |
| A18 | Spell checking | An installed dictionary is listed and an unknown language refused; Settings → Spelling turns it on and remembers it; a prose file's unknown words are counted in the toolbar (affixed forms counting as known), typing another one is picked up, a clean file reports none, and a non-prose file is not checked at all |
| A7 | Preview and formatting | Markdown and HTML previews render and toggle back to source; Format rewrites JSON and autosaves |
| A8 | Terminal | A shell starts in the requested directory, runs a command, returns output, and can be replaced; the toolbar opens a terminal in the panel, the panel spans the window edge to edge with the editor ending above it (not running on underneath), and Cmd+K is routed to it (git panel stays shut) while it still toggles the git panel elsewhere |
| A9 | Settings and session restore | Settings round-trip and persist; the sidebar toggle works and is remembered; a relaunch restores tabs and settings (§13) |
| A10 | Git | The repo, branch, unstaged changes, diff, branch list, staging, and untracked files (needs `git`; skips itself without it) |
| A11 | Preload surface and path allowlist | `window.electron`/`require` stay unexposed, the typed api and `platform` are there (§14); paths outside the open workspaces are refused for read/write/create/delete/move and for spawning a shell, a symlink out of a workspace doesn't smuggle one back in, nor does a path buried under folders that don't exist yet, while a Quick Open listing opens an outside file up and workspace files are unaffected (§2) |
| A12 | HTTP client | `.http` and `.rest` files run against a loopback server: status/headers/pretty-printed body in the response pane, whose Close button is reachable (nothing floating on top of it), copy to clipboard, Cmd+Enter runs the block at the cursor, a curl command in a `.sh` runs from the cursor, file-writing curl flags are refused; the HTTP Client tab sends a form request; the requests panel starts closed, opens from the toolbar on its Saved list, switches to History, records, refills the whole form (headers and body included) and clears (§16); the Saved list finds the `###` blocks of the workspace's .http files, searches them, puts one back in the form, runs it from the row and opens the file it lives in; a form request saves into a `.http` file under the heading it was given (appending, only into `.http`/`.rest`, and a name with a folder in it makes the folder), and an environment picked next to Run beats the file's own `@host` with the private env file filling in the token; a curl pasted into the URL field (CRLF, padded continuations, dangling backslash) fills the form and runs, while a plain URL does not; the tab's response carries no second copy of the request line or the curl button, and its Headers tab label fits on one line; the tab's own environments store a constant, fill it into `{{host}}` on send, and an unresolved placeholder is refused instead of sent |
| A19 | Ports | A node process started by the case shows up in the list with its pid, the tab filters down to that port, one click on Stop really stops it, the row goes and the tab says what was sent, a port that appears later shows up without asking, Refresh turns while it re-reads and stops after, and a pid that is no longer listening (or pid 1) is refused |
| A13 | Window lifecycle | A close is not vetoed by a renderer that never announced itself, and the window comes back with its workspace on activate (§2; macOS-only, runs last) |
| A15 | Detached windows | Tearing a tab off through its context menu opens a second window holding that file, the tab leaves the window it came from, the new window is lean (no tree, no sidebar toggle, but an editor), it does not own the persisted session and says so twice in a row, it can start its own pty, sending the tab back closes it and reopens the file in the main window, and closing its last tab closes it too rather than leaving an empty frame |
| A14 | Update toast | The available/download-percentage/installing/failed states of the toast, driven by the events main sends during a real update — never clicking Install, which would run the actual installer (§9) |

---

# Part B — regressions

---

## 1. File encoding (no data loss on non-UTF-8 files)

Guards: `src/main/encoding.ts`, `readFileContent`/`writeFileContent` in
`src/main/workspaces.ts`, `getDiff` in `src/main/git.ts`.

**Mostly automated as A5** (1.1–1.4). Run the rest by hand when touching
`encoding.ts`.

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

Guards: `mainWindow.on('close', …)`, `unresponsiveWindows`, `rendererReady`,
`did-start-navigation`, and the dev signal handlers in `src/main/index.ts`.

| # | Steps | Expected |
|---|-------|----------|
| 2.1 | With no unsaved tabs, click the window close button / Cmd+Q | App quits (macOS: Cmd+Q actually quits, not just closes the window) |
| 2.2 | With unsaved tabs, Cmd+Q → decline the prompt | App stays open; a **later** plain window close does not wrongly quit the whole app |
| 2.3 | Simulate a hung renderer (main inspector: block the renderer, or trust the `isCrashed()`/`unresponsive` guard), then close | Window closes without waiting forever for a `confirm-close` that can't arrive |
| 2.4 | Open a file via Finder "Open With" during a Cmd+R reload | The file still opens (not dropped) — `rendererReady` resets when the navigation starts and the open request is queued |
| 2.5 | `npm run dev`, then Ctrl+C in that terminal — first while the window is still painting its first frame, then with an unsaved tab open | The process exits both times and no window is left behind (`ps` shows no orphaned `Electron .` with PPID 1). Signals can't be delivered from CDP, so A13 only covers the veto half |
| 2.6 | `npm run dev`, then touch a file under `src/main/` | electron-vite restarts the app: the old window goes away, one new window comes up, and the dev server keeps running |

**Root bug (2.3):** `close` unconditionally waited for the renderer's
`confirm-close`; a crashed/hung renderer left the window (and Cmd+Q) stuck.

**Root bug (2.5/2.6):** the same wait applied to a renderer that had never
subscribed (still loading, or mid-reload), and to signal-driven quits. In dev
the vetoed process outlived the terminal that started it, while its replacement
exited on the single-instance lock — an orphaned window and a dead dev server.

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
| 7.5 | Hide sidebar, then press Cmd+C / Cmd+V / Backspace | No crash and nothing happens to the (now invisible) tree — the tree surface is gone, so `useGlobalHotkeys` can't match it |

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

Guards: macOS block in `scripts/install.sh`, `reportProgress` in
`src/main/updater.ts`, `UpdateToast.tsx`.

**A14 covers the toast's states** by pushing main's own events at the renderer;
the install itself only happens in a packaged build against a real release, so
9.1-9.5 stay manual:

| # | Steps | Expected |
|---|-------|----------|
| 9.1 | Run the install script while AuraPad is running | The old process is quit (osascript) or force-killed (`pkill -9`) **before** `open`; after install a fresh instance launches — the "spinner hangs, no restart" symptom does not occur |
| 9.2 | Run with unsaved changes in the app | The polite quit is held by the unsaved-changes prompt, then SIGKILL forces it within a few seconds; relaunch still happens |
| 9.3 | Click Install on the update toast (packaged macOS build, real newer release) | The toast counts the download up — "Downloading AuraPad x.y.z… NN%" with a hairline bar along its bottom edge — then switches to "Installing AuraPad x.y.z… the app will restart itself." (no percentage) while the image is mounted and copied |
| 9.4 | Same, watching the Settings modal's update row | It mirrors the toast: "Downloading… NN%" during the download, "Installing…" afterwards |
| 9.5 | Pull the network mid-install, then retry from the failed toast | The failure toast replaces the progress (no stale percentage), and the retry starts counting from 0% again |

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
broke real reports. Until a proper isolated preview lands, the test is simply:
**the reports render.** A7 covers the plain case; the wrapper case below needs a
real report and stays manual.

| # | Steps | Expected |
|---|-------|----------|
| 12.1 | Preview a simple `.html` file | It renders (automated as A7) |
| 12.2 | Preview a report that `document.write`s into a nested iframe — the kind that broke before (any dashboard-style page whose scripts build a second iframe; keep one such file around locally, e.g. under a reports repo) | It renders fully, tables and charts included |
| 12.3 | If you change the iframe sandbox, re-run 12.2 | Dropping `allow-same-origin` (opaque origin) makes those wrapper reports render **blank** — that's the regression to avoid |

**Read `docs/BUGS.md` §1 before touching this.** The same
`allow-scripts allow-same-origin` that keeps 12.2 working also gives a previewed
file the full privileged bridge (verified: arbitrary file read/write and command
execution), so "make 12.2 pass" and "close that hole" are the same piece of work.

---

## 13. Startup waits for the persisted settings

Guards: `settingsLoaded` in `useSettings.ts`, the restore effect in `useTabs.ts`,
the resume/teardown effects in `useWorkTogether.ts`.

**13.2 is automated as A9** (relaunch restores the persisted tabs and settings);
the `tabsEnabled: false` and Work Together variants below stay manual.

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

**Automated as A11.**

| # | Steps | Expected |
|---|-------|----------|
| 14.1 | In the renderer console: `typeof window.electron` | `"undefined"` — the generic `electronAPI` bridge (unrestricted `ipcRenderer` for any channel) must stay unexposed, especially while the HTML preview can run scripts in this renderer (§12) |
| 14.2 | `window.api.platform` | The platform string (`darwin`/`win32`/`linux`) - what the old bridge was actually used for; the tree context menu's "Open in Finder"/"Reveal in File Explorer" wording and `runPythonFile`'s quoting depend on it |

---

## 15. File tree selection, copy/paste, and context-menu placement

Guards: selection + clipboard in `useWorkspaceTree.ts`, the shortcut scoping in
`useGlobalHotkeys.ts` (`data-surface="tree"`), `src/main/clipboardFiles.ts`,
`copyPaths`/`deletePaths` in `workspaces.ts`, `components/ContextMenu.tsx`.

**15.1, 15.3 (Cmd-click half), 15.6 and the horizontal half of 15.8 are
automated as A4.** The rest need Finder, a menu action or a resized window, and
stay manual.

| # | Steps | Expected |
|---|-------|----------|
| 15.1 | Click a file, Cmd+C, click a folder, Cmd+V | The file is copied into that folder. Pasting onto a *file* targets its parent folder; pasting a folder onto itself duplicates it alongside ("name copy") |
| 15.2 | Right-click a file → **Copy**, then click a folder and press Cmd+V | Works. The original bug: the menu's button took focus and was then unmounted, leaving `document.activeElement` on `<body>`, so the "is the tree focused" guard killed every tree shortcut right after a right-click |
| 15.3 | Cmd-click a second row, Shift-click a third | Cmd toggles single rows, Shift takes the whole **visible** range (across roots and past collapsed folders); modified clicks never open a file or expand a folder |
| 15.4 | Select several files → Cmd+C → paste into a folder | All of them land there; the menu reads "Copy N Items"; a failure on one entry still copies the rest and reports the failures afterwards |
| 15.5 | Copy a file in Finder → Cmd+V in the tree | The real file is copied in. Reverse: Cmd+C in the tree, then paste in Finder (macOS writes `NSFilenamesPboardType`; Windows falls back to plain text, so only in-app paste works there) |
| 15.6 | Select 2 files, press Backspace → Confirm | Both go to Trash in one batch; workspace roots are never trashed (they only offer "Remove from Workspace") |
| 15.7 | Focus the editor or terminal (or the git commit box) and press Cmd+C / Cmd+V / Backspace | Nothing happens to the tree selection - the shortcuts only fire while the last click was inside `data-surface="tree"` and focus isn't in a text field |
| 15.8 | Sidebar docked **right**: right-click the lowest row, and the *workspace root* row (its menu is the widest - "Remove from Workspace") | The menu flips to the other side of the cursor and stays fully inside the window (the original bugs: it ran off the right/bottom edge; then it was measured at the cursor, where a shrink-to-fit box only gets the leftover space, so a wide menu still hung over the right edge after flipping). In a window shorter than the menu it clamps and scrolls instead |
| 15.9 | Right-click a row, press Escape | The menu closes (Escape is checked before dictation/read-aloud) |

---

## 16. HTTP client (the parts that need a real network or the native menu)

Guards: `src/main/http.ts`, `src/renderer/src/lib/http/*`,
`src/renderer/src/components/HttpResponsePane.tsx`.

**Automated as A12** (loopback server): status line, headers, pretty-printing,
clipboard, Cmd+Enter, both file extensions (`.http` and `.rest`),
curl-in-a-shell-script, refused flags, the HTTP Client tab, and the history.

| # | Steps | Expected |
|---|-------|----------|
| 16.1 | Put the cursor in a request block and press **Cmd+Enter** with the editor *unfocused* (click the tab strip first) | The Edit ▸ Run HTTP Request accelerator fires it - CDP-injected keys never reach the native menu, so A12 can only prove the Monaco binding |
| 16.2 | Click the **▶ Run** CodeLens above a block, and above a bare `curl` in a `.md`/`.sh` | Both run. A12 asserts the lens *exists* in both places (and stays away from `curl … | jq`); clicking it is the manual half |
| 16.3 | Run a request against an HTTPS host with a self-signed certificate, with and without `# @insecure` (or curl's `-k`) | Without it: a certificate error in the pane. With it: the response - and the app's *other* networking (updater, Google Tasks) still validates certificates, because -k only relaxes its own session partition |
| 16.4 | Run a request that redirects (3xx) with and without `# @no-redirect` / `-L` | Followed: the final response plus an "n redirects" note. Not followed: the 3xx itself with its `Location` header |
| 16.5 | Request a response larger than 8 MB | The body is truncated with a visible note, and the app stays responsive |
| 16.6 | Request an image (`image/png`) | It renders in the Body tab instead of showing bytes |
| 16.7 | Start a slow request and press **Cancel** | It stops, the pane says Cancelled, and no late response overwrites a newer one |
| 16.8 | Drag the pane's left edge, quit, relaunch | The width is restored (`httpPaneWidth` in settings.json) |
| 16.9 | In the HTTP Client tab, copy a `curl` command to the clipboard and press the paste button | Method, URL, headers and body are filled in from it; an unsupported flag reports itself instead of filling half a request |
| 16.10 | Send from the tab, quit, relaunch, reopen the tab | The form comes back as it was left (`extensions.httpClient.request`), and the history is still there (`httpHistory.json` in the app's data directory) |
| 16.11 | Run a `.http` request whose body comes from a file (`< ./payload.json`) or a multipart form, then open it from the history | Method, URL and headers are filled in, and the form says outright which part of it can't live in a form - A12 only covers the text-body case |

---

## 17. Cmd+K clears the terminal

Guards: `src/renderer/src/components/Terminal.tsx`,
`src/renderer/src/hooks/useTerminals.ts`, the `toggle-git-panel` routing in
`src/renderer/src/App.tsx`.

**Automated as A8** only as far as the routing goes: the action reaching the
terminal rather than the git panel. What it *looks like* can't be automated -
xterm's rows keep their old text when the window isn't frontmost even though
the buffer really was cleared, so any DOM assertion here measures window
stacking (see "Ground truth" above). The accelerator itself is a native-menu
one and is unreachable from CDP either way.

| # | Steps | Expected |
|---|-------|----------|
| 17.1 | Open the terminal, run something with plenty of output (`ls -la /usr/bin`), click into it and press **Cmd+K** | The scrollback goes; the prompt stays where it is and the shell keeps running (`echo $$` still answers with the same pid) |
| 17.2 | Type half a command (don't press Enter), press **Cmd+K** | The half-typed command is still on the prompt line - the shell never saw the key |
| 17.3 | With two terminal tabs, clear one and switch to the other | Only the active one was cleared |
| 17.4 | Click into the editor or the file tree and press **Cmd+K** | The git panel toggles, as before |
| 17.5 | Open a long file, scroll to its end with the terminal open | The last line is reachable and sits just above the panel - the editor is sized to what the panel leaves, not covered by it |
| 17.6 | Drag the panel's top edge to the top of the window, then make the window short | The editor keeps a usable strip (~120px); the panel gives way rather than squeezing it out |

---

## 18. Path allowlist — the ways a file legitimately comes from outside

Guards: `src/main/pathAccess.ts`, the `getPathForFile` grant in
`src/preload/index.ts`, `openFileInApp` in `src/main/index.ts`.

**The refusals are automated as A11.** These are the grants, and every one of
them needs a real OS gesture the suite can't perform (drag from Finder, Open
With, a native dialog), so they stay here. Each must still work — a regression
shows up as "that path is outside the open workspaces" on a file the user
opened themselves.

| # | Steps | Expected |
|---|-------|----------|
| 18.1 | Drag a file from Finder that is outside every workspace onto the window | It opens, edits autosave to it, and the tab survives a restart (the grant is re-issued from the recent-external list) |
| 18.2 | Finder → Open With → AuraPad, on a file outside every workspace | Same: opens, edits save. Also with the app not running (launch-with-file path) |
| 18.3 | Quick Open → type `~/` and walk to a file outside every workspace | Listing shows entries; opening one works, and saving into it works |
| 18.4 | Sidebar → "recently opened outside" → reopen one of the files from 18.1–18.3 after a restart | Opens and saves |
| 18.5 | Copy a file in Finder, then paste into the tree | Pastes in — the OS clipboard's paths are granted when read |
| 18.6 | Open a terminal on a folder from the tree, and via the toolbar with no folder selected | Both start (workspace folder / `$HOME`); the shell's own `cd /anywhere` is unaffected — the allowlist covers the spawn's cwd, not what the user types into the shell |
| 18.7 | Remove a workspace whose file is open in a tab, then edit that tab | Saving fails with the allowlist message rather than writing into a folder the user just detached (expected; reopen the workspace to continue) |

---

## 19. Tearing a tab out with the mouse

Guards: the `onDragEnd` branch in `components/TabBar.tsx`, `moveTabToWindow` in
`hooks/useTabs.ts`, `open-in-new-window` / `move-tab-to-primary` in
`src/main/index.ts`.

**The menu route is automated as A15.** The drag itself is a real HTML5 drag
that has to end outside the window, which CDP's synthetic mouse events can't
produce - hence by hand.

| # | Steps | Expected |
|---|-------|----------|
| 19.1 | With two or more tabs open, drag one off the strip and drop it outside the window | A second window opens with that file; the tab is gone from the first window |
| 19.2 | In that window, drag its only tab outside | The tab reappears in the main window and the second window closes |
| 19.3 | Type in a torn-off window's editor, then drag the tab back before autosave runs (~1.2 s) | The edits are in the main window's tab - the buffer is flushed before the move |
| 19.4 | Open a terminal in the main window, then reload the torn-off window (Cmd+R) | The main window's terminal keeps running (ptys are owned per window) |
| 19.5 | Close the last tab in a torn-off window with its × | The window closes with it (the context-menu route is automated as A15; the × is not) |
| 19.6 | Tear a tab off, then quit and relaunch | Only the main window comes back, with the session it had - a torn-off window is not part of the persisted session |

---

## 20. Spell checking with a real dictionary

Guards: `src/main/spellDictionaries.ts`, `lib/spell/hunspell.ts`, the
quick-fix provider in `hooks/useSpellcheck.ts`.

**A18 covers everything a planted fixture dictionary can reach.** What it
can't: the download (network), and Monaco's own quick-fix menu, which the
lightbulb opens through the editor's context menu.

| # | Steps | Expected |
|---|-------|----------|
| 20.1 | Settings → Voice & Language → Spelling → download English | Progress spinner, then "Installed"; `userData/dictionaries/en` holds index.aff, index.dic and license |
| 20.2 | Open a `.md`, write "Ths is a sentnce with two typos." | Both misspellings get a squiggle within a second; the toolbar shows 2 |
| 20.3 | Put the cursor in one and press `Cmd+.` | Corrections are offered, and applying one replaces the word |
| 20.4 | Choose "Add … to Dictionary" on a word the dictionary lacks | The squiggle goes, the count drops, and the word is listed under "Your words" in the Spelling dialog |
| 20.5 | Download Russian too, then write a Russian sentence with an English term in it | Neither the Russian words nor the English term are flagged - every loaded dictionary gets a say |
| 20.6 | Paste a fenced code block, a URL and a file name into the same document | None of them are underlined |
| 20.7 | Remove the dictionary from the Spelling dialog | The squiggles disappear and `userData/dictionaries/<lang>` is gone |

---

## Pre-release smoke

```bash
npm run smoke
```

~20 s, and it covers everything the old six-step manual list did except the
parts automation can't reach. Then, by hand, in your own build:

1. **Cmd+B, Cmd+S, Cmd+W, Option+Cmd+L, Cmd+K** — the native-menu accelerators (a
   toolbar-button pass in A7/A9 does not prove the menu is still wired; Cmd+K
   has to be tried both in the terminal and outside it, 17.1/17.4).
2. **Quit with an unsaved tab** — the prompt appears, declining keeps the app
   open, and a later plain window close doesn't quit it (2.1–2.2).
3. **"Open Folder"** — the native picker adds a workspace.
4. **A real HTML report** with a nested `document.write` iframe (12.2).
5. **Undo across a preview toggle** (4.2) — Monaco's undo stack isn't
   observable from outside the editor.
