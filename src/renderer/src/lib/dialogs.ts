// Imperative confirm()/alert() replacements that render as the app's own
// styled Modal instead of native OS dialogs. Any code (hooks included, not
// just components) can call these; a single <DialogHost /> mounted once in
// App renders whatever is currently pending.
export type DialogRequest =
  | { kind: 'confirm'; message: string; resolve: (value: boolean) => void }
  | { kind: 'alert'; message: string; resolve: () => void }

type Listener = (request: DialogRequest | null) => void

let listener: Listener | null = null

// A second request while one is already showing (e.g. an app-close prompt
// arriving while a delete confirmation is still up) queues behind it instead
// of replacing it - replacing used to silently dismiss the first dialog and
// leave its Promise unresolved forever, hanging whatever awaited it.
const queue: DialogRequest[] = []

function showFront(): void {
  listener?.(queue[0] ?? null)
}

function enqueue(request: DialogRequest): void {
  queue.push(request)
  if (queue.length === 1) showFront()
}

function advance(): void {
  queue.shift()
  showFront()
}

export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({
      kind: 'confirm',
      message,
      resolve: (value: boolean) => {
        advance()
        resolve(value)
      }
    })
  })
}

export function alertDialog(message: string): Promise<void> {
  return new Promise((resolve) => {
    enqueue({
      kind: 'alert',
      message,
      resolve: () => {
        advance()
        resolve()
      }
    })
  })
}

export function subscribeDialogRequests(cb: Listener): () => void {
  listener = cb
  showFront()
  return () => {
    if (listener === cb) listener = null
  }
}
