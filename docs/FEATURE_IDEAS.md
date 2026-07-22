# Feature Ideas & Improvements
- На вкладках Files и Git можно убрать имя
- Посмотри на favicon на сервере, тут аналогично лучше сделать
- Добавь информацию в readme про реализонный сервер по фиче work together
- Табы и шапку схлопнуть как в obsidian, а иконки действий для файла тоже вынести как в obsidian или прям на табе показывать, если он активен
- Меню тоже посмотри как в obsidian и сделай какие-то групировки, кнопка Done внизу не нужна, она ничего не делает, крестика достаточно. На модалках аналогично



## Next up: toggle the file-tree sidebar (detailed spec)

Goal: hide/show the whole sidebar (file tree + git panel) with a button and a shortcut,
so the editor can use the full window width. State persists across restarts.

This is a small, self-contained change. Everything below is already wired the way the
steps assume — follow them in order.

1. **Settings flag.** In `src/shared/settings.ts` add `sidebarVisible: boolean` to
   `AppSettings` and set it to `true` in `DEFAULT_SETTINGS`. (The settings loader in
   `src/main/settings.ts` already deep-merges defaults, so old config files pick this up
   automatically — no migration needed.)

2. **Read it in App.** `src/renderer/src/App.tsx` already destructures
   `const { settings, updateSetting } = useSettings()`. Add a toggle helper near the other
   handlers:

   ```ts
   const toggleSidebar = (): void => updateSetting('sidebarVisible', !settings.sidebarVisible)
   ```

3. **Conditionally render the sidebar.** In `App.tsx` the sidebar is the outer
   `<div ref={sidebarRef} ...>` that wraps `<Sidebar .../>` (right after the editor
   column, look for `style={{ width: ... sidebarWidth.width ... }}`). Wrap that whole
   `<div>` in `{settings.sidebarVisible && ( ... )}`. Do NOT remove `sidebarRef` usage —
   keep the ref on the div; when hidden the div just isn't rendered, which is fine (the
   tree-focus keyboard checks in `useGlobalHotkeys` already guard on
   `sidebarRef.current?.contains(...)`, which is null-safe).

4. **Toolbar button.** `src/renderer/src/components/AppHeader.tsx` renders the right-hand
   button cluster (search / add-folder / terminal / settings). Add a new `ToolbarButton`
   there, following the exact pattern of the existing ones (they take `onClick`, `title`,
   `tooltipAlign="right"`, and an icon child). Use the `PanelLeft` / `PanelLeftClose` icon
   from `lucide-react` (import at the top with the others). Pass a new prop
   `sidebarVisible: boolean` and `onToggleSidebar: () => void` through `AppHeaderProps`
   (add them to the interface), and wire them from `App.tsx` (`sidebarVisible={settings.sidebarVisible}`,
   `onToggleSidebar={toggleSidebar}`). Set `active={!sidebarVisible}` so the button looks
   engaged when the panel is hidden.

5. **Keyboard shortcut via the native menu** (matches how every other AuraPad accelerator
   works — do NOT add a renderer keydown listener):
   - `src/shared/menuAction.ts`: add `'toggle-sidebar'` to the `MenuAction` union.
   - `src/main/menu.ts`: add a View-menu item (near the other view toggles) with
     `accelerator: 'CmdOrCtrl+B'` that sends the `'toggle-sidebar'` action — copy an
     adjacent item's shape exactly.
   - `src/renderer/src/App.tsx`: the `useMenuActions({...})` call maps action names to
     handlers; add `'toggle-sidebar': toggleSidebar`.

