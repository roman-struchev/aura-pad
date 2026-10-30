// A localStorage-backed set of "download finished" marker strings, shared by
// the three model features (dictation / translate / read-aloud). The actual
// model bytes live elsewhere (transformers.js Cache API, or piper's OPFS);
// this is only the flag that gates the consent dialogs. A corrupt or absent
// value reads as empty, so a bad write can never wedge a feature.
//
// Key derivation and freeing the bytes (which differ per feature — Cache API
// vs OPFS, and different repo lookups) stay in each feature's own module;
// only this boilerplate set logic is shared.
export interface DownloadedSet {
  list: () => string[]
  has: (id: string) => boolean
  add: (id: string) => void
  remove: (id: string) => void
}

export function makeDownloadedSet(storageKey: string): DownloadedSet {
  const read = (): string[] => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]
    } catch {
      return []
    }
  }
  return {
    list: read,
    has: (id) => read().includes(id),
    add: (id) => {
      const l = read()
      if (!l.includes(id)) localStorage.setItem(storageKey, JSON.stringify([...l, id]))
    },
    remove: (id) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(read().filter((x) => x !== id)))
      } catch {
        localStorage.removeItem(storageKey)
      }
    }
  }
}
