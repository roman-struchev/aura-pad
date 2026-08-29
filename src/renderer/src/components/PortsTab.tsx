import React, { useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, Skull, Zap } from 'lucide-react'
import clsx from 'clsx'
import { ToolbarButton } from './ToolbarButton'
import type { ListeningPort } from '../../../shared/ports'

// The port a development machine is always fighting over, so the filter's
// placeholder is an example of what to type rather than an instruction.
const FILTER_PLACEHOLDER = '3000, or node'

// How often the list re-reads itself while the tab is up. Ports appear and
// disappear on their own - a dev server restarts, a container stops - and a
// list that is only right at the moment it was opened is a list nobody can
// trust. Slow enough that the lsof it costs is nothing.
const REFRESH_MS = 5000

// "Address already in use" - what has it, and stop it. The list is every TCP
// port this machine is listening on; the filter takes a port number or part
// of a process name, so the usual question ("who has 8080?") is one field
// away.
export const PortsTab: React.FC = () => {
  const [rows, setRows] = useState<ListeningPort[] | null>(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // Reading the list is one effect keyed on a counter, rather than an async
  // function called from three places: the tab unmounts while a read is in
  // flight (switching tabs is how you leave it), and this way the answer to a
  // read nobody is waiting for any more is dropped instead of setting state
  // on a gone component.
  const [reloads, setReloads] = useState(0)
  const reload = (): void => setReloads((n) => n + 1)

  useEffect(() => {
    let alive = true
    void window.api.listListeningPorts().then((list) => {
      if (alive) setRows(list)
    })
    return () => {
      alive = false
    }
  }, [reloads])

  // Read by the timer below, which is set up once and would otherwise close
  // over the first render's values.
  const hoveringRef = useRef(false)
  const busyRef = useRef<number | null>(null)
  useEffect(() => {
    busyRef.current = busy
  })

  // The tab is mounted only while it is the one on screen (App renders one
  // extension body at a time), so this polls exactly while someone is
  // looking at it and stops the moment they switch away.
  useEffect(() => {
    const tick = (): void => {
      // Not while the pointer is over the table: rows are ordered by port, so
      // a server coming up moves everything below it - under a click that
      // was aimed at stopping something else. Not while a stop is in flight
      // either, and not while the window is hidden, where the only thing a
      // refresh costs is the process it spawns.
      if (hoveringRef.current || busyRef.current !== null || document.hidden) return
      setReloads((n) => n + 1)
    }
    const timer = window.setInterval(tick, REFRESH_MS)
    // Coming back to the app is the moment the list is most likely to be
    // stale: what happens in between happens in a terminal.
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  const query = filter.trim().toLowerCase()
  const shown = (rows ?? []).filter((row) =>
    query === ''
      ? true
      : String(row.port).startsWith(query) ||
        row.command.toLowerCase().includes(query) ||
        String(row.pid) === query
  )

  // Straight to the signal, no confirmation: the whole point of the tab is
  // "the port I need is taken, free it", and a dialog in front of that turns
  // one click into three. The two buttons are the safety - a stray click
  // sends SIGTERM, which a server survives if it wants to; SIGKILL is a
  // different button.
  const kill = async (row: ListeningPort, force: boolean): Promise<void> => {
    setBusy(row.pid)
    setError(null)
    setNote(null)
    const result = await window.api.killListeningProcess(row.pid, force)
    setBusy(null)
    if (!result.success) {
      setError(result.error ?? 'It could not be stopped.')
      return
    }
    // A moment for the process to actually go: SIGTERM is a request, and a
    // list read back instantly still has the row in it, which reads as "the
    // button did nothing".
    await new Promise((resolve) => setTimeout(resolve, 350))
    reload()
    setNote(
      `Sent ${force ? 'SIGKILL' : 'SIGTERM'} to ${row.command} (pid ${row.pid}) on port ${row.port}`
    )
  }

  return (
    <div className="h-full flex flex-col min-h-0" data-testid="ports-tab">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-fleet-border">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={FILTER_PLACEHOLDER}
          aria-label="Port or process"
          spellCheck={false}
          className="w-64 bg-fleet-sidebar border border-fleet-border rounded px-2 py-1.5 text-xs font-mono text-fleet-text outline-none focus:border-blue-500"
        />
        <span className="text-[11px] text-gray-500">
          {rows === null
            ? 'Reading…'
            : `${shown.length} of ${rows.length} listening port${rows.length === 1 ? '' : 's'}`}
        </span>
        <div className="flex-1" />
        <ToolbarButton
          dense
          title="Refresh"
          tooltipAlign="right"
          colorClassName="text-gray-500 hover:text-fleet-textHover"
          onClick={reload}
        >
          <RefreshCw size={14} />
        </ToolbarButton>
      </div>

      {(error || note) && (
        <div
          className={clsx(
            'shrink-0 px-3 py-1.5 text-[11px]',
            error ? 'text-red-300' : 'text-gray-400'
          )}
        >
          {error ?? note}
        </div>
      )}

      <div
        className="flex-1 overflow-auto"
        onMouseEnter={() => {
          hoveringRef.current = true
        }}
        onMouseLeave={() => {
          hoveringRef.current = false
        }}
      >
        {rows !== null && rows.length === 0 && (
          <div className="px-3 py-3 text-xs text-gray-500">
            Nothing is listening (or lsof is not available on this system).
          </div>
        )}
        {rows !== null && rows.length > 0 && shown.length === 0 && (
          <div className="px-3 py-3 text-xs text-gray-500">
            Nothing is listening on {filter.trim()}.
          </div>
        )}
        {shown.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead className="text-[11px] text-gray-500">
              <tr className="border-b border-fleet-border">
                <th className="text-left font-normal px-3 py-1.5 w-20">Port</th>
                <th className="text-left font-normal px-3 py-1.5">Process</th>
                <th className="text-left font-normal px-3 py-1.5 w-24">PID</th>
                <th className="text-left font-normal px-3 py-1.5 w-32">Address</th>
                <th className="text-left font-normal px-3 py-1.5 w-40">User</th>
                <th className="px-3 py-1.5 w-24" />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr
                  key={`${row.pid}:${row.port}`}
                  data-port-row={row.port}
                  // No rule under every row: at six columns a line per row
                  // turns the table into a grid of lines with text in it
                  // (the history list next door makes the same call). The
                  // hover band is what marks the row being aimed at.
                  className="hover:bg-fleet-active"
                >
                  <td className="px-3 py-1 font-mono text-fleet-textHover">{row.port}</td>
                  <td className="px-3 py-1 truncate">{row.command}</td>
                  <td className="px-3 py-1 font-mono text-gray-400">{row.pid}</td>
                  <td className="px-3 py-1 font-mono text-gray-400">{row.address}</td>
                  <td className="px-3 py-1 text-gray-400 truncate">{row.user}</td>
                  <td className="px-3 py-1">
                    <div className="flex items-center justify-end gap-1">
                      {busy === row.pid ? (
                        <Loader2 size={13} className="animate-spin text-gray-400" />
                      ) : (
                        <>
                          <ToolbarButton
                            dense
                            title={`Stop ${row.command} (SIGTERM)`}
                            ariaLabel={`Stop port ${row.port}`}
                            tooltipAlign="right"
                            colorClassName="text-gray-500 hover:text-red-300"
                            onClick={() => void kill(row, false)}
                          >
                            <Zap size={13} />
                          </ToolbarButton>
                          {/* The second press, for a server that ignores the
                              first: same row, no chance of hitting it by
                              reflex because it is a different button. */}
                          <ToolbarButton
                            dense
                            title={`Force stop ${row.command} (SIGKILL)`}
                            ariaLabel={`Force stop port ${row.port}`}
                            tooltipAlign="right"
                            colorClassName="text-gray-500 hover:text-red-300"
                            onClick={() => void kill(row, true)}
                          >
                            <Skull size={13} />
                          </ToolbarButton>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
