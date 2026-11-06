# Tasks

All paths are relative to `desktop/` unless they start with `docs/`, `openspec/` or `README`.

## 1. File-type predicates and image bytes from main

- [x] 1.1 In `src/renderer/src/lib/fileType.ts` add `isImagePath` (png, jpg, jpeg, gif, webp,
      bmp, ico, avif, case-insensitive), `isSvgPath` and `isPlantUmlPath` (puml, plantuml, pu,
      iuml), and extend `isPreviewablePath` with SVG and PlantUML; verify with `npm run typecheck`
- [x] 1.2 In `src/main/pastedImages.ts` add `ico`/`avif` MIME types and return `size` plus a
      `reason` (`too-large` | `unsupported` | `denied` | `missing`) from `readImageDataUrl`;
      update the result type in `src/shared/ipc.ts`; verify `npm run typecheck` and that the
      existing Markdown-images smoke case still passes (`npm run smoke -- A` for its id)

## 2. Image tabs in useTabs

- [x] 2.1 In `src/renderer/src/hooks/useTabs.ts` skip `readFile` for `isImagePath` in
      `openTab`, session restore and `reloadFromDisk` (content `''`, saved), add
      `revision?: number` to `OpenTab`, and in the external-change handler bump `revision` for
      image tabs instead of reading; verify that an image opens without the binary-file dialog
      (smoke 4.1)

## 3. Shared zoom surface and image viewer

- [x] 3.1 Create `src/renderer/src/components/ZoomableImage.tsx` (fit/zoom state,
      `ResizeObserver`, −/%/+/Fit/1:1 bar, `Cmd`/pinch wheel zoom, optional theme-token
      checkerboard, info line); verify with typecheck and smoke 4.1 zoom checks
- [x] 3.2 Create `src/renderer/src/components/ImageViewer.tsx`: load through
      `readImageDataUrl`, re-load on `revision` change, show dimensions/size, error states for
      each `reason` and for a decode failure (`<img onError>`), with an Open in Default App
      button; verify with smoke 4.1
- [x] 3.3 Wire it in `src/renderer/src/App.tsx`: `isImagePath` → `<ImageViewer>` regardless of
      `showPreview`; preview + `isSvgPath` → `ZoomableImage` with an encoded `data:` URL of
      `tabs.fileContent` and checkerboard; pass `editor={null}` to `Breadcrumbs` on image tabs;
      verify with smoke 4.1/4.2
- [x] 3.4 Hide text-only actions on image tabs: Work Together share in `FileActions.tsx`,
      Local History in the Find Action extras (`App.tsx`) and `TabContextMenu.tsx`; verify
      with smoke 4.1's "no share / no Local History" checks

## 4. Smoke coverage for images and SVG

- [x] 4.1 Add `scripts/smoke/cases/images.mjs` (new id after the existing ones), registered in
      `scripts/smoke/run.mjs` after `markdown-images.mjs`. Fixtures are written by the case
      itself: a small transparent PNG (base64), a PNG with garbage bytes, and an upper-case
      `.JPG`. Checks: it opens with no dialog; `getOpenTabs` lists it; the `<img>` reaches
      `naturalWidth > 0`; the info line shows its dimensions; 1:1/Fit change the percentage;
      the tab never becomes unsaved; Share and Local History are absent; overwriting the file
      on disk with a different-size PNG updates the dimensions; the corrupt file shows the
      decode error. Verify `npm run smoke -- <id>` passes
- [x] 4.2 In the same module, SVG checks: the `.svg` opens in the editor, Preview shows an
      `<img>` with a `data:image/svg+xml` source, and an SVG containing
      `<script>window.__svgRan=1</script>` leaves `window.__svgRan` undefined; verify the case
      passes

## 5. PlantUML engine and preview

- [x] 5.1 Add `@plantuml/core` pinned to an exact version (`1.2026.9`) to `devDependencies`
      (renderer-bundled like `marked`); verify `npm install` succeeds and the package's
      license is MIT for that version
- [x] 5.2 Create `src/renderer/src/lib/plantuml.ts`: memoised `loadEngine()` (dynamic import,
      `PLANTUML_VIZ` from `viz-global.js` with the `<script src=?url>` fallback, `themes.js`),
      offline `PLANTUML_STDLIB_LOADER`, `PLANTUML_FILE_LOADER` reading through
      `window.api.readFile` with path resolution against `from` / the document folder,
      `@startuml` auto-wrap, `renderPlantUml()` returning `{svg}|{error}`; verify a sequence
      diagram renders in `npm run dev` and the engine chunk is separate in `npm run build`
      output
- [x] 5.3 Create `src/renderer/src/components/PlantUmlPreview.tsx` (250 ms debounce,
      latest-wins counter, "Rendering…" overlay, error block in `accent-error`, SVG through
      `ZoomableImage`, `dark` from the resolved theme) and wire it in `App.tsx` for preview +
      `isPlantUmlPath`; verify with smoke 6.1
- [x] 5.4 Add `puml` to the file associations in `electron-builder.yml`; verify the YAML still
      parses with `npx electron-builder --help` not erroring on config (or `build:unpack` in 7.2)

## 6. Smoke coverage for PlantUML

- [x] 6.1 Add PlantUML checks (own case id in a `plantuml.mjs` module, registered after
      `images.mjs`): the engine is not loaded before the first preview (no `PLANTUML_VIZ` on
      `globalThis`); `.puml` offers Show Preview; a sequence diagram renders an SVG `<img>`
      whose decoded source contains `Alice`; an edit adding `Carol`, then a re-toggle, shows
      `Carol`; a file without `@startuml` still renders; an invalid line shows the error block;
      `!include common.iuml` from the same folder applies (participant from the include
      appears); `!include <C4/C4_Context>` shows an error; verify `npm run smoke -- <id>` passes

## 7. Docs and full verification

- [x] 7.1 README "Features → Editing": image viewer (formats, zoom, live reload, 10 MB),
      SVG preview, PlantUML preview (offline, bundled engine, local includes, no stdlib);
      update the "Files up to 10 MB … binaries" wording so it doesn't contradict image
      viewing; verify by reading the section against the specs
- [x] 7.2 `docs/TEST_CASES.md`: map the new ids in Part A, and add a Part B section
      "Image viewer and PlantUML preview" (trackpad pinch zoom, `Cmd+Shift+P` accelerator on a
      `.puml`, opening a `.png` from Finder "Open With", a large real-world diagram's render
      time, no outgoing request in DevTools Network for a stdlib include) with `Guards:`
      listing the new files; verify the section names existing files
- [x] 7.3 Run `npm run typecheck`, `npm run lint` (compare against `main`, no new errors in
      touched files) and the full `npm run smoke`; all smoke cases pass
- [x] 7.4 Build a separate packaged app for manual testing (`npm run build:unpack`, output
      under `desktop/dist/`) and launch it with a disposable `AURAPAD_USER_DATA_DIR`; verify
      that PlantUML renders in the packaged build (asar paths, UMD Viz) and that a PNG opens

## Workflow follow-up

- Archive the change (`/opsx:archive`) after the user has tried the build and the commit is
  made.
