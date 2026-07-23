import { app, shell, BrowserWindow } from 'electron'
import crypto from 'crypto'
import http from 'http'
import path from 'path'
import { readConfigFile, writeConfigFile } from './configFile'
import { loadSettings } from './settings'
import type { GTask, GTaskInput, GTaskList } from '../shared/googleTasks'

// Read-write scope: the tab can create/edit tasks, not just display them.
// openid+email are for the id_token, which is how the account gets labeled
// in the UI. Accounts connected before this scope change carry a
// tasks.readonly-only refresh token and must be reconnected (remove + add)
// to pick up write access - Google won't silently upgrade an existing grant.
const SCOPE = 'https://www.googleapis.com/auth/tasks openid email'
// Env overrides exist so the whole OAuth round-trip can be exercised against
// a local mock (same spirit as AURAPAD_USER_DATA_DIR).
const AUTH_URL =
  process.env.AURAPAD_GTASKS_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = process.env.AURAPAD_GTASKS_TOKEN_URL || 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const TASKS_API = process.env.AURAPAD_GTASKS_API_URL || 'https://tasks.googleapis.com/tasks/v1'
const AUTH_TIMEOUT_MS = 5 * 60 * 1000

interface StoredAccount {
  email: string
  refreshToken: string
}

const accountsPath = (): string => path.join(app.getPath('userData'), 'googleTasksAccounts.json')

// Optional baked-in OAuth client. For installed apps Google treats the
// "secret" as non-confidential, so shipping one in the binary is normal
// practice - fill these in once and the whole Settings→client-id step
// disappears for every install; the settings fields then act as an override.
const EMBEDDED_CLIENT_ID = ''
const EMBEDDED_CLIENT_SECRET = ''

function loadAccounts(): StoredAccount[] {
  // Copied so add/remove below can build new lists without mutating the
  // cached array inside readConfigFile.
  return [...readConfigFile<StoredAccount[]>(accountsPath(), () => [])]
}

function saveAccounts(accounts: StoredAccount[]): void {
  writeConfigFile(accountsPath(), accounts)
}

export function listAccounts(): string[] {
  return loadAccounts().map((a) => a.email)
}

// Access tokens are short-lived and kept in memory only; the refresh token
// on disk is the durable credential.
const accessTokens = new Map<string, { token: string; expiresAt: number }>()

function oauthClient(): { clientId: string; clientSecret: string } {
  const { clientId, clientSecret } = loadSettings().extensions.googleTasks
  return {
    clientId: clientId || EMBEDDED_CLIENT_ID,
    clientSecret: clientSecret || EMBEDDED_CLIENT_SECRET
  }
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    // Google's descriptions alone can be useless ("Bad Request") - always
    // include the machine-readable error code too.
    const parts = [data.error, data.error_description].filter(Boolean)
    throw new Error(
      parts.length > 0 ? `Google: ${parts.join(' — ')}` : `Token request failed (${res.status})`
    )
  }
  return data
}

// The id_token is consumed right off the token endpoint's TLS response, so
// its signature doesn't need verifying - this is just payload extraction.
function emailFromIdToken(idToken: string): string {
  const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf-8'))
  return String(payload.email || '')
}

// Loopback OAuth flow for installed apps: a throwaway local HTTP server is
// the redirect target, the system browser does the actual sign-in. Resolves
// with the authorization code once Google redirects back. The redirect URI
// is captured once at listen time: the token exchange must present the exact
// same URI, and `server.address()` is already null again by the time the
// redirect request arrives and the server is closed.
function waitForAuthCode(
  authUrlFor: (redirectUri: string) => string
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    let redirectUri = ''
    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('Sign-in timed out.'))
    }, AUTH_TIMEOUT_MS)

    server.on('request', (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      if (!code && !error) {
        // Favicon probes etc. - not the redirect yet.
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        '<html><body style="font-family:sans-serif;padding:2em">You can close this window and return to AuraPad.</body></html>'
      )
      clearTimeout(timeout)
      server.close()
      // The user has been in the browser for the whole sign-in; pull AuraPad
      // back to the front so they actually see the connected result instead
      // of it landing silently behind the browser window. steal:true is
      // needed on macOS to take focus from another app.
      app.focus({ steal: true })
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
      if (win) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
      if (code) resolve({ code, redirectUri })
      else reject(new Error(`Sign-in was declined (${error}).`))
    })

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      redirectUri = `http://127.0.0.1:${port}`
      // A browser that fails to open would otherwise leave the flow hanging
      // until the timeout with nothing shown to the user.
      shell.openExternal(authUrlFor(redirectUri)).catch((e) => {
        clearTimeout(timeout)
        server.close()
        reject(new Error(`Could not open the browser: ${e?.message ?? e}`))
      })
    })
    server.on('error', (e) => {
      clearTimeout(timeout)
      reject(e)
    })
  })
}

