import { useEffect } from 'react'

// Document-wide fixes for Monaco's own widgets, which render partly outside
// any one editor's DOM node and so can't be fixed per editor instance.
export function useMonacoWidgetFixes(): void {
  // Monaco's built-in widgets (e.g. the Find/Replace bar's icon buttons) use
  // native title="" attributes, which pop up an OS-style tooltip that clashes
  // with the app's look. Some of those widgets render in an overlay layer
  // outside the specific editor instance's own DOM node, so watch the whole
  // document - but scope the selector to Monaco's own elements only, so this
  // never touches our own toolbar buttons' tooltips. Keep an aria-label so
  // screen readers still get the same text.
  useEffect(() => {
    const strip = (el: Element): void => {
      const title = el.getAttribute('title')
      if (!title) return
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', title)
      el.removeAttribute('title')
    }
    // Only elements inside a Monaco editor - and only the mutated subtrees,
    // not a document-wide querySelectorAll per mutation batch: Monaco emits
    // mutations continuously while typing/scrolling, and the full-document
    // scan burned CPU on every one of them.
    const stripWithin = (el: Element): void => {
      if (!el.closest('.monaco-editor')) return
      strip(el)
      el.querySelectorAll('[title]').forEach(strip)
    }
    document.querySelectorAll('.monaco-editor[title], .monaco-editor [title]').forEach(strip)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          if (mutation.target instanceof Element) stripWithin(mutation.target)
        } else {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element) stripWithin(node)
          })
        }
      }
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title']
    })
    return () => observer.disconnect()
  }, [])

  // The Find/Replace widget's own buttons (close, next/previous match,
  // replace, case-sensitive/whole-word/regex toggles) don't use a native
  // title="" at all - they use Monaco's custom IHoverService overlay, whose
  // "(Escape)"-style label is what actually clashes visually (the
  // title-stripping observer above never touched it, since there's no title
  // to strip). That overlay is a real, absolutely-positioned DOM node
  // appended outside the widget, and it can end up rendering on top of the
  // close button itself, swallowing clicks meant for it. Monaco shows the
  // hover from a plain (non-capturing) mouseover listener on each button, so
  // a capture-phase listener higher up the tree that stops the event before
  // it reaches the button prevents the hover from ever appearing.
  useEffect(() => {
    const suppressFindWidgetHover = (e: MouseEvent): void => {
      if ((e.target as HTMLElement).closest?.('.find-widget')) {
        e.stopPropagation()
      }
    }
    document.addEventListener('mouseover', suppressFindWidgetHover, true)
    return () => document.removeEventListener('mouseover', suppressFindWidgetHover, true)
  }, [])
}
