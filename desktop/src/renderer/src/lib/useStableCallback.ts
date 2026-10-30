import { useCallback, useEffect, useRef } from 'react'

// Returns a function with a stable identity that always invokes the latest
// `fn`. The app's hooks (useTabs, useWorkspaceTree, ...) recreate their
// functions on every render, which would defeat React.memo on any child
// receiving them as props - wrap those props in this at the App boundary.
// Same ref-mirror pattern the rest of App.tsx uses (written from an effect,
// not during render), so a call in the narrow window before the effect runs
// sees the previous render's fn - fine for user-event handlers.
export function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R
): (...args: A) => R {
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  })
  return useCallback((...args: A) => ref.current(...args), [])
}
