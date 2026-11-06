# Proposal

## Why

Today clicking a `.png`/`.jpg` in the tree ends in "This looks like a binary file and cannot be
opened.", so a screenshot sitting next to the code needs another app. PlantUML diagrams
(`.puml`) open only as source, with no way to see the diagram. The README promises offline use
and no telemetry, so both features have to work without a network and without Java.

## What Changes

- Image files (`png`, `jpg`/`jpeg`, `gif`, `webp`, `bmp`, `ico`, `avif`) open in a tab as an
  image viewer instead of failing with the binary-file error. It fits the image to the pane,
  zooms (buttons, `Cmd`+wheel / pinch, 1:1, Fit), shows pixel size and file size, puts a
  checkerboard behind transparent pixels, and reloads when the file changes on disk.
- The viewer is read-only: actions that only make sense for text (Format, dictation, read
  aloud, spelling, Work Together share, Local History) are not offered on an image tab.
- `.svg` stays a text file you can edit, and gains the Preview toggle (`Cmd+Shift+P`), which
  shows the drawing rendered in the same viewer, scripts not run.
- PlantUML files (`.puml`, `.plantuml`, `.pu`, `.iuml`) gain the Preview toggle. It renders the
  diagram fully on-device with the bundled PlantUML engine, follows edits as you type, matches
  a dark or light app theme, resolves local `!include` files from disk, and shows PlantUML's
  own error text when the source is invalid. Network/standard-library includes are not fetched.
- README "Features" and `docs/TEST_CASES.md` are updated, and smoke cases are added.

## Capabilities

### New Capabilities

- `image-viewer`: opening raster image files in a tab, the viewing controls, live reload, the
  file-size limit, and the SVG preview.
- `plantuml-preview`: rendering PlantUML source files to a diagram inside the editor, offline,
  with errors reported in place.

### Modified Capabilities

None. There are no existing specs in `openspec/specs/`.

## Impact

- **Renderer**: `lib/fileType.ts` (new predicates, previewable set), `hooks/useTabs.ts`
  (open, restore and reload image tabs without reading them as text), `App.tsx` (pick the
  viewer or the preview for the active tab), new `components/ImageViewer.tsx` and
  `components/PlantUmlPreview.tsx`, `FileActions.tsx` / `lib/commands.ts` (hide text-only
  actions on images).
- **Main**: `pastedImages.ts` `readImageDataUrl` gains `ico`/`avif` MIME types and reports why
  it refused (too large, unsupported), so the viewer can say so.
- **Dependencies**: `@plantuml/core` (MIT, PlantUML compiled to JS with TeaVM, about 5 MB with
  its Graphviz layout engine), bundled into the renderer and loaded only when the first
  diagram is previewed.
- **Tests and docs**: a new smoke case module for images and PlantUML, README, and
  `docs/TEST_CASES.md`.
- No server, IPC-contract or Work Together protocol changes.
