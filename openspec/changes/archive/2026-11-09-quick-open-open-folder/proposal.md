# Proposal

## Why

In quick open (double `Shift`), path mode (`~/…`, `/…`) can open a single file outside the
workspaces, but a folder like `~/.claude` can only be stepped into inside the dialog. As soon as
you pick a file, the dialog closes, and to look at the next file you have to type the path
again. There is no way to keep such a folder open and browse it the way the tree browses a
project, short of adding it as a permanent workspace through the native dialog.

## What Changes

- In quick open's path mode, `Cmd+Enter` / `Cmd`+click on a folder opens it in the sidebar tree
  as a **temporary folder** and closes quick open. Plain `Enter` / click still steps into the
  folder inside the dialog, as today.
- A temporary folder shows as its own root in the tree, marked as temporary. You can expand it,
  open files from it, and get live updates from disk, the same as a workspace. It is not saved to
  the workspace list and is gone after the app restarts.
- Its context menu offers "Close Temporary Folder" instead of "Remove from Workspace". Adding the
  same folder through Add Folder turns it into a normal, persistent workspace.
- If the folder is already a workspace, or is inside one, `Cmd+Enter` reveals it in the tree
  instead of adding a duplicate root.
- The home folder itself and the filesystem root `/` cannot be opened as a temporary folder,
  because walking either one would scan far too much.
- Files opened from a temporary folder are remembered in "Recently Opened (Outside)", the same
  as other outside files, so their tabs still restore after a restart.
- The README, `docs/TEST_CASES.md` and the smoke suite are updated.

## Capabilities

### New Capabilities

- `temporary-folders`: opening a folder outside every workspace as a non-persistent root in the
  sidebar tree, from quick open's path mode: how it is opened, shown, used, closed, promoted, and
  what survives a restart.

### Modified Capabilities

None. There are no main specs in `openspec/specs/` yet.

## Impact

- `desktop/src/main/workspaces.ts`: an in-memory list of temporary roots, folded into the root list
  that trees, the watcher, search, git status and the path allowlist already read. The persisted
  list is kept separate.
- `desktop/src/main/ipcHandlers.ts`, `desktop/src/shared/ipc.ts`: a new `open-temporary-folder`
  call, and changes to `add-workspace` / `remove-workspace`.
- `desktop/src/shared/fileNode.ts`: an `isTemporary` flag on root nodes.
- Renderer: `FileSearch.tsx` (`Cmd+Enter`, hint), `App.tsx` (routing, the recent-outside list),
  `useWorkspaceTree.ts`, `FileTree.tsx` (marker), `TreeContextMenu.tsx` (close label).
- Smoke: a new case module, plus a row in `docs/TEST_CASES.md` Part A.
- No server changes.