// Only one browser sign-in at a time - a second concurrent flow would open a
// second browser tab and race the first one's local server.
let authInFlight = false

export async function addAccount(): Promise<{ success: boolean; email?: string; error?: string }> {
  const { clientId, clientSecret } = oauthClient()
  if (!clientId) {
    return {
      success: false,
      error: 'Set the Google OAuth Client ID in Settings → Google Tasks → Configure… first.'
    }
  }
  if (authInFlight) return { success: false, error: 'A sign-in is already in progress.' }
  authInFlight = true
  try {
    const verifier = crypto.randomBytes(32).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')

    const { code, redirectUri } = await waitForAuthCode((uri) => {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: uri,
        response_type: 'code',
        scope: SCOPE,
        // Without offline+consent Google may omit the refresh token on
        // repeat sign-ins, which would leave the account unusable after the
        // first access token expires.
        access_type: 'offline',
        prompt: 'consent',
        code_challenge: challenge,
        code_challenge_method: 'S256'
      })
      return `${AUTH_URL}?${params.toString()}`
    })

    const tokens = await tokenRequest({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier
    })

    const refreshToken = String(tokens.refresh_token || '')
    if (!refreshToken) return { success: false, error: 'Google did not return a refresh token.' }
    const email = tokens.id_token ? emailFromIdToken(String(tokens.id_token)) : ''
    if (!email) return { success: false, error: 'Could not determine the account email.' }

    const accounts = loadAccounts().filter((a) => a.email !== email)
    accounts.push({ email, refreshToken })
    saveAccounts(accounts)
    accessTokens.set(email, {
      token: String(tokens.access_token),
      expiresAt: Date.now() + (Number(tokens.expires_in || 0) - 60) * 1000
    })
    return { success: true, email }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    authInFlight = false
  }
}

