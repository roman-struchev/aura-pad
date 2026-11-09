# Design

## Context

- Every tab is text. `useTabs.openTab`, session restore and the external-change handler all
  call `window.api.readFile`, and `main/encoding.ts` rejects a NUL-containing buffer with "This
  looks like a binary file and cannot be opened." That is what an image hits today.
- `App.tsx` decides per active tab between `MarkdownPreview`, `HtmlPreview` and the Monaco
  `Editor`, keyed off `isMarkdownPath` / `isHtmlPath` and the tab's `showPreview` flag.
  Unmounting the editor for a preview is already a supported state (`keepCurrentModel`, hooks
  receive `editor={null}`).
- `main/pastedImages.ts` already has `readImageDataUrl(path)`: path allowlist
  (`pathDenial`), MIME by extension, 10 MB cap, returns a `data:` URL. The renderer CSP
  allows `img-src 'self' data: https:`, but not `file:` or `blob:`.
- `@plantuml/core` (PlantUML compiled to JS by TeaVM, MIT since 1.2026.6) exposes
  `renderToString(lines, ok, err, {dark, maxSvgSize})`. It builds SVG with
  `document.createElementNS` and measures text with canvas/`getBBox`, so it needs a DOM: **it
  cannot run in a Web Worker**. It needs Graphviz (`viz-global.js`, a UMD) handed over as
  `globalThis.PLANTUML_VIZ`, `!theme` definitions from `themes.js` (sets
  `globalThis.PLANTUML_THEMES`), and offers `PLANTUML_FILE_LOADER` / `PLANTUML_STDLIB_LOADER`
  hooks for includes.

## Goals / Non-Goals

**Goals:**
- One zoom/fit surface shared by the raster viewer, the SVG preview and the PlantUML preview.
- No new IPC channel. No change to the tab persistence format.
- Nothing PlantUML-related is loaded until the first diagram preview.

**Non-Goals:**
- Editing images (crop, rotate, convert), and formats Chromium can't decode (TIFF, PSD, HEIC,
  PDF).
- Syntax highlighting for PlantUML source in Monaco; it opens as plain text.
- PlantUML inside Markdown fenced blocks; PlantUML's standard library (C4, AWS, …), emoji and
  OpenIconic sprites; exporting the diagram to PNG/SVG.
- A side-by-side live split view. Preview stays a toggle, like Markdown.

## Decisions

### 1. Image tabs are ordinary tabs that are never read as text

`fileType.ts` gains `isImagePath` (the raster list, case-insensitive), `isSvgPath` and
`isPlantUmlPath`. `useTabs` skips `readFile` for `isImagePath` in `openTab`, session restore
and `reloadFromDisk`, and creates the tab with `content: ''`, `isSaved: true`. Since `isSaved`
never flips (no editor is mounted, so there is no `onChange`), autosave, the dirty dot and
the close prompt already leave it alone.

The tab gets one new optional field, `revision?: number`. The external-change handler bumps
it for image tabs instead of reading the file. The viewer re-fetches when it changes.
- *Alternative:* a separate `kind: 'image'` on `OpenTab`. Rejected: the path already says it,
  and a stored kind could drift from the path after a rename.
- *Alternative:* the viewer subscribes to `onFileChangedExternally` itself. Rejected: a second
  subscription to the same event, when the one in `useTabs` already decides per tab.

### 2. Bytes travel as a `data:` URL from the existing `readImageDataUrl`

The viewer calls `window.api.readImageDataUrl(path)`. Its result gains `size` and a
`reason: 'too-large' | 'unsupported' | 'denied' | 'missing'` so the tab can say why it is
empty. `ico` (`image/x-icon`) and `avif` (`image/avif`) join the MIME map. The 10 MB cap stays:
base64 makes that about 13 MB over IPC, which is fine. Above it the viewer offers Open in
Default App (the existing `openInDefaultApp` bridge).
- *Alternative:* a privileged `aurapad-file://` protocol that streams the file. It would have
  no size cap and no base64, but it needs a CSP change and a new place that serves files by
  path. That is exactly the surface `pathAccess.ts` was written to close. Not worth it for
  previews of at most 10 MB.

### 3. One `ZoomableImage` component

`ZoomableImage({ src, checkerboard, info })` renders an `<img>` in a scrollable pane.
- State is `zoom: 'fit' | number`. Fit is `min(1, paneW / naturalW, paneH / naturalH)`,
  recomputed by a `ResizeObserver`. A small floating bar holds −, a percentage readout, +,
  Fit and 1:1. `wheel` with `ctrlKey || metaKey` zooms around the cursor (pinch arrives as
  `ctrlKey` wheel in Chromium). Steps are ×1.25, clamped to 5%–3200%.
- An SVG without intrinsic size (`naturalWidth === 0`) is treated as pane-sized at Fit.
- The checkerboard is a CSS conic-gradient over two theme tokens (`fleet-bg` and
  `fleet-border`), so it reads in all four themes.
- The info line (`W × H · 120 KB · 75%`) uses `fleet-text`, with no fixed colours.

