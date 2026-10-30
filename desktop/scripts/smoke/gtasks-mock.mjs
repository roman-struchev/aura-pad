// A stand-in for Google's token endpoint and the Tasks API, so the Google
// Tasks tab can be driven end to end without a real account. The app is
// pointed at it through the AURAPAD_GTASKS_* env vars (src/main/googleTasks.ts)
// and the fixture plants accounts whose refresh token is simply their email -
// which the token endpoint hands back as the access token, so every API call
// says which account it is for.
//
// Only what the app calls is implemented, with the API's own shapes: lists,
// list/get/insert (with parent + previous)/patch/delete/move of tasks.

import http from 'http'

export const GTASKS_ACCOUNTS = ['first@example.com', 'second@example.com']

function seed() {
  let n = 0
  const task = (title, extra = {}) => ({
    id: `t${++n}`,
    title,
    status: 'needsAction',
    position: String(n).padStart(20, '0'),
    ...extra
  })
  return {
    'first@example.com': {
      lists: [{ id: 'first-default', title: 'My Tasks' }],
      tasks: {
        'first-default': [
          task('Move me across', { notes: 'with notes', due: '2026-12-01T00:00:00.000Z' }),
          task('first child', { parent: 't1' }),
          task('second child', { parent: 't1' }),
          task('Stay put')
        ]
      }
    },
    'second@example.com': {
      lists: [
        { id: 'second-default', title: 'My Tasks' },
        { id: 'second-work', title: 'Work' }
      ],
      tasks: { 'second-default': [task('Already here')], 'second-work': [] }
    }
  }
}

export function startGtasksMock(port) {
  const state = { data: seed(), seq: 1000 }

  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => (raw += d))
    req.on('end', () => {
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(body === undefined ? '' : JSON.stringify(body))
      }
      const url = new URL(req.url, 'http://127.0.0.1')

      if (url.pathname === '/token') {
        const params = new URLSearchParams(raw)
        return send(200, { access_token: params.get('refresh_token'), expires_in: 3600 })
      }

      const email = (req.headers.authorization || '').replace(/^Bearer /, '')
      const account = state.data[email]
      if (!account) return send(401, { error: { status: 'UNAUTHENTICATED', message: email } })

      const parts = url.pathname
        .replace(/^\/tasks\/v1\//, '')
        .split('/')
        .map(decodeURIComponent)
      const body = raw ? JSON.parse(raw) : {}

      if (parts.join('/') === 'users/@me/lists') return send(200, { items: account.lists })

      const [kind, listId, tasksWord, taskId, action] = parts
      if (kind !== 'lists' || tasksWord !== 'tasks' || !account.tasks[listId])
        return send(404, { error: { status: 'NOT_FOUND', message: url.pathname } })
      const tasks = account.tasks[listId]
      const found = taskId ? tasks.find((t) => t.id === taskId) : null
      if (taskId && !found) return send(404, { error: { status: 'NOT_FOUND', message: taskId } })

      if (!taskId && req.method === 'GET') return send(200, { items: tasks })
      if (!taskId && req.method === 'POST') {
        const parent = url.searchParams.get('parent') || undefined
        const previous = url.searchParams.get('previous')
        const prevTask = previous ? tasks.find((t) => t.id === previous) : null
        // Front of the list (or of the parent's children) unless placed
        // after a sibling - what the real insert does.
        const position = prevTask ? `${prevTask.position}5` : '0'
        const created = {
          id: `t${++state.seq}`,
          title: body.title ?? '',
          notes: body.notes,
          due: body.due,
          status: body.status ?? 'needsAction',
          completed: body.completed,
          parent,
          position
        }
        tasks.push(created)
        return send(200, created)
      }
      if (req.method === 'GET' && !action) return send(200, found)
      if (req.method === 'PATCH') {
        Object.assign(found, body)
        return send(200, found)
      }
      if (req.method === 'DELETE') {
        tasks.splice(tasks.indexOf(found), 1)
        return send(204)
      }
      if (req.method === 'POST' && action === 'move') return send(200, found)
      send(400, { error: { status: 'INVALID_ARGUMENT', message: `${req.method} ${url.pathname}` } })
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () =>
      resolve({
        state,
        tasksOf: (email, listId) => state.data[email].tasks[listId],
        close: () => server.close()
      })
    )
  })
}
