import type React from 'react'
import { useState } from 'react'

// The model dialogs read their "downloaded" marks straight off localStorage
// during render, so deleting a downloaded model/voice needs a re-render to be
// visible. Wraps a delete handler with the state bump that forces one - plus
// the event plumbing all three dialogs had copy-pasted, since the trash button
// sits inside the option row's <label> and would otherwise toggle its radio.
export function useDeleteAndRefresh<T>(
  onDelete: (target: T) => Promise<void>
): (e: React.MouseEvent, target: T) => Promise<void> {
  const [, setDeletedCount] = useState(0)
  return async (e, target) => {
    e.preventDefault()
    e.stopPropagation()
    await onDelete(target)
    setDeletedCount((n) => n + 1)
  }
}
