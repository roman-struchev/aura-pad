# Proposal

## Why

`temporary-folders` shows an outside folder such as `~/.claude` as an extra root next to the
projects. That makes it look like a project: it shows up in search-in-files, in quick open's
workspace search and in git status. A `temp` marker is the only thing that sets it apart, and
it disappears after a restart. The sidebar already has a place for things that live outside
the projects, "Recently Opened (Outside)". That list keeps its entries across restarts and
already grants access to what it lists. Folders belong there.

## What Changes

- Quick open's `Cmd+Enter` / `Cmd`+click / row button on an outside folder adds the folder to
  "Recently Opened (Outside)" and reveals it there expanded, instead of adding a temporary
  root. The row button is renamed **Open in Sidebar**.
- A folder entry in that section expands into a tree. It follows changes on disk and offers
  the tree's file operations (open, create, rename, delete) from its context menu.
- Folder entries follow the section's rules. They survive restarts, age out after 7 days
  without use (opening a file inside one counts as use), and are removed with ×. Removing one
  also closes the tabs of files under it, the way removing a file entry closes its tab. Files
  inside a listed folder are not listed again on their own.
- Outside folders stay out of search-in-files, quick open's workspace search and git status.
- **BREAKING (removed):** temporary roots: the `isTemporary` root flag, the
  `open-temporary-folder` call, the `temp` marker and "Close Temporary Folder".
- Kept as they were: the quick open hints about `~/`, revealing a folder that a workspace
  already covers, and refusing the home folder and `/`.
- The README, `docs/TEST_CASES.md` (A25, §18.8) and smoke case A25 are updated.

## Capabilities

### New Capabilities

- `outside-folders`: opening a folder outside every workspace from quick open into the
  sidebar's "Recently Opened (Outside)" section, browsing and editing it there, and how long it
  stays listed.

### Modified Capabilities

- `temporary-folders`: retired. Every requirement is removed and replaced by `outside-folders`.

## Impact

- Main:
  - `recentExternalFiles.ts`: entries gain a `type`.
  - `workspaces.ts`: temporary roots removed, plus a tree builder for outside folders.
  - `watcher.ts`: watches the listed folders.
  - `ipcHandlers.ts` / `shared/ipc.ts`: `open-temporary-folder` is replaced by
    `open-outside-folder` and `get-outside-folder-trees`, and an `outside-folders-changed`
    event is added.
- Renderer:
  - `Sidebar.tsx`: folder entries rendered with `FileTree`.
  - `useWorkspaceTree.ts`: operations resolve nodes in outside trees too.
  - `useRecentExternalFiles.ts`, `App.tsx`: touching and removing entries.
  - `FileSearch.tsx`: button label.
  - `FileTree.tsx` / `TreeContextMenu.tsx`: temporary-root bits removed.
  - `shared/fileNode.ts`: `isTemporary` dropped.
- Smoke: A25 rewritten.
- No server changes.
