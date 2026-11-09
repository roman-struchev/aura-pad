# Design

## Context

- Roots come from `loadWorkspaces()` in `desktop/src/main/workspaces.ts`, the persisted
  `workspaces.json`. The same function feeds `getWorkspaceTrees()`, the recursive `fs.watch`
  setup (`watcher.ts`), `searchInWorkspaces`, git statuses, and the path allowlist
  (`pathAccess.ts` → `allowedRoots()`). `add-workspace` / `remove-workspace` read it, edit it,
  save it, and call `setupWatchers()`.
- Path mode's `list-path-matches` grants every listed path for the session, and a granted
  folder covers everything under it. So a folder the user can see in path mode is already
  readable and writable. A temporary root does not widen access beyond what the listing already
  gave.
- Root `FileNode`s carry `isRoot`. The renderer treats every root alike (context menu, git
  branch, `rootPaths` for the recent-outside list in `App.tsx`).
- `FileSearch.tsx` path mode: `Enter` on a folder rewrites the query to `<dir>/`, and `Enter` on a
  file calls `onSelect(path, 'file')`.

## Goals / Non-Goals

**Goals:**
- One temporary root list in main that every root consumer sees, with no consumer changing.

**Non-Goals:**
- Showing dot-entries inside a temporary folder. The tree's hiding rules apply as they do to
  workspaces. The folder itself may be a dot-folder (`~/.claude`), because roots are never
  filtered.
- A "keep as workspace" menu item. Promoting goes through Add Folder.
- Opening folders with `Cmd+Enter` in workspace (non-path) mode, where `Enter` on a folder
  already reveals it.

## Decisions

**Temporary roots live in main, in memory, inside `loadWorkspaces()`.** `workspaces.ts` gets
`temporaryRoots: string[]` and `loadPersistedWorkspaces()` (the old body). `loadWorkspaces()`
becomes persisted ∪ temporary, deduplicated. Every consumer (trees, watcher, search, git,
allowlist) then covers temporary roots for free. `add-workspace` / `remove-workspace` switch to
`loadPersistedWorkspaces()` before saving, so a temporary root never reaches `workspaces.json`.
*Alternative:* a renderer-only root that main does not know about. Rejected because watching,
search and git would each need a second path.

**`open-temporary-folder(path)` IPC with checks done in main.** It returns
`{ trees } | { error }`. It refuses when `pathDenial(path)` is set (the renderer cannot name a
path it never saw listed), when the path is not a directory, and when it resolves to `/` or
`os.homedir()`. If the path equals or lies under an existing root, it returns the trees
unchanged (the renderer reveals it). Otherwise it appends to `temporaryRoots`, calls
`setupWatchers()`, and returns `getWorkspaceTrees()`. Because the main process owns the list, a
renderer reload keeps temporary roots, while an app restart drops them (process memory).

**`isTemporary` on root nodes.** `getWorkspaceTrees()` sets it for paths in `temporaryRoots` that
are not also persisted. `FileTree` renders a small "temp" label (`text-fleet-text` /
`accent-info` tokens, not fixed colours). `TreeContextMenu` shows "Close Temporary Folder" for
those roots. Closing uses the existing `remove-workspace`, which now also drops the path from
`temporaryRoots`.

**Promotion.** In `add-workspace`, a selected path that is a temporary root is removed from
`temporaryRoots` and persisted, so `loadWorkspaces()` still lists it once.

**Recent-outside list.** The tab effect in `App.tsx` builds `rootPaths` from non-temporary roots
only. Tabs under a temporary folder are then touched into "Recently Opened (Outside)", which
persists the grant, so the tabs restore after a restart. When the folder is promoted, the
existing cleanup in the same effect removes those entries.

**Quick open wiring.** `activateResult(row, { reveal })`: in path mode, a folder row with `reveal`
calls a new `onOpenFolder(path)` prop. Key handler: `Enter` with `metaKey`. Click handler:
`e.metaKey`. App's `onOpenFolder` calls `tree.openTemporaryFolder(path)`, which invokes the
IPC, sets the trees, sets the reveal path, and shows an error toast/dialog if main refused. The
path mode footer hint becomes `Tab Complete · ⌘Enter Open in Tree`.

**Discoverability is on the row, not in the footer.** The footer is 9px grey text that nobody
reads, and path mode itself is not mentioned anywhere in the dialog today. Two additions:
- The placeholder and the empty-query hint gain `~/ or / to browse any folder`, so path mode
  can be found from the dialog itself.
- In path mode, a folder row that is selected or hovered shows, on the right, a button labelled
  "Open in Tree" with a folder-arrow icon and a `⌘↵` key hint. The button is marked
  `data-quick-open-open-in-tree` for the smoke suite. Its `onClick` calls `stopPropagation()` and
  then `activateResult(row, { reveal: true })`, so it does not also step into the folder. The
  button is visible on the selected row and on hover (`group-hover`), so a mouse user finds it
  without moving the selection first. It uses theme tokens only.
*Alternative:* a context menu on result rows. Rejected because it is just as hidden as the
shortcut.

## Risks / Trade-offs

- [A large folder (for example `~/Library`) is slow to walk and watch] → `/` and home are
  refused outright. Anything else is the user's explicit choice, the same as adding it as a
  workspace. The tree build is already async and yields.
- [Temporary roots widen what search-in-files and git scan] → this is intended: they are roots
  for the session.
- [A grant persisted through the recent-outside list outlives the folder] → this matches how a
  single outside file opened through path mode already behaves, and it is limited by that list's
  retention policy.