6. **Verify** (see `.claude/skills/verify`): launch with an isolated profile, click the new
   button and confirm the sidebar disappears and the editor widens; press `Cmd+B` to toggle
   it back; restart the app and confirm the last state is restored (it's in `settings.json`).

Keep it minimal: no animation is required (a hard show/hide is fine and matches the app's
snappy feel). `sidebarWidth` / resize behavior is untouched — a hidden sidebar simply isn't
in the layout.

## High value, fits the product

- **Command palette (`Cmd+Shift+P`)** — one searchable entry point for every action that
  today lives in scattered shortcuts (dictation, translate, preview, git, terminal).
  Cheap to build: the menu-action dispatcher in `App.tsx` already enumerates most actions.
- ~~Encoding support (cp1251 / latin1 / auto-detect)~~ — **done** (v1.27.0+): `src/main/encoding.ts`
  strict-decodes UTF-8, falls back to `jschardet` + `iconv-lite`, remembers the encoding per
  path and writes it back on save (UTF-16 BOM preserved). Still open as a nicety: show the
  detected encoding in a status area and let the user override it.
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
- **Harden HTML preview (needs a real isolation boundary — two shortcuts already failed).**
  Today preview uses a `srcDoc` iframe with `sandbox="allow-scripts allow-same-origin"`
  (`src/renderer/src/components/HtmlPreview.tsx`). Because `srcDoc` inherits the app's own
  origin, a script in a previewed `.html` can reach `window.parent.api.*` — the full IPC
  surface (read/write/delete any file, connected Google accounts). That's a real
  escalation for untrusted files.

  Do NOT "fix" it either of these ways (both were tried and rejected):
  - **Dropping `allow-same-origin`** gives the doc an opaque origin and closes the hole,
    but breaks real reports: several of the user's java-guild reports
    (`report-port-component`, `report-aggregated`, `report-employees-stats`,
    `report-port-mentor-domain`) decode an inner document and `document.write` it into a
    nested iframe of their own — which throws once the frame is opaque. Verified: those
    reports render blank.
  - **Serving preview from a custom app-private scheme** (so `allow-same-origin` means the
    scheme's origin, not the app's) is the right _idea_ for keeping `window.parent.api`
    cross-origin, but a from-scratch attempt did not render reliably (blank previews) and
    was reverted. If revisited, confirm scripts actually execute and CDN subresources
    (`unpkg`, `cdn.plot.ly`) load inside the framed document before trusting it.

  The dependable fix is a **dedicated `WebContentsView`/child window with its own
  `webPreferences` (no preload, `contextIsolation: true`, `nodeIntegration: false`)**: the
  preview then has no bridge to `api` at all, while keeping full same-origin semantics
  (nested `document.write`, CDN loads) that the reports need. Cost is real: the view must
  be positioned/resized over the editor pane, hidden when the preview toggles off or the
  tab changes, and kept below modals in z-order. Budget it as a feature, not a patch.

- **Path allowlisting in main-process IPC** — restrict `read-file`/`save-file`/`delete-path`
  to workspace roots (+ explicitly opened externals) as a second line of defense, and
  re-enable `sandbox: true` for the renderer.
- **Encrypt Google refresh tokens** with Electron `safeStorage` (Keychain/DPAPI) instead of
  plaintext JSON in userData.
- ~~Accessibility pass on modals~~ — **done** (v1.27.0+): `Modal.tsx` now has a focus trap,
  `[data-autofocus]`/first-focusable autofocus, focus restore on close, and
  Enter-to-confirm via focusing the safe default button (OK / Cancel).

## Performance track (prerequisite for "instant" feel on big repos)

The first four items below were **done** in the v1.27.0 refactor pass; kept here as a record.

- ~~Memoize the render core~~ — done: `TabBar`/`FileTree` are `React.memo` with stable
  callbacks (`lib/useStableCallback.ts`), `fileStates` is memoized in `useGitStatus`.
- ~~Switch Monaco to uncontrolled models~~ — done (`defaultValue` + `keepCurrentModel`);
  also fixed undo-stack loss on preview/Tasks toggles.
- ~~Incremental file-tree updates~~ — done: `useWorkspaceTree` reuses unchanged subtree
  identities (`mergeForest`), and the main-process walk is now async (`fs.promises`).
  Virtualization of very large expanded trees is still open.
- ~~Cache settings/workspaces in main~~ — done: `configFile.ts` caches parsed configs.
- Still open: virtualize the file tree for very large repos.
