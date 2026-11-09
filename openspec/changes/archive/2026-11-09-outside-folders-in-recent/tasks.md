# Tasks

## 1. Main: folder entries instead of temporary roots

- [x] 1.1 Remove the temporary roots: `temporaryRoots`, `isTemporaryRoot`, `add/removeTemporaryRoot` and `loadPersistedWorkspaces` (fold it back into `loadWorkspaces`) from `desktop/src/main/workspaces.ts`, `isTemporary` from `src/shared/fileNode.ts`, and the `open-temporary-folder` handler with its `add/remove-workspace` hooks from `ipcHandlers.ts` / `shared/ipc.ts`. Verify with `npm run typecheck` (it will flag the renderer uses that group 2 removes).
- [x] 1.2 Add an optional `type` to `RecentExternalFile`, plus `touchRecentExternalFolder` and `loadOutsideFolders` in `recentExternalFiles.ts`, and `getOutsideFolderTrees()` in `workspaces.ts`. Outside roots carry `isOutside: true`. Verify with `npm run typecheck`, and check that an old `recentExternalFiles.json` without `type` still loads as files (smoke 4.1).
- [x] 1.3 Add the `open-outside-folder` IPC (refusals as before; `{ covered: true }` for a folder a workspace covers; otherwise touch the entry, `setupWatchers()`, and return entries and trees), `get-outside-folder-trees`, and the `outside-folders-changed` event. `remove-recent-external-file` re-runs `setupWatchers()`. Verify with `npm run typecheck`.
- [x] 1.4 In `watcher.ts`, watch `loadOutsideFolders()` too. For those roots, skip the git refresh and broadcast `outside-folders-changed`. Verify through smoke 4.1 (a file created on disk appears in the entry).

## 2. Renderer

- [x] 2.1 In `useWorkspaceTree.ts`, add `outsideNodes` (loaded on start, updated by the event and after each tree operation) and `openOutsideFolder(path)` (reveal in the workspace tree when covered, otherwise reveal the outside entry; alert on refusal). Resolve `findNode`, visible rows and selection over workspace and outside nodes. Remove `openTemporaryFolder`. Verify with `npm run typecheck` and smoke 4.1.
- [x] 2.2 In `Sidebar.tsx`, render folder entries of "Recently Opened (Outside)" with `FileTree` (expand, select, context menu), plus a × on the root row. Remove the `temp` marker from `FileTree.tsx` and the temporary label from `TreeContextMenu.tsx`, and keep "Remove from Workspace" off outside roots. Verify through smoke 4.1, including AA contrast of the entry in the light theme.
- [x] 2.3 In `App.tsx`, remove the temporary-root filter. In the tab effect, touch the containing folder instead of the file for tabs under a listed folder, and drop file entries under listed folders and folder entries under workspace roots. Closing a folder entry closes the tabs under it. `onOpenFolder` goes to `tree.openOutsideFolder`. Verify through smoke 4.1.
- [x] 2.4 In `FileSearch.tsx`, relabel the row button "Open in Sidebar" and change the footer hint to `⌘Enter Open in Sidebar`. Verify through smoke 4.1.

## 3. Docs

- [x] 3.1 In `README.md`, rewrite the outside-folders bullet: Recently Opened (Outside), expandable, kept for 7 days of disuse, × removes it, not searched, and Add Folder turns it into a project. Verify that it reads consistently with the neighbouring "Recently Opened" bullet.
- [x] 3.2 In `docs/TEST_CASES.md`, rewrite the A25 row, and rewrite 18.8 for promotion from the outside section. Update the §18 `Guards:` (remove `open-temporary-folder`, add `recentExternalFiles.ts` / `open-outside-folder`). Verify that the ids match `scripts/smoke/run.mjs`.

## 4. Smoke

- [x] 4.1 Rewrite `desktop/scripts/smoke/cases/temp-folder.mjs` (A25; rename the file to `outside-folders.mjs` and update `run.mjs`). It keeps the quick open checks (hint, button on folders only, Enter steps in, home / never-listed refused, workspace subfolder revealed and not listed), then checks:
  - Cmd+Enter lists the folder in the outside section, expanded, with no workspace root added;
  - a subfolder expands, and a file opens and saves;
  - a file created on disk appears;
  - a file created through the context menu exists on disk;
  - search-in-files finds nothing in it;
  - opening a file in it adds no file entry;
  - the entry and the "Open in Sidebar" button keep AA contrast in the light theme;
  - after a restart the entry is still there and its file still reads;
  - × removes the entry, closes its tabs and leaves the folder on disk;
  - an old-format file entry (no `type`) is still listed after a restart.

  Verify with `npm run smoke -- A25` passing.
- [x] 4.2 Run the full `npm run smoke`, `npm run typecheck` and `npm run lint` (compare against the baseline). The manual Part B §18 cases whose `Guards:` match are handed to the user, since they need Finder / Open With / the native dialog.

## 5. Review follow-ups

- [x] 5.1 Ponytail review fixes, each covered in A25: older nested entries are dropped by the renderer's cleanup (not only prevented on open); removing a file entry no longer restarts every watcher; tree operations no longer re-walk every outside folder (the watcher event does it); a listed folder gone from disk shows as a folder that says so instead of opening as a file. Also from manual testing: listed folders don't nest, and an outside root offers no Rename.
