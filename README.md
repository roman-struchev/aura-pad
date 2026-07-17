# AuraPad

A fast, lightweight text and code editor for macOS, Windows, and Linux. Open a folder, edit
files, commit your changes — AuraPad stays out of your way. No plugins to configure, no
accounts, no telemetry: even voice dictation and read-aloud run entirely on your machine.

![AuraPad](docs/assets/screenshot.png)

## Download & Install

**macOS / Linux** — paste this into a terminal; it downloads the latest release, installs it
(into `/Applications` on macOS, as an AppImage with a launcher entry on Linux), and starts it.
Running it again later updates an existing copy:

```bash
curl -fsSL https://raw.githubusercontent.com/roman-struchev/aura-pad/main/scripts/install.sh | bash
```

**Windows** — grab the `-setup.exe` installer from the
[latest release](https://github.com/roman-struchev/aura-pad/releases/latest)
(`.deb` for Debian/Ubuntu is also available there if you prefer it over the AppImage).

> **Note for macOS:** builds are not yet notarized with Apple, so a `.dmg` downloaded in a
> browser is blocked by Gatekeeper with an "AuraPad is damaged" message. Either use the install
> command above (not affected), or clear the quarantine flag after copying the app:
> `xattr -cr /Applications/AuraPad.app`.

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
- Dark, light, or system theme; adjustable UI density and editor look.

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

Built with Electron, React, and Monaco.

```bash
npm install
npm run dev
```

Build for your platform:

```bash
npm run build:mac
```

Install the freshly built app into `/Applications`, replacing any existing copy:

```bash
rm -rf /Applications/AuraPad.app && cp -R dist/mac-arm64/AuraPad.app /Applications/
```
