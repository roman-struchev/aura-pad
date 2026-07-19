# Feature Ideas & Improvements

Curated backlog from a full code review (v1.27.0). Ordered by expected value for AuraPad's
positioning: a fast, zero-config editor that stays out of the way.

## High value, fits the product

- **Command palette (`Cmd+Shift+P`)** — one searchable entry point for every action that
  today lives in scattered shortcuts (dictation, translate, preview, git, terminal).
  Cheap to build: the menu-action dispatcher in `App.tsx` already enumerates most actions.
- **Encoding support (cp1251 / latin1 / auto-detect)** — today every file is read as UTF-8;
  legacy non-UTF-8 text renders as `�` and autosave then writes the replacement characters
  back, silently corrupting the file. Detect encoding on open (`jschardet` + `iconv-lite`),
  show it in the status area, save back in the original encoding. This is both a feature
  and a data-loss fix.
- **Project-wide replace** — GlobalSearch already finds matches across all workspace roots;
  adding replace (with per-match preview and confirm) completes the story.
- **Split view (two editors side by side)** — the most-missed editor feature at this tier.
  Monaco makes the editor part easy; the tab model needs a `group` field.
- **Merge-conflict UX** — conflicted files (`UU`) currently show up as plain "modified" in
  both staged and unstaged lists, and "Discard" on them silently destroys both sides.
  Detect conflict state, badge it, and offer "Accept ours / theirs / open file".
- **Monaco diff editor in the Git panel** — replace the text diff with Monaco's side-by-side
  `DiffEditor` (already bundled, zero new deps), with intra-line highlights.
- **Dictation voice commands** — "new line", "comma", "delete that" handled locally after
  Whisper transcription; big usability win for the flagship voice feature.
- **EditorConfig / indent auto-detect** — respect `.editorconfig` and detect tabs-vs-spaces
  per file; today's fixed settings quietly fight foreign codebases.

## Solid quality-of-life

- **Navigation history** (`Ctrl+-` / `Ctrl+Shift+-`) — jump back/forward across cursor
  locations and tabs; pairs well with the existing quick-open.
- **Outline / symbols dropdown** — Monaco already computes document symbols for TS/JS;
  a breadcrumb or `Cmd+Shift+O` list is nearly free.
- **Per-workspace sessions** — restore open tabs per folder set, not one global session.
- **Git: stash UI + inline change gutter** — colored gutter bars for modified lines in the
  editor (git diff against HEAD is already available over IPC).
- **Snippets** — a simple user-defined snippets file wired into Monaco's completion.
- **Read-aloud: highlight the sentence being spoken** — sync editor selection with Piper
  playback progress.
- **Zen / focus mode** — hide sidebar, tabs and terminal with one shortcut.

## Platform & trust improvements

- **Sign + notarize macOS builds** — removes the "app is damaged" workaround, enables the
  standard Squirrel auto-update path, and eliminates the current `curl | bash` updater
  (which pipes an unpinned script from the `main` branch into bash).
- **Ship the declared Windows/Linux builds** — `electron-builder.yml` and the updater
  support win/linux, but CI builds macOS only; either publish those artifacts or trim the
  config until then.
- **Harden HTML preview** — render previews in a separate `BrowserView`/window with no
  preload instead of an `allow-same-origin` iframe; today a previewed HTML file can call
  `window.parent.api.*` (full file-system IPC) the moment preview is toggled.
- **Path allowlisting in main-process IPC** — restrict `read-file`/`save-file`/`delete-path`
  to workspace roots (+ explicitly opened externals) as a second line of defense, and
  re-enable `sandbox: true` for the renderer.
- **Encrypt Google refresh tokens** with Electron `safeStorage` (Keychain/DPAPI) instead of
  plaintext JSON in userData.
- **Accessibility pass on modals** — focus trap, autofocus on the primary control,
  Enter-to-confirm, and focus restore on close (one shared `Modal.tsx` fix covers all
  dialogs).

## Performance track (prerequisite for "instant" feel on big repos)

- Memoize the render core: `App.tsx` re-renders the entire tree (recursive FileTree
  included) on every keystroke; `fileStates` from `useGitStatus` breaks memoization by
  identity.
- Switch Monaco to uncontrolled models (`keepCurrentModel`) — also fixes undo-stack loss
  when toggling preview or switching to the Tasks tab.
- Incremental file-tree updates + virtualization instead of a full synchronous re-walk of
  every workspace on each fs event.
- Cache settings/workspaces in the main process instead of re-reading JSON from disk on
  every fs event and git call.
