import { useEffect, type RefObject } from 'react'
import { confirmDialog } from '../lib/dialogs'

interface TabsForLifecycle {
  openTab: (filePath: string) => unknown
  getUnsavedCount: () => number
}

// The window's conversation with main about files arriving from the OS and
// the window going away. Reads tabs through a ref: these subscribe once.
export function useWindowLifecycle(tabsRef: RefObject<TabsForLifecycle>): void {
  // Opening a file via the OS ("Open With AuraPad", double-click once
  // registered as a handler, or a second launch attempt while already
  // running) arrives here as a plain path - just open it like any other file.
  useEffect(() => {
    const unsubscribe = window.api.onOpenFileRequest((filePath) => {
      tabsRef.current.openTab(filePath)
    })
    return unsubscribe
  }, [tabsRef])

  // Tells main it's now safe to deliver a file-open request directly instead
  // of queuing it - must run only once, after the subscription above is in
  // place (effects run in order), so a file open that raced the app's startup
  // (macOS "Open With", or a plain CLI arg on first launch) never fires before
  // anything is listening for it.
  useEffect(() => {
    window.api.notifyRendererReady()
  }, [])

  // The window is about to close (titlebar close button, Cmd+Q, or the app
  // quitting) - main paused the close and is waiting for this to either let
  // it through immediately (nothing unsaved) or confirm after asking the
  // user, so unsaved edits are never silently discarded.
  useEffect(() => {
    const unsubscribe = window.api.onRequestClose(async () => {
      const unsavedCount = tabsRef.current.getUnsavedCount()
      if (
        unsavedCount === 0 ||
        (await confirmDialog(
          unsavedCount === 1
            ? 'You have unsaved changes in 1 tab. Quit without saving?'
            : `You have unsaved changes in ${unsavedCount} tabs. Quit without saving?`
        ))
      ) {
        window.api.confirmClose()
      } else {
        // Declined: main must forget a pending Cmd+Q, or the next plain
        // window close would quit the whole app with it.
        window.api.declineClose()
      }
    })
    return unsubscribe
  }, [tabsRef])
}
