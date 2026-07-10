# AuraPad

A lightweight editor built with Electron, React, and Monaco. The goal is to stay simple: open a folder, edit files, commit
your changes, and otherwise get out of the way.

## Setup

```bash
npm install
npm run dev
```

Build for your platform:

```bash
npm run build:mac    # or build:win / build:linux
```

Install the freshly built app into `/Applications`, replacing any existing copy:

```bash
rm -rf /Applications/AuraPad.app && cp -R dist/mac-arm64/AuraPad.app /Applications/
```

## What it does

**Editing**

- Monaco under the hood, so you get real syntax highlighting, multi-cursor editing, and
  `Cmd+F` find/replace for free.
- Tabs, with pinning (asks for confirmation before closing a pinned tab), reopening the last
  closed tab (`Cmd+Shift+T`), and drag-to-reorder. Turn tabs off in Settings to go back to one
  file at a time.
- Autosave ~1.2s after you stop typing (also toggleable).
- Inline diagnostics: TypeScript/JavaScript via Monaco's own worker, Python syntax errors, and
  ESLint findings if the opened project has its own local ESLint install (never AuraPad's own
  config). Only re-checked on open and after a real save, not on every tab switch, since a
  type-aware ESLint run can take a second or two per file.
- Markdown preview toggle, plus folding for headings, fenced code blocks, and frontmatter.
- Line numbers, editor scrollbar width, UI density (micro/compact/normal/large), and a
  dark/light/system theme are all adjustable in Settings.

**Files**

- Multiple workspace folders open side by side in one tree.
- Create/rename/delete (to Trash)/copy/duplicate, drag & drop between folders, and drag files
  in from Finder/Explorer to open them.
- Respects `.gitignore`, on top of its own built-in ignore list (`node_modules`, `dist`, etc).
- Watches the filesystem so the tree and open files stay in sync with changes made outside the
  app (another editor, git, another window) — with a banner instead of silently clobbering
  unsaved edits if there's a conflict.
- Quick open (double-tap `Shift`) searches files and folders and shows workspace-relative
  paths instead of full system paths.
- Global full-text search across every open workspace (`Shift+Cmd+F`).
- The sidebar can sit on either side, and its width is draggable and remembered between
  launches.

**Git**

- Status badges in the tree, a diff viewer, and a Git panel (switch the sidebar to it, or hit
  `Cmd+K`) for staging, unstaging, discarding, committing, pushing, and pulling.
- Added/removed line counts next to each changed file.
- Multiple open git repos get a small switcher instead of being stacked on top of each other.
- All of it can be turned off in Settings if you're working somewhere that isn't a repo.

**Terminal**

- Real shells via `node-pty` + `xterm`, multiple terminal tabs, resizable panel.
- Run the current Python file, format JSON, or open a terminal at any file/folder from the
  tree's context menu or the hover icons on `.py`/`.md` files.

## Shortcuts

| Shortcut               | Action                                                                  |
| ---------------------- | ----------------------------------------------------------------------- |
| `Cmd/Ctrl + S`         | Save the current file                                                   |
| `Cmd/Ctrl + W`         | Close the current tab                                                   |
| `Shift + Cmd/Ctrl + T` | Reopen the last closed tab                                              |
| `Cmd/Ctrl + K`         | Toggle the Git sidebar tab                                              |
| `Cmd/Ctrl + F`         | Find (and Replace) in the current file                                  |
| `Shift + Cmd/Ctrl + F` | Global search across all workspaces                                     |
| Double-tap `Shift`     | Quick open a file or folder                                             |
| `Cmd/Ctrl + C`         | Copy the selected file/folder (when the file tree has focus)            |
| `Cmd/Ctrl + V`         | Paste/duplicate into the selected folder (when the file tree has focus) |
| `Delete` / `Backspace` | Move the selected file/folder to Trash (when the file tree has focus)   |
| `Esc`                  | Close a dialog                                                          |

Files and folders can also be dragged and dropped between folders in the tree (or in from
Finder/Explorer to open them), tabs can be dragged to reorder, and most tree actions are also
available from the right-click context menu. This same shortcut list is shown in-app under
Settings.
