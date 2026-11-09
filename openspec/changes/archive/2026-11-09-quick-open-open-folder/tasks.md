# Tasks

## 1. Main: temporary roots

- [x] 1.1 In `desktop/src/main/workspaces.ts`, add in-memory `temporaryRoots`, `loadPersistedWorkspaces()` (the old `loadWorkspaces` body), `addTemporaryRoot` / `removeTemporaryRoot`, and make `loadWorkspaces()` return persisted ∪ temporary, deduplicated. Set `isTemporary` on root nodes in `getWorkspaceTrees()` (temporary and not persisted). Add `isTemporary?: boolean` to `desktop/src/shared/fileNode.ts`. Verify with `npm run typecheck`.
- [x] 1.2 In `desktop/src/main/ipcHandlers.ts`, switch `add-workspace` / `remove-workspace` to `loadPersistedWorkspaces()`. `add-workspace` promotes a temporary root (drop it from the temporary list, persist it), and `remove-workspace` also drops it from the temporary list. Verify with `npm run typecheck` and that smoke cases touching workspaces still pass (`npm run smoke -- A11`).
- [x] 1.3 Add the `open-temporary-folder` IPC in `desktop/src/shared/ipc.ts` and its handler. It refuses on `pathDenial`, on a non-directory, and on `/` or the home folder. It returns the trees unchanged when the path is covered by an existing root, and otherwise adds the path, calls `setupWatchers()`, and returns the trees. Verify with `npm run typecheck` (the preload is generated from `ipc.ts`).

## 2. Renderer: tree and quick open

- [x] 2.1 In `desktop/src/renderer/src/hooks/useWorkspaceTree.ts`, add `openTemporaryFolder(path)`. It calls the IPC, sets the root nodes, reveals the path, and on a refusal shows `alertDialog` with main's message. Verify with `npm run typecheck`.
- [x] 2.2 In `FileTree.tsx`, show a "temp" marker on `isTemporary` roots using theme tokens. In `TreeContextMenu.tsx`, label the root item "Close Temporary Folder" for them. Verify in the smoke case (4.1) that the marker is present and has AA contrast via `ui.contrastOf()`.
- [x] 2.3 In `FileSearch.tsx`, add an `onOpenFolder` prop. In path mode, `Cmd+Enter` / `Cmd`+click on a folder calls it, and on a file it opens the file as `Enter` does. Update the path mode footer hint. Wire `onOpenFolder` in `App.tsx` to `tree.openTemporaryFolder` and close the dialog. Verify through the smoke case (4.1).
- [x] 2.5 In `FileSearch.tsx`, add `~/ or / to browse any folder` to the placeholder and the empty-query hint. In path mode, give folder rows (shown when selected or hovered) an "Open in Tree" button with an icon and a `⌘↵` hint, marked `data-quick-open-open-in-tree`, whose click does the same as `Cmd+Enter` without also stepping into the folder. File rows get no such button. Verify through the smoke case (4.1): the button is present on a selected folder and absent on a file, clicking it opens a temporary root, and its contrast passes AA in the light theme.
- [x] 2.4 In `App.tsx`, build the tab effect's `rootPaths` from non-temporary roots only, so tabs under a temporary folder are touched into "Recently Opened (Outside)". Verify through the smoke case (4.1): after the app relaunches, the tab content is restored.

## 3. Docs

- [x] 3.1 In `README.md`, describe opening an outside folder in the tree with `Cmd+Enter` from quick open's path mode: temporary, not saved, closed from the context menu, promoted through Add Folder. Verify that the section around the quick open / outside-files lines reads consistently.
- [x] 3.2 In `docs/TEST_CASES.md`, add a Part A row for the new smoke case, and extend the §18 Part B (outside files) area if a manual-only check remains (none expected). Verify that the ids match `scripts/smoke/run.mjs`.

## 4. Smoke

- [x] 4.1 Add `desktop/scripts/smoke/cases/tempFolder.mjs` (registered in `run.mjs`). It makes an outside directory with a file and a subfolder, opens quick open, types its path and presses `Cmd+Enter` on the folder. It then checks that the empty-query hint mentions `~/`; that the "Open in Tree" button shows on a selected folder row and not on a file row, and that clicking it opens the folder; that the root appears in `getWorkspaces()` with `isTemporary` and the marker; that plain `Enter` still steps in; that `Cmd+Enter` on home is refused with no root added; that a folder inside the fixture workspace is not duplicated; that a file is opened and saved (checked on disk); that `workspaces.json` does not contain the folder; that a restart drops the root but restores the tab; and that "Close Temporary Folder" removes the root while the folder stays on disk. Verify with `npm run smoke -- <id>` passing.
- [ ] 4.2 Run the full `npm run smoke`, `npm run typecheck` and `npm run lint` (comparing lint output against the baseline). Run the Part B sections of `docs/TEST_CASES.md` whose `Guards:` match the diff, by hand.
  - Done: smoke 456/456, typecheck clean, lint +1 (a `react/prop-types` false positive on `node.isTemporary`, the same one already reported on every other `node.*` access in FileTree). Still open: the manual §18 cases (18.1–18.8 need Finder / Open With / the native folder dialog).
