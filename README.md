# Aura Editor

An Electron application with React and TypeScript

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## Features

- **Multi-root workspaces** — open several project folders side by side in one file tree.
- **Tabs** — keep multiple files open at once, with pinned tabs (asks before closing), reopen-last-closed-tab, and drag & drop reordering. Can be turned off in Settings to go back to one-file-at-a-time.
- **File tree operations** — create, rename, delete (moves to OS Trash), copy/duplicate, and drag & drop files/folders between folders. Hovering a `.py` file shows a run icon, a `.md` file shows a preview icon, right next to the file name.
- **Drag & drop from Finder/Explorer** — drop a file onto the window to open it.
- **`.gitignore`-aware** — the file tree and search respect each workspace's `.gitignore`, on top of built-in rules that hide `node_modules`, `dist`, `.git`, and other common noise.
- **Live file watching** — the tree updates automatically when files change outside the app (git, another editor, another window). The open file reloads automatically if you have no local edits; if you do, a banner lets you choose to reload or keep your changes.
- **Autosave** — edits are saved automatically ~1.2s after you stop typing (can be turned off in Settings).
- **Git integration** — status badges (modified/added/untracked/deleted/staged) in the file tree, a diff viewer, and a Git panel (switch the sidebar between Files/Git) for staging, committing, pushing and pulling. Works against the system `git` CLI; can be turned off in Settings.
- **Diagnostics** — inline TypeScript/JavaScript errors via Monaco's built-in language service, Python syntax errors, and ESLint findings if the opened project has its own local ESLint install. Can be turned off in Settings.
- **Monaco editor** — syntax highlighting, multi-cursor editing, and built-in Find/Replace.
- **Markdown preview** — toggle between source and a rendered preview for `.md` files.
- **Theme follows the OS** — switches between light and dark automatically with your system appearance.
- **Global & quick search** — full-text search across all open workspaces, plus a quick file/folder search (workspace-relative paths, matches folders too).
- **Integrated terminal** — multiple terminal tabs backed by real shells (`node-pty` + `xterm`).
- **Run & format helpers** — run the current Python file, format JSON, open a terminal at any file/folder.
- **Settings** — a single page (gear icon) for all of the above toggles, plus UI density (Mode: micro/compact/normal/large) and which side the sidebar sits on (left/right). Also lists all keyboard shortcuts.

## Keyboard Shortcuts

| Shortcut               | Action                                                                  |
| ---------------------- | ----------------------------------------------------------------------- |
| `Cmd/Ctrl + S`         | Save the current file                                                   |
| `Cmd/Ctrl + W`         | Close the current tab                                                   |
| `Shift + Cmd/Ctrl + T` | Reopen the last closed tab                                              |
| `Cmd/Ctrl + F`         | Find (and Replace) in the current file                                  |
| `Shift + Cmd/Ctrl + F` | Global search across all workspaces                                     |
| Double-tap `Shift`     | Quick file/folder search                                                |
| `Cmd/Ctrl + C`         | Copy the selected file/folder (when the file tree has focus)            |
| `Cmd/Ctrl + V`         | Paste/duplicate into the selected folder (when the file tree has focus) |
| `Delete` / `Backspace` | Move the selected file/folder to Trash (when the file tree has focus)   |
| `Esc`                  | Close a dialog                                                          |

Files and folders can also be dragged and dropped between folders in the tree (or in from Finder/Explorer to open them), tabs can be dragged to reorder, and most tree actions are also available from the right-click context menu. This same list is shown in-app under Settings.
