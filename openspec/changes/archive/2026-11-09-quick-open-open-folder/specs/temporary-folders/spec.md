# Spec Delta

## Purpose

Lets the user open a folder that lives outside every workspace (for example `~/.claude`) in the
sidebar tree for the current session, to browse and edit its files without adding it as a
permanent workspace.

## ADDED Requirements

### Requirement: Cmd+Enter in quick open's path mode opens a folder in the tree
In quick open's path mode (a query starting with `~` or `/`), pressing `Cmd+Enter`, or
`Cmd`+clicking, on a folder result SHALL open that folder in the sidebar tree as a temporary
folder, reveal it, and close quick open. A plain `Enter` or click on a folder SHALL keep stepping
into it inside the dialog.

#### Scenario: Open ~/.claude in the tree
- **WHEN** the user types `~/.cl` in quick open, selects the `.claude` folder result and presses `Cmd+Enter`
- **THEN** quick open closes and the tree shows `.claude` as a root marked as temporary

#### Scenario: Plain Enter still steps in
- **WHEN** a folder result is selected in path mode and the user presses `Enter`
- **THEN** quick open stays open and lists that folder's contents

#### Scenario: Cmd+Enter on a file
- **WHEN** a file result is selected in path mode and the user presses `Cmd+Enter`
- **THEN** the file opens in a tab, as with `Enter`

### Requirement: Quick open advertises browsing outside folders
Quick open SHALL tell the user that a query starting with `~/` or `/` browses any folder on disk.
Its input placeholder and its empty-query hint SHALL both mention it.

#### Scenario: Hint on an empty query
- **WHEN** the user opens quick open with an empty query
- **THEN** the placeholder and the hint below the input both mention `~/` for browsing folders

### Requirement: A folder row offers Open in Tree
In path mode, the selected or hovered folder row SHALL show an "Open in Tree" action together
with its shortcut (`⌘↵`). Clicking that action SHALL do the same as `Cmd+Enter` on the row. File
rows SHALL NOT show it.

#### Scenario: Action on the selected folder
- **WHEN** a folder row is selected in path mode
- **THEN** the row shows "Open in Tree" with `⌘↵`, and clicking it opens the folder as a temporary folder and closes quick open

#### Scenario: Not on files
- **WHEN** a file row is selected in path mode
- **THEN** no "Open in Tree" action is shown on it

### Requirement: A folder already covered by a workspace is revealed, not duplicated
If the folder chosen with `Cmd+Enter` is a root that is already open (workspace or temporary), or
lies inside one, the system SHALL reveal it in the tree and SHALL NOT add another root.

#### Scenario: Folder inside a workspace
- **WHEN** the user picks `<workspace>/src` in path mode with `Cmd+Enter`
- **THEN** no root is added and `src` is revealed in the tree

### Requirement: Home and filesystem root are refused
The system SHALL refuse to open the user's home folder itself, or the filesystem root `/`, as a
temporary folder, and SHALL tell the user why. Folders below them SHALL be allowed.

#### Scenario: Home folder refused
- **WHEN** the user picks `~` itself with `Cmd+Enter`
- **THEN** no root is added and a message explains that the folder is too large to open in the tree

### Requirement: A temporary folder behaves like a workspace for the session
A temporary folder root SHALL list its contents with the same hiding rules as a workspace, follow
changes on disk, and allow the same file operations (open, edit, save, create, rename, delete)
as files inside a workspace. Files under it SHALL appear in quick open's workspace search and in
search-in-files.

#### Scenario: Open and save a file from it
- **WHEN** the user opens a file from a temporary folder in the tree, edits it, and saves
- **THEN** the change is written to disk

#### Scenario: New file shows up
- **WHEN** a file is created in a temporary folder outside the app
- **THEN** the tree shows it without a manual refresh

### Requirement: Temporary folders are visibly marked
A temporary folder's root row SHALL carry a visible marker that tells it apart from a persistent
workspace root, readable in every theme.

#### Scenario: Marker shown
- **WHEN** a temporary folder is open
- **THEN** its root row shows a "temporary" marker and persistent workspace roots do not

### Requirement: Temporary folders are not persisted
A temporary folder SHALL NOT be written to the saved workspace list, and SHALL NOT be present
after the app restarts.

#### Scenario: Gone after restart
- **WHEN** the user opens a temporary folder and restarts the app
- **THEN** the tree shows only the persistent workspaces

### Requirement: Tabs from a temporary folder survive a restart
A file opened from a temporary folder SHALL be recorded as an outside file, the same as a file
opened through path mode, so that its tab is restored and readable after a restart even though
the folder is no longer open.

#### Scenario: Tab restored
- **WHEN** a file from a temporary folder is open in a tab and the app restarts
- **THEN** the tab is restored with the file's content

### Requirement: Closing and promoting a temporary folder
The context menu of a temporary folder root SHALL offer "Close Temporary Folder", which removes
the root from the tree and leaves the files on disk untouched. Adding the same folder through
Add Folder SHALL turn it into a persistent workspace without duplicating the root.

#### Scenario: Close
- **WHEN** the user chooses "Close Temporary Folder" on its root
- **THEN** the root disappears from the tree and the folder still exists on disk

#### Scenario: Promote
- **WHEN** a temporary folder is open and the user adds that same folder through Add Folder
- **THEN** the tree shows a single root for it, without the temporary marker, and it is still there after a restart
