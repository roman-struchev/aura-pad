import { execFile } from 'child_process'
import type { ListeningPort } from '../shared/ports'
import type { OpResult } from '../shared/ipc'

// "What is on 8080, and make it stop" - the two things a developer wants from
// a port, without leaving the editor for a terminal and a remembered lsof
// incantation.
//
// lsof is asked in field mode (-F) rather than parsed as columns: the column
// output truncates COMMAND to nine characters, and a command name with a
// space in it makes column splitting guesswork. Fields are one per line,
// prefixed by their letter, grouped by process.

const LSOF_ARGS = ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcLn']
const LSOF_TIMEOUT_MS = 5000

function runLsof(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'lsof',
      LSOF_ARGS,
      { timeout: LSOF_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        // lsof exits non-zero when *some* of what it was asked about could not
        // be examined, which on a normal machine means "processes owned by
        // other users" - the rest of the listing is still good.
        if (error && !stdout) {
          reject(error)
          return
        }
        resolve(stdout)
      }
    )
  })
}

// `n` is the bound address: '*:7000', '127.0.0.1:49274', '[::1]:5432'. The
// port is what follows the last colon; everything before it is the address.
function splitAddress(name: string): { address: string; port: number } | null {
  const colon = name.lastIndexOf(':')
  if (colon === -1) return null
  const port = Number(name.slice(colon + 1))
  if (!Number.isInteger(port) || port <= 0) return null
  return { address: name.slice(0, colon) || '*', port }
}

export async function listListeningPorts(): Promise<ListeningPort[]> {
  let output = ''
  try {
    output = await runLsof()
  } catch {
    // No lsof (or it refused to run): an empty list, which the tab reports as
    // "nothing found" rather than pretending the machine has no servers.
    return []
  }

  const rows: ListeningPort[] = []
  const seen = new Set<string>()
  let pid = 0
  let command = ''
  let user = ''

  for (const line of output.split('\n')) {
    const value = line.slice(1)
    if (line.startsWith('p')) {
      pid = Number(value) || 0
      // A process block carries its own c/L; until they arrive these are the
      // previous process's, which would label the wrong rows.
      command = ''
      user = ''
    } else if (line.startsWith('c')) command = value
    else if (line.startsWith('L')) user = value
    else if (line.startsWith('n')) {
      const bound = splitAddress(value)
      if (!pid || !bound) continue
      // The same server bound to IPv4 and IPv6 is two descriptors and one
      // answer to "who has this port".
      const key = `${pid}:${bound.port}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ pid, command, user, protocol: 'TCP', address: bound.address, port: bound.port })
    }
  }

  return rows.sort((a, b) => a.port - b.port || a.pid - b.pid)
}

// Killing by pid is the one thing here that reaches outside the app, so the
// pid has to be one this machine is currently listening on: the renderer can
// only ever stop something the tab itself just listed, not name an arbitrary
// process. (Same posture as the path allowlist - see docs/BUGS.md §2.)
export async function killListeningProcess(pid: number, force: boolean): Promise<OpResult> {
  if (!Number.isInteger(pid) || pid <= 1) {
    return { success: false, error: 'That is not a process this can stop.' }
  }
  if (pid === process.pid || pid === process.ppid) {
    return { success: false, error: 'That is the editor itself.' }
  }
  const listening = await listListeningPorts()
  const match = listening.find((row) => row.pid === pid)
  if (!match) {
    return { success: false, error: 'That process is no longer listening on anything.' }
  }
  try {
    // SIGTERM first so a server gets to close its sockets and flush; SIGKILL
    // is the deliberate second press for one that ignores it.
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
    return { success: true }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EPERM') {
      return { success: false, error: `${match.command} belongs to another user - not stopped.` }
    }
    return { success: false, error: e instanceof Error ? e.message : 'It could not be stopped.' }
  }
}
