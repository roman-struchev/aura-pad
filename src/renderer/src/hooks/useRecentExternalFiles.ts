import { useEffect, useState } from 'react'
import type { RecentExternalFile } from '../../../shared/recentExternalFile'

// Tracks files opened from outside any workspace root, persisted in the main
// process so entries survive closing the tab (and app restarts) until
// manually removed or they age out.
export function useRecentExternalFiles() {
  const [entries, setEntries] = useState<RecentExternalFile[]>([])

  useEffect(() => {
    window.api.getRecentExternalFiles().then(setEntries)
  }, [])

  const touch = (filePath: string): void => {
    window.api.touchRecentExternalFile(filePath).then(setEntries)
  }

  const remove = (filePath: string): void => {
    window.api.removeRecentExternalFile(filePath).then(setEntries)
  }

  return { entries, touch, remove }
}
