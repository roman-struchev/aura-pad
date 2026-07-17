# AuraPad

A fast, lightweight text and code editor for macOS, Windows, and Linux. Open a folder, edit
files, commit your changes — AuraPad stays out of your way. No plugins to configure, no
accounts, no telemetry: even voice dictation and read-aloud run entirely on your machine.

![AuraPad](docs/assets/screenshot.png)

## Download & Install

**macOS / Linux** — one command installs (or updates) the latest release and starts it:

```bash
curl -fsSL https://raw.githubusercontent.com/roman-struchev/aura-pad/main/scripts/install.sh | bash
```

**Windows** — download the `-setup.exe` from the
[latest release](https://github.com/roman-struchev/aura-pad/releases/latest).

> **macOS:** a `.dmg` downloaded in a browser shows "AuraPad is damaged" (builds aren't
> notarized yet). Use the command above instead, or run `xattr -cr /Applications/AuraPad.app`.

## Highlights

- **Real editor engine** — Monaco (the editor behind VS Code): syntax highlighting for ~30
  languages, multi-cursor editing, find & replace.
- **Voice dictation** — press `Cmd+D`, speak, and the text lands at the cursor. Powered by
  Whisper running on-device; audio never leaves your machine.
- **Read aloud** — have any document read to you with natural neural voices, with automatic
  language switching and 1×/1.5×/2× speed.
- **Translate in place** — select text and hit `Option+Cmd+T`: Google Translate for best
  quality, or fully offline local models.
- **Git built in** — status badges, diffs, stage/commit/push/pull without leaving the editor.
- **Instant startup, small footprint** — opens folders and large files without ceremony.

## Features

**Editing**

- Syntax highlighting for ~30 languages, multi-cursor editing, find & replace.
- Tabs with pinning and drag-to-reorder; reopen the last closed tab with `Cmd+Shift+T`.
- Autosave a moment after you stop typing (can be turned off).
- Error checking for TypeScript, JavaScript, and Python; uses your project's own ESLint
  setup if it has one.
- One-click Markdown and HTML preview.
- Themes: dark, light, system, Monokai, and Solarized; adjustable UI density and editor look.

**Voice & language**

- **Dictation** (`Cmd+D`): speak, and the text appears at the cursor. Works fully offline —
  speech recognition (Whisper) runs on your machine.
- **Read aloud**: natural-sounding voices read your document, switching between English and
  Russian automatically. Also fully offline (Piper). Speed toggle 1×/1.5×/2×, `Esc` stops.
- **Translate** (`Option+Cmd+T` or right-click a selection): Google Translate for best
  quality, or local offline models if the text should never leave your machine.
- Voice and translation models are downloaded once (after you confirm) and cached for
  offline use.

**Files**

- Open several folders side by side in one tree.
- Create, rename, copy, and delete files; drag & drop between folders or in from
  Finder/Explorer.
- Quick open with a double-tap of `Shift`; full-text search across all folders
  (`Shift+Cmd+F`).
- Stays in sync with changes made outside the app — and warns instead of losing your
  unsaved edits.
- Respects `.gitignore`.

**Git**

- See changed files at a glance, view diffs, stage, commit, push, and pull — right in the
  editor (`Cmd+K`).
- Works with several repos open at once; can be turned off entirely in Settings.

**Terminal**

- A real terminal inside the app: multiple tabs, resizable panel, opens at any folder from
  the file tree.

The full list of keyboard shortcuts is available in the app under Settings.

## Development

Install deps and run in dev mode.

```bash
npm install
npm run dev
```

Build for your platform:

```bash
npm run build:mac
```

Release a new version (bumps the minor version, tags, and pushes — CI builds and publishes):

```bash
npm run release
```
