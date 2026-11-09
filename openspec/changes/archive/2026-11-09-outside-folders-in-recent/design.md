# Design

## Context

- The archived `quick-open-open-folder` change added in-memory `temporaryRoots` to
  `loadWorkspaces()` in `desktop/src/main/workspaces.ts`, an `isTemporary` root flag, the
  `open-temporary-folder` IPC, a `temp` marker in `FileTree.tsx` and "Close Temporary Folder" in
  `TreeContextMenu.tsx`. In `FileSearch.tsx` it added `onOpenFolder` (`Cmd+Enter`, `Cmd`+click,
  the row button). In `App.tsx` it filtered temporary roots out of the recent-outside tab effect.
- "Recently Opened (Outside)" (`Sidebar.tsx`) is a flat list of file paths from
  `recentExternalFiles.json`, held by main (`recentExternalFiles.ts`). Entries are touched on
  every open tab outside the roots, dropped after 7 days, and × removes one and closes its tab.
- `pathAccess.ts` treats every entry of that list as a grant, and a granted directory covers
  everything under it. A folder entry therefore already gives read/write access to its subtree
  across restarts, with no new access rule.
- `watcher.ts` watches each root in `loadWorkspaces()` recursively and broadcasts
  `workspaces-changed` on structural events.

## Goals / Non-Goals

**Goals:**
- Folder entries in the outside section, built from the same pieces as the workspace tree
  (`buildFileTree`, `FileTree`, the tree's operations), with no new access model.

**Non-Goals:**
- Search, git and quick open's workspace search over outside folders. This was decided against.
- Showing dot-entries inside an outside folder. The tree's hiding rules apply. The folder itself
  may be a dot-folder.
- Migrating temporary roots. They lived only in process memory, so nothing is persisted.

## Decisions

**Entries gain a `type`.** `RecentExternalFile` becomes `{ path, openedAt, type?: 'file' |
'directory' }`, where a missing `type` reads as `'file'`, so existing JSON keeps working. New
main functions: `touchRecentExternalFolder(path)`, and `loadOutsideFolders()` (entries with
`type: 'directory'` that still exist on disk).

**`open-outside-folder(path)` replaces `open-temporary-folder`.** Main applies the same refusals
as before: `pathDenial`, not a directory, `/` or home. A path that a workspace covers returns
`{ covered: true }` so the renderer reveals it in the workspace tree. Otherwise main touches the
folder entry, calls `setupWatchers()`, and returns `{ entries, outsideTrees }`. A renderer
cannot add a path it was never shown, because the path-mode listing is what granted it.

**Trees come from main.** `getOutsideFolderTrees()` runs `buildFileTree(p, p, loadGitignore(p),
true, …)` for each folder entry, so the hiding rules match workspaces. A new
`get-outside-folder-trees` call loads the trees on start, and an `outside-folders-changed` event
pushes them on change. They are deliberately not part of `loadWorkspaces()`, which is what keeps
search, git, the quick open flat list and diagnostics away from them. *Alternative:* building
the tree lazily in the renderer, one directory per expand. Rejected because it would need a
second tree component and still need watching.

**Watching.** `setupWatchers()` iterates `loadWorkspaces()` ∪ `loadOutsideFolders()`. For an
outside root, `handleFsWatchEvent` skips the git refresh and broadcasts `outside-folders-changed`
instead of `workspaces-changed`. Content events (`file-changed-externally`) are unchanged.
`setupWatchers()` is re-run whenever folder entries are added or removed.

**Rendering.** In `Sidebar.tsx`, a folder entry renders `<FileTree node={tree} …>` with the same
props as workspace roots (selection, reveal, context menu, drag), plus an × at the root row.
`FileTree` is reused rather than forked. The root row is styled as a normal folder, with no git
branch button, because `rootBranch` is undefined.

**Tree operations see outside nodes.** `useWorkspaceTree` keeps `outsideNodes` next to
`rootNodes`, and every `findNode` / visible-rows lookup uses `[...rootNodes, ...outsideNodes]`.
Create, rename, delete and move already go through main by path, and the allowlist already admits
those paths. Their returned `trees` refresh only the workspace forest. The outside forest
refreshes through the watcher event, and also by an explicit `getOutsideFolderTrees()` after
each operation so the UI does not wait on fs events. Root-only actions ("Remove from Workspace")
stay hidden on outside roots, which carry `isOutside: true` instead of `isRoot`'s workspace
meaning.

**Touching and dedup.** The App tab effect skips paths under a listed folder. For such a tab it
touches the folder instead, which keeps the folder from aging out. The cleanup pass also removes
file entries that now fall under a listed folder, and folder entries under a workspace root,
which covers promotion through Add Folder.

**Removing.** `handleRemoveRecentExternalFile(path)` closes every tab whose path is `path` or
lies under it, removes the entry, and `remove-recent-external-file` re-runs `setupWatchers()`.
The session grant stays until restart, the same as for removed file entries today.

**Quick open.** `onOpenFolder` keeps its contract, and only App's handler changes: it calls
`openOutsideFolder`, which either reveals the folder in the workspace tree or reveals the
outside entry expanded. The button label becomes "Open in Sidebar" and keeps
`data-quick-open-open-in-tree`. The footer hint becomes `⌘Enter Open in Sidebar`.

**Removal of temporary roots.** `temporaryRoots`, `isTemporaryRoot`, `add/removeTemporaryRoot`,
`isTemporary`, the marker, the menu label branch and the App root filter are deleted.
`loadPersistedWorkspaces` folds back into `loadWorkspaces`.

## Risks / Trade-offs

- [A large outside folder is walked and watched at every start, not just for one session] →
  home and `/` are refused, entries age out after 7 days without use, and × removes one.
- [Reveal, selection and range-select now span two forests] → visible-row order is built from
  workspace roots first, then outside roots, which matches how they are painted.
- [A folder that is gone from disk] → `loadOutsideFolders()` skips it, so it neither renders nor
  is watched. The entry still ages out on its own schedule.
