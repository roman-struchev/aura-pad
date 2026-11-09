# outside-folders Specification

## Purpose

Lets the user open a folder that lives outside every workspace (for example `~/.claude`) from
quick open into the sidebar's "Recently Opened (Outside)" section, to browse and edit its files
there without making it a project.

## Requirements

### Requirement: Quick open advertises browsing outside folders
Quick open SHALL tell the user that a query starting with `~/` or `/` browses any folder on disk.
Its input placeholder and its empty-query hint SHALL both mention it.

#### Scenario: Hint on an empty query
- **WHEN** the user opens quick open with an empty query
- **THEN** the placeholder and the hint below the input both mention `~/` for browsing folders

### Requirement: A folder row offers Open in Sidebar
In path mode, the selected or hovered folder row SHALL show an "Open in Sidebar" action with its
shortcut (`⌘↵`). Clicking it SHALL do the same as `Cmd+Enter` on the row. File rows SHALL NOT
show it.

#### Scenario: Action on the selected folder
- **WHEN** a folder row is selected in path mode
- **THEN** the row shows "Open in Sidebar" with `⌘↵`, and clicking it opens the folder in the sidebar and closes quick open

#### Scenario: Not on files
- **WHEN** a file row is selected in path mode
- **THEN** no "Open in Sidebar" action is shown on it

### Requirement: Cmd+Enter adds an outside folder to Recently Opened (Outside)
In quick open's path mode, `Cmd+Enter` or `Cmd`+click on a folder outside every workspace SHALL
add it to the sidebar's "Recently Opened (Outside)" section (or move it to the top if already
listed), show it there expanded, and close quick open. No workspace root SHALL be added. A
plain `Enter` or click SHALL keep stepping into the folder inside the dialog.

#### Scenario: Open ~/.claude
- **WHEN** the user selects the `.claude` folder in path mode and presses `Cmd+Enter`
- **THEN** quick open closes, `.claude` is listed in Recently Opened (Outside) and expanded, and the workspace roots are unchanged

#### Scenario: Plain Enter still steps in
- **WHEN** a folder row is selected in path mode and the user presses `Enter`
- **THEN** quick open stays open and lists that folder's contents

#### Scenario: Cmd+Enter on a file
- **WHEN** a file row is selected in path mode and the user presses `Cmd+Enter`
- **THEN** the file opens in a tab, as with `Enter`

### Requirement: A folder covered by a workspace is revealed in the workspace tree
If the chosen folder is a workspace root or lies inside one, the system SHALL reveal it in the
workspace tree and SHALL NOT add it to Recently Opened (Outside).

#### Scenario: Folder inside a workspace
- **WHEN** the user picks `<workspace>/src` in path mode with `Cmd+Enter`
- **THEN** `src` is revealed in the workspace tree and nothing is added to the outside section

### Requirement: Listed outside folders do not nest
If the chosen folder lies inside a folder already listed in Recently Opened (Outside), the system
SHALL reveal it inside that entry instead of listing it. If listing a folder that contains
already-listed folders, those inner entries SHALL be dropped in favour of the new one.

#### Scenario: Folder inside a listed folder
- **WHEN** `~/.claude` is listed and the user opens `~/.claude/skills` with `Cmd+Enter`
- **THEN** no new entry appears and `skills` is revealed inside the `.claude` entry

#### Scenario: Parent of a listed folder
- **WHEN** `~/.claude/skills` is listed and the user opens `~/.claude` with `Cmd+Enter`
- **THEN** `.claude` is listed and the separate `skills` entry is gone

### Requirement: An outside folder's root cannot be renamed from the tree
The context menu of an outside folder entry's root row SHALL NOT offer Rename, since renaming it
would leave the entry pointing at a path that no longer exists. Items inside it SHALL keep Rename.

#### Scenario: No Rename on the root
- **WHEN** the user right-clicks the root row of an outside folder entry
- **THEN** the menu offers no Rename, while right-clicking a file inside it does

### Requirement: Home and filesystem root are refused
The system SHALL refuse to open the user's home folder itself, or the filesystem root `/`, as an
outside folder, and SHALL tell the user why. Folders below them SHALL be allowed.

#### Scenario: Home folder refused
- **WHEN** the user picks `~` itself with `Cmd+Enter`
- **THEN** nothing is added and a message explains the folder is too large to open

### Requirement: An outside folder entry expands into a live tree
A folder entry in Recently Opened (Outside) SHALL show a folder icon and expand and collapse
like a workspace folder. It SHALL list its contents with the same hiding rules as a workspace,
and SHALL follow changes made on disk without a manual refresh.

#### Scenario: Expand and browse
- **WHEN** the user expands an outside folder entry and then a subfolder in it
- **THEN** their contents are listed, and clicking a file opens it in a tab

#### Scenario: New file shows up
- **WHEN** a file is created in a listed outside folder outside the app
- **THEN** the entry's tree shows it

### Requirement: File operations work inside an outside folder
Files and folders inside a listed outside folder SHALL support the same operations as in a
workspace tree: open, edit and save, and from the context menu create, rename and delete.

#### Scenario: Save
- **WHEN** the user edits and saves a file opened from an outside folder entry
- **THEN** the change is written to disk

#### Scenario: Create from the context menu
- **WHEN** the user creates a new file inside an outside folder through its context menu
- **THEN** the file exists on disk and appears in the entry's tree

### Requirement: Outside folders are not searched as projects
Files inside a listed outside folder SHALL NOT appear in search-in-files, in quick open's
workspace search, or in git status. Quick open's path mode SHALL still reach them.

#### Scenario: Search-in-files skips it
- **WHEN** a listed outside folder contains a file with a unique word and the user searches in files for it
- **THEN** no result comes from that folder

### Requirement: Folder entries persist like other outside entries
A folder entry SHALL survive an app restart and SHALL remain readable and writable then. It SHALL
age out on the same schedule as file entries, counted from its last use. Opening a file inside it
SHALL count as use. A file opened from inside a listed folder SHALL NOT get an entry of its own.

#### Scenario: Survives a restart
- **WHEN** an outside folder is listed and the app restarts
- **THEN** it is still listed, expands, and its files open and save

#### Scenario: No duplicate file entry
- **WHEN** the user opens a file from inside a listed outside folder
- **THEN** the section does not gain a separate entry for that file

### Requirement: Removing a folder entry
The × on a folder entry SHALL remove it from the section and close the open tabs of files under
it. The files on disk SHALL be left untouched.

#### Scenario: Remove
- **WHEN** a file from a listed outside folder is open in a tab and the user clicks × on the folder entry
- **THEN** the entry disappears, that tab closes, and the folder still exists on disk

### Requirement: A folder that becomes a workspace leaves the outside section
When a listed outside folder, or a folder containing it, is added as a workspace, its entry SHALL
leave Recently Opened (Outside).

#### Scenario: Added through Add Folder
- **WHEN** the user adds a listed outside folder through Add Folder
- **THEN** it appears as a workspace root and its outside entry is gone