`ImageViewer` (raster tab) = `readImageDataUrl` → `ZoomableImage`, plus error states.
SVG preview = `ZoomableImage` with `src = 'data:image/svg+xml;charset=utf-8,' +
encodeURIComponent(buffer)`. An SVG loaded through `<img>` never runs scripts or fetches
external resources, which is what the spec asks for, with no sanitizer involved.

### 4. PlantUML runs on the renderer thread, lazy-loaded, latest-wins

Because the engine needs a DOM (see Context), the options were the renderer itself, a hidden
same-origin iframe, or an out-of-process window. A same-origin iframe shares the renderer's
thread, so it buys nothing. A hidden `BrowserWindow` would be truly off-thread, but it is a
second Chromium renderer (more than 100 MB) plus IPC plumbing for a few hundred ms of layout.
The renderer was chosen: `renderToString` is asynchronous and queued, and typical diagrams
lay out in well under a second.

`lib/plantuml.ts` owns the engine:
- `loadEngine()` memoises one `Promise` that does
  `await import('@plantuml/core')`, imports `viz-global.js` and assigns its export to
  `globalThis.PLANTUML_VIZ`, and imports `themes.js` for its side effect. If Vite's interop
  doesn't give a usable `Viz` from the UMD, the fallback is injecting it as a classic
  `<script>` from a `?url` import (CSP `script-src 'self'` allows it).
- It installs `PLANTUML_STDLIB_LOADER = (url, ok, err) => err('…not available offline')`
  and leaves `PLANTUML_STDLIB_BASE` unset, so standard-library includes fail fast with no
  fetch.
- It installs `PLANTUML_FILE_LOADER(path, from, ok, err)`. URLs (`scheme:`) and `<lib>` paths
  are rejected. Other paths are resolved against `from` (the including file's id) or, at top
  level, the previewed document's folder, then read with `window.api.readFile`, so
  `pathDenial` and the binary/size checks apply. The id passed back is the absolute path, so
  nested relative includes resolve correctly. Because the loader is global, the document path
  of the render in flight is held in module state. That is safe because renders are
  serialised by the engine's own queue.
- `renderPlantUml(text, {dark, documentPath}) → Promise<{svg} | {error}>`. It wraps the text
  in `@startuml`/`@enduml` when no line starts with `@start`, and passes `maxSvgSize: 16384`
  (the default of 8192 rejects ordinary large class diagrams).

`PlantUmlPreview({ content, documentPath, dark })` debounces 250 ms, keeps a request counter
and drops any result that isn't the latest, shows a "Rendering…" overlay while one is
pending, and renders the SVG through `ZoomableImage` as a `data:` URL (no checkerboard; the
diagram has its own background). Errors render as a monospace block in `accent-error`.
`dark` is `resolvedTheme === 'dark' || resolvedTheme === 'monokai'` (Solarized is the light
one).
- *Alternative:* fetch SVG from a PlantUML server. The user rejected it: local only.
- *Alternative:* shell out to `java -jar plantuml.jar`. The user rejected it: too heavy and
  needs Java installed.

### 5. Wiring and gating

- `isPreviewablePath` adds `isSvgPath || isPlantUmlPath`. That lights up the toolbar eye,
  `Cmd+Shift+P`, the tree's hover eye and the Find Action entry with no further changes.
- `App.tsx` editor area: `isImagePath(selected)` → `<ImageViewer>` regardless of
  `showPreview`; preview + SVG → SVG preview; preview + PlantUML → `<PlantUmlPreview>`. The
  `Breadcrumbs` `editor` prop becomes null for image tabs too.
- Text-only actions are gated on `!isImagePath`: Work Together share (`FileActions`), Local
  History (Find Action extras in `App.tsx`, `TabContextMenu`). Dictation, read aloud,
  spelling and Format are already prose-, JSON- or markup-only, so images never qualify.
- `electron-builder.yml` file associations gain `puml` (AuraPad as an editor for it). Image
  types are not added: AuraPad should not offer itself as an image app system-wide.

## Risks / Trade-offs

- [A large diagram blocks the UI while it lays out] → The engine is async-queued, renders are
  debounced, and only the newest result is kept. A dedicated out-of-process renderer is a
  follow-up if real files prove slow.
- [About 5 MB added to the renderer bundle] → It sits in a separate chunk behind a dynamic
  `import()`, so startup and memory are unchanged until the first diagram preview. A smoke
  check asserts the engine isn't loaded at startup.
- [Engine globals (`PLANTUML_*`) live on the app window] → They are namespaced and only set
  by `lib/plantuml.ts`. The engine itself "does not touch the host page's DOM" by its docs.
- [The UMD `viz-global.js` doesn't bundle cleanly in electron-vite] → Covered by the
  `<script src=?url>` fallback in Decision 4. Verified in both `npm run dev` and a packaged
  build.
- [A `data:` URL of a 10 MB image is about 13 MB of string in renderer memory] → It is kept
  only for the active tab's viewer and dropped on unmount. Inactive image tabs hold nothing.
- [Engine's `maxSvgSize` refuses huge diagrams] → It shows PlantUML's own error text. The
  limit is 16384 px, twice the default.

## Migration Plan

Additive. Persisted tabs are paths only, so an image tab saved by this version and restored by
an older one fails the old way (it is skipped on restore). No settings, IPC or server changes.
Roll back by reverting the commit.
