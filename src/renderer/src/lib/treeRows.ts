// Marks a file-tree row in the DOM.
export const TREE_ROW_ATTR = 'data-tree-row'

// Marks the region the tree's own keyboard shortcuts belong to: the file
// list, plus its context menu (which renders at the app root, outside it).
export const TREE_SURFACE_SELECTOR = '[data-surface="tree"]'

// The paths of the currently *visible* rows, in the order they're painted.
// Shift-range selection needs that order, and it only exists in the DOM:
// each FileTree instance owns its own expanded state, so there is no lifted
// copy of the expanded forest to walk instead.
export function visibleTreePaths(): string[] {
  return [...document.querySelectorAll<HTMLElement>(`[${TREE_ROW_ATTR}]`)].map(
    (el) => el.dataset.path ?? ''
  )
}
