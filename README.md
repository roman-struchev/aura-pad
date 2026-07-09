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
- **File tree operations** — create, rename, delete (moves to OS Trash), copy/duplicate, and drag & drop files/folders between folders.
- **`.gitignore`-aware** — the file tree and search respect each workspace's `.gitignore`, on top of built-in rules that hide `node_modules`, `dist`, `.git`, and other common noise.
- **Live file watching** — the tree updates automatically when files change outside the app (git, another editor, another window). The open file reloads automatically if you have no local edits; if you do, a banner lets you choose to reload or keep your changes.
- **Autosave** — edits are saved automatically ~1.2s after you stop typing.
- **Monaco editor** — syntax highlighting, multi-cursor editing, and built-in Find/Replace.
- **Markdown preview** — toggle between source and a rendered preview for `.md` files.
- **Breadcrumbs** — the path to the open file is shown above the editor; click a folder segment to reveal it in the tree.
- **Theme follows the OS** — switches between light and dark automatically with your system appearance.
- **Global & quick search** — full-text search across all open workspaces, plus fuzzy file-name search.
- **Integrated terminal** — multiple terminal tabs backed by real shells (`node-pty` + `xterm`).
- **Run & format helpers** — run the current Python file, format JSON, open a terminal at any file/folder.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl + S` | Save the current file |
| `Cmd/Ctrl + W` | Close the current file |
| `Cmd/Ctrl + F` | Find (and Replace) in the current file |
| `Shift + Cmd/Ctrl + F` | Global search across all workspaces |
| Double-tap `Shift` | Quick file search |
| `Cmd/Ctrl + C` | Copy the selected file/folder (when the file tree has focus) |
| `Cmd/Ctrl + V` | Paste/duplicate into the selected folder (when the file tree has focus) |
| `Delete` / `Backspace` | Move the selected file/folder to Trash (when the file tree has focus) |

Files and folders can also be dragged and dropped between folders in the tree, and all of the above actions are available from the right-click context menu.
