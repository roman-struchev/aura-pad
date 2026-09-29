// One stored state of a file, from before some change overwrote it.
//
// `label` says what was about to happen when the snapshot was taken, because
// that is what the user is looking for in the list ("the state before the
// project-wide replace"), not the mechanics of how it got there.
export interface LocalHistoryEntry {
  // The snapshot's file name inside its folder - also its identity in IPC.
  id: string
  // When it was captured, epoch ms.
  at: number
  // Size of the stored text in bytes, shown in the list.
  bytes: number
  label: LocalHistoryLabel
}

// What was about to overwrite the stored state. Kept to the writers that
// exist: ordinary saves (autosave included), replace-across-files, and the
// one-step undo of that replace.
export type LocalHistoryLabel = 'Save' | 'Replace in files' | 'Undo replace in files'
