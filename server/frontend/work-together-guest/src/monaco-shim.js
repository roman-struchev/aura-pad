/**
 * Shim for `monaco-editor/esm/vs/editor/editor.api.js`.
 *
 * y-monaco imports the full ESM build of monaco-editor just to reach a
 * handful of runtime classes (Range, Selection, SelectionDirection). We
 * deliberately do NOT ship monaco-editor through esbuild (per the "classic
 * AMD loader" approach - see guest-template.html, which loads Monaco via
 * `vs/loader.js` and exposes it as `window.monaco`). This shim is aliased
 * (see package.json's `bundle` script, --alias flag) so that when y-monaco's
 * bundled code asks for the ESM monaco-editor module, it gets redirected
 * here instead of pulling in a second ~2MB copy of the editor.
 *
 * At the time app.js actually runs, Monaco's AMD loader has already
 * populated `window.monaco` (see guest-template.html's require() callback,
 * which only injects app.js after 'vs/editor/editor.main' has loaded), so
 * these lookups are safe.
 */

const globalMonaco = /** @type {any} */ (typeof window !== 'undefined' ? window.monaco : undefined)

if (!globalMonaco) {
  // This should never happen given the load order in guest-template.html,
  // but fail loudly rather than silently if it ever does.
  throw new Error('window.monaco is not defined - Monaco AMD loader must run before app.js')
}

export const Range = globalMonaco.Range
export const Selection = globalMonaco.Selection
export const SelectionDirection = globalMonaco.SelectionDirection
export const editor = globalMonaco.editor
export const languages = globalMonaco.languages
export const Uri = globalMonaco.Uri
export const KeyCode = globalMonaco.KeyCode
export const KeyMod = globalMonaco.KeyMod
export const MarkerSeverity = globalMonaco.MarkerSeverity
export const MarkerTag = globalMonaco.MarkerTag

export default globalMonaco