export async function removeAccount(email: string): Promise<void> {
  const accounts = loadAccounts()
  const account = accounts.find((a) => a.email === email)
  saveAccounts(accounts.filter((a) => a.email !== email))
  accessTokens.delete(email)
  if (account) {
    // Best-effort revoke; the account is gone locally either way.
    try {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(account.refreshToken)}`, {
        method: 'POST'
      })
    } catch (e) {
      console.warn('Failed to revoke Google token:', e)
    }
  }
}

async function getAccessToken(email: string): Promise<string> {
  const cached = accessTokens.get(email)
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const account = loadAccounts().find((a) => a.email === email)
  if (!account) throw new Error(`Account ${email} is not connected.`)
  const { clientId, clientSecret } = oauthClient()
  const tokens = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: account.refreshToken,
    grant_type: 'refresh_token'
  })
  const token = String(tokens.access_token)
  accessTokens.set(email, {
    token,
    expiresAt: Date.now() + (Number(tokens.expires_in || 0) - 60) * 1000
  })
  return token
}

async function apiRequest(
  email: string,
  method: string,
  url: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const doFetch = (token: string): Promise<Response> =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })

  let token = await getAccessToken(email)
  let res = await doFetch(token)
  if (res.status === 401) {
    // Token revoked or expired early - drop the cache and retry once.
    accessTokens.delete(email)
    token = await getAccessToken(email)
    res = await doFetch(token)
  }
  if (!res.ok) {
    // Google's JSON error body (error.message/status) is far more actionable
    // than the bare status code - e.g. "insufficient authentication scopes"
    // vs. "access_denied: ... has not completed the Google verification
    // process" point to completely different fixes.
    let detail = ''
    try {
      const body = (await res.json()) as { error?: { message?: string; status?: string } }
      detail = [body.error?.status, body.error?.message].filter(Boolean).join(': ')
    } catch {
      // Non-JSON error body - fall through with just the status.
    }
    throw new Error(
      detail ? `Google Tasks API: ${detail}` : `Google Tasks API error (${res.status}).`
    )
  }
  return (await res.json()) as Record<string, unknown>
}

const apiGet = (email: string, url: string): Promise<Record<string, unknown>> =>
  apiRequest(email, 'GET', url)

type ApiResult<T> = { success: true; data: T } | { success: false; error: string }

async function wrap<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    return { success: true, data: await fn() }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function listTaskLists(email: string): Promise<ApiResult<GTaskList[]>> {
  return wrap(async () => {
    const data = await apiGet(email, `${TASKS_API}/users/@me/lists?maxResults=100`)
    const items = (data.items as Record<string, unknown>[] | undefined) ?? []
    return items.map((l) => ({ id: String(l.id), title: String(l.title || 'Untitled') }))
  })
}

function toGTask(t: Record<string, unknown>): GTask {
  return {
    id: String(t.id),
    title: String(t.title || ''),
    notes: t.notes ? String(t.notes) : undefined,
    status: t.status === 'completed' ? ('completed' as const) : ('needsAction' as const),
    due: t.due ? String(t.due) : undefined,
    completed: t.completed ? String(t.completed) : undefined,
    updated: t.updated ? String(t.updated) : undefined
  }
}

export function listTasks(email: string, listId: string): Promise<ApiResult<GTask[]>> {
  return wrap(async () => {
    // showDeleted defaults to false - deleted tasks stay out, as intended.
    // showHidden is required to see completed tasks at all (the Tasks apps
    // "hide" them on completion); the renderer decides whether to display
    // them (hidden by default, revealed on request).
    const data = await apiGet(
      email,
      `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks?maxResults=200&showCompleted=true&showHidden=true`
    )
    const items = (data.items as Record<string, unknown>[] | undefined) ?? []
    return items.map(toGTask)
  })
}

export function createTask(
  email: string,
  listId: string,
  input: GTaskInput
): Promise<ApiResult<GTask>> {
  return wrap(async () => {
    const data = await apiRequest(
      email,
      'POST',
      `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks`,
      { title: input.title, notes: input.notes || undefined, due: input.due || undefined }
    )
    return toGTask(data)
  })
}

// Reordering within a list isn't a field you PATCH - the Tasks API has a
// dedicated move endpoint that repositions a task relative to a sibling.
// Omitting `previous` moves it to the very front of the list. Passing
// `destinationListId` moves the task into another list (of the same account)
// - `listId` is always the task's *current* list, the destination is a
// separate query param.
export function moveTask(
  email: string,
  listId: string,
  taskId: string,
  previousTaskId?: string,
  destinationListId?: string
): Promise<ApiResult<GTask>> {
  return wrap(async () => {
    const params = new URLSearchParams()
    if (previousTaskId) params.set('previous', previousTaskId)
    if (destinationListId) params.set('destinationTasklist', destinationListId)
    const query = params.toString() ? `?${params.toString()}` : ''
    const data = await apiRequest(
      email,
      'POST',
      `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/move${query}`
    )
    return toGTask(data)
  })
}

export function updateTask(
  email: string,
  listId: string,
  taskId: string,
  input: Partial<GTaskInput> & { status?: 'needsAction' | 'completed' }
): Promise<ApiResult<GTask>> {
  return wrap(async () => {
    const body: Record<string, unknown> = {}
    if (input.title !== undefined) body.title = input.title
    // '' clears the field (this API has no way to say "omit" vs. "empty" for
    // a string field other than not including the key at all, which is what
    // callers do when they don't want to touch it - see the `!== undefined`
    // guards here).
    if (input.notes !== undefined) body.notes = input.notes
    if (input.due !== undefined) body.due = input.due || null
    if (input.status !== undefined) body.status = input.status
    const data = await apiRequest(
      email,
      'PATCH',
      `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
      body
    )
    return toGTask(data)
  })
}
