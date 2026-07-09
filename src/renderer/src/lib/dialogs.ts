// Imperative confirm()/alert() replacements that render as the app's own
// styled Modal instead of native OS dialogs. Any code (hooks included, not
// just components) can call these; a single <DialogHost /> mounted once in
// App renders whatever is currently pending.
export type DialogRequest =
  | { kind: 'confirm'; message: string; resolve: (value: boolean) => void }
  | { kind: 'alert'; message: string; resolve: () => void }

type Listener = (request: DialogRequest | null) => void

let listener: Listener | null = null

export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    listener?.({
      kind: 'confirm',
      message,
      resolve: (value: boolean) => {
        listener?.(null)
        resolve(value)
      }
    })
  })
}

export function alertDialog(message: string): Promise<void> {
  return new Promise((resolve) => {
    listener?.({
      kind: 'alert',
      message,
      resolve: () => {
        listener?.(null)
        resolve()
      }
    })
  })
}

export function subscribeDialogRequests(cb: Listener): () => void {
  listener = cb
  return () => {
    if (listener === cb) listener = null
  }
}
