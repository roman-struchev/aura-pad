# Known Issues

## Native tooltip on Monaco's Find/Replace widget close button

**Status:** Unfixed, deprioritized for now.

When the Find widget is open in the editor (`Cmd+F`), hovering over its close
button shows a native OS-style tooltip reading `(Escape)`. This clashes
visually with the rest of the app.

**What was tried:**

- Removed the `title` attribute from the toolbar's own Global Search icon
  (unrelated button, but was suspected first) - `src/renderer/src/App.tsx`.
- Added a `MutationObserver` in `handleEditorDidMount` scoped to
  `editor.getDomNode()` that strips `title` attributes from Monaco's own
  elements (converting them to `aria-label`). Didn't help - the Find widget's
  close button tooltip still appeared, suggesting it renders outside that
  DOM node (a shared/global Monaco overlay layer).
- Broadened the `MutationObserver` to watch the whole `document.body`,
  scoped via selector `.monaco-editor[title], .monaco-editor [title]` so it
  wouldn't touch the app's own toolbar tooltips. Still didn't help.

**Current hypothesis:** the `(Escape)` label may not come from a `title`
attribute at all - Monaco might be using its newer custom hover/tooltip
delegate for this specific button, which renders as its own positioned
widget rather than a native `title` tooltip, so DOM attribute stripping
doesn't affect it. Would need to inspect the live DOM (dev tools) while the
tooltip is showing to confirm what element/mechanism actually renders it
before attempting another fix.
