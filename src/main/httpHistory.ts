import { app } from 'electron'
import path from 'path'
import { readConfigFile, writeConfigFile } from './configFile'
import type { HttpHistoryEntry, HttpRequestSpec, HttpResponse } from '../shared/http'
import { HTTP_HISTORY_LIMIT } from '../shared/http'

// Every request the client sends, newest first, kept in userData rather than
// in settings.json - it is a log, not a preference, and it would otherwise
// grow the file the whole app reads on startup.
//
// Recorded here in main (not in the renderer) so it covers both routes into
// the client: the ▶ Run in a .http file and the HTTP Client tab's form.
//
// It stores the full request, headers included, because its reason to exist
// is re-running one - which means an Authorization header written into a
// request lands on disk in this file. Clearing the history from the tab
// deletes it.
const historyPath = path.join(app.getPath('userData'), 'httpHistory.json')

export function loadHttpHistory(): HttpHistoryEntry[] {
  return readConfigFile<HttpHistoryEntry[]>(historyPath, () => [])
}

export function recordHttpRequest(
  spec: HttpRequestSpec,
  outcome: { response?: HttpResponse; error?: string }
): HttpHistoryEntry[] {
  const entry: HttpHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sentAt: Date.now(),
    spec,
    status: outcome.response?.status,
    durationMs: outcome.response?.timings.totalMs,
    bodyBytes: outcome.response?.bodyBytes,
    error: outcome.error
  }
  const entries = [entry, ...loadHttpHistory()].slice(0, HTTP_HISTORY_LIMIT)
  writeConfigFile(historyPath, entries)
  return entries
}

export function clearHttpHistory(): HttpHistoryEntry[] {
  writeConfigFile(historyPath, [])
  return []
}
