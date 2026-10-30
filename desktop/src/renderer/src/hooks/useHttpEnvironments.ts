import { useEffect, useState } from 'react'
import type { HttpEnvironments } from '../../../shared/http'
import { isHttpPath } from '../lib/fileType'

// The environments the given .http file can run against
// (http-client.env.json next to it, or at the project root); null for any
// other file. Read per file rather than kept in sync with a watcher: it is
// one small JSON read on tab switch, and the selector is only looked at when
// a request is about to run.
export function useHttpEnvironments(selectedPath: string | null): HttpEnvironments | null {
  const [loaded, setLoaded] = useState<{ path: string; envs: HttpEnvironments } | null>(null)

  useEffect(() => {
    if (!selectedPath || !isHttpPath(selectedPath)) return
    let alive = true
    void window.api.httpEnvironments(selectedPath).then((envs) => {
      if (alive) setLoaded({ path: selectedPath, envs })
    })
    return () => {
      alive = false
    }
  }, [selectedPath])

  // Only the answer that belongs to the file on screen; anything else is a
  // stale read for a tab that has already been switched away from.
  return loaded && loaded.path === selectedPath ? loaded.envs : null
}
