import { useEffect, useRef, useState } from 'react'
import { alertDialog, confirmDialog } from '../lib/dialogs'

// Shared Google-account connect/disconnect state, used by both the Google
// Tasks tab and its Settings modal (which previously each hand-rolled the same
// `connecting` flag, the add-account IPC + alert + refresh, and the disconnect
// confirm). Components layer their own specifics on top: the tab picks an
// active account, the modal shows a "just connected" highlight.
export function useGoogleAccounts(): {
  accounts: string[]
  // False until the first account list has loaded - lets a consumer avoid
  // flashing an empty state before the initial fetch resolves.
  initialized: boolean
  connecting: boolean
  // The email connected in this session (cleared after a few seconds), for a
  // transient "Connected" confirmation.
  justConnected: string | null
  refresh: () => Promise<string[]>
  // Runs the browser sign-in; returns the connected email (or null on
  // failure/cancel). Shows the app's own alert on failure.
  connect: () => Promise<string | null>
  // Confirms, then disconnects; returns true if it actually removed one.
  disconnect: (email: string) => Promise<boolean>
} {
  const [accounts, setAccounts] = useState<string[]>([])
  const [initialized, setInitialized] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [justConnected, setJustConnected] = useState<string | null>(null)
  const justConnectedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = async (): Promise<string[]> => {
    const list = await window.api.gtasksAccounts()
    setAccounts(list)
    setInitialized(true)
    return list
  }

  useEffect(() => {
    // Inlined (rather than calling refresh()) so the state updates sit in the
    // fetch's .then, not synchronously in the effect body.
    window.api.gtasksAccounts().then((list) => {
      setAccounts(list)
      setInitialized(true)
    })
    return () => {
      if (justConnectedTimer.current) clearTimeout(justConnectedTimer.current)
    }
  }, [])

  const connect = async (): Promise<string | null> => {
    setConnecting(true)
    try {
      const result = await window.api.gtasksAddAccount()
      if (!result.success) {
        await alertDialog(result.error || 'Sign-in failed.')
        return null
      }
      await refresh()
      if (result.email) {
        setJustConnected(result.email)
        if (justConnectedTimer.current) clearTimeout(justConnectedTimer.current)
        justConnectedTimer.current = setTimeout(() => setJustConnected(null), 4000)
      }
      return result.email ?? null
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async (email: string): Promise<boolean> => {
    if (!(await confirmDialog(`Disconnect ${email}?`))) return false
    await window.api.gtasksRemoveAccount(email)
    await refresh()
    return true
  }

  return { accounts, initialized, connecting, justConnected, refresh, connect, disconnect }
}
