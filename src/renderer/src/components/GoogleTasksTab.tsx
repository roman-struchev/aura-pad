import React, { useEffect, useState } from 'react'
import {
  Plus,
  RefreshCw,
  X,
  SquareCheckBig,
  Circle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight,
  CalendarArrowDown
} from 'lucide-react'
import clsx from 'clsx'
import type { GTask, GTaskInput, GTaskList } from '../../../shared/googleTasks'
import type { AppSettings } from '../../../shared/settings'
import { alertDialog } from '../lib/dialogs'
import { useGoogleAccounts } from '../hooks/useGoogleAccounts'
import { GoogleTaskEditModal } from './GoogleTaskEditModal'

interface GoogleTasksTabProps {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}

interface ListWithTasks {
  list: GTaskList
  tasks: GTask[]
  error?: string
}

// Open tasks first, sorted by the API's manual-order `position` key -
// tasks.list() doesn't guarantee its response is already in that order (a
// documented Tasks API quirk), so a drag-reorder can look reverted on the
// next fetch/reload if the raw response order is trusted instead. Completed
// ones come after, newest completion first.
function sortTasks(tasks: GTask[]): GTask[] {
  const open = tasks
    .filter((t) => t.status === 'needsAction')
    .sort((a, b) => (a.position ?? '').localeCompare(b.position ?? ''))
  const done = tasks
    .filter((t) => t.status === 'completed')
    .sort((a, b) => (b.completed ?? '').localeCompare(a.completed ?? ''))
  return [...open, ...done]
}

// Ascending by due (reminder) date; undated tasks sink to the bottom, keeping
// their relative manual order. Used when the "sort by due date" toggle is on.
function orderByDue(tasks: GTask[]): GTask[] {
  return [...tasks].sort((a, b) => {
    if (!a.due && !b.due) return 0
    if (!a.due) return 1
    if (!b.due) return -1
    return a.due.localeCompare(b.due)
  })
}

// `due` carries only a date; render it date-only and flag overdue ones.
function formatDue(due: string): { label: string; overdue: boolean } {
  const date = new Date(due)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return { label: date.toLocaleDateString(), overdue: date < today }
}

interface TaskRowProps {
  task: GTask
  draggable?: boolean
  isDragging?: boolean
  isDragOver?: boolean
  // True while a toggle-complete request for this task is in flight - the
  // round trip to Google isn't instant, and with no feedback the task just
  // sits there looking unresponsive until it resolves.
  togglePending?: boolean
  onToggleComplete: () => void
  onEdit: () => void
  onDragStart?: () => void
  onDragEnd?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: () => void
  onDrop?: (e: React.DragEvent) => void
}

const TaskRow: React.FC<TaskRowProps> = ({
  task,
  draggable,
  isDragging,
  isDragOver,
  togglePending,
  onToggleComplete,
  onEdit,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop
}) => {
  const completed = task.status === 'completed'
  const due = task.due && !completed ? formatDue(task.due) : null
  return (
    <div
      className={clsx(
        'px-2 py-1.5 rounded hover:bg-fleet-active cursor-pointer',
        isDragOver && 'bg-blue-500/20',
        isDragging && 'opacity-40'
      )}
      onClick={onEdit}
      title="Click to edit"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          className="shrink-0 text-gray-500 hover:text-green-500 disabled:hover:text-gray-500"
          title={completed ? 'Mark as not done' : 'Mark as done'}
          disabled={togglePending}
          onClick={(e) => {
            e.stopPropagation()
            onToggleComplete()
          }}
        >
          {togglePending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : completed ? (
            <CheckCircle2 size={13} className="text-green-600/70" />
          ) : (
            <Circle size={13} />
          )}
        </button>
        <span
          className={clsx(
            'flex-1 min-w-0 truncate text-xs',
            completed ? 'text-gray-500 line-through' : 'text-fleet-text'
          )}
          title={task.title}
        >
          {task.title || '(untitled)'}
        </span>
        {due && (
          <span
            className={clsx(
              'text-[10px] shrink-0 px-1.5 py-px rounded-full border',
              due.overdue ? 'text-red-400 border-red-400/40' : 'text-gray-500 border-fleet-border'
            )}
          >
            {due.label}
          </span>
        )}
        {completed && task.completed && (
          <span className="text-[10px] text-gray-600 shrink-0">
            {new Date(task.completed).toLocaleDateString()}
          </span>
        )}
      </div>
      {task.notes && (
        <div
          className="ml-[21px] mt-0.5 text-[11px] text-gray-500 whitespace-pre-wrap line-clamp-3"
          title={task.notes}
        >
          {task.notes}
        </div>
      )}
    </div>
  )
}

// Google Tasks as a global extension tab (not bound to a project). Multiple
// accounts connect side by side and switch via the segmented control on top -
// the same pattern the git panel used for multiple repos. Supports creating
// and editing tasks (title/notes/due date, each with its own dictation mic),
// toggling completion, and drag-reordering open tasks within a list; deleting
// a task isn't exposed here (do that in Google Tasks itself). Completed tasks
// are hidden per list by default - "Show completed (n)" reveals them.
export const GoogleTasksTab: React.FC<GoogleTasksTabProps> = ({ settings, updateSetting }) => {
  // Account list + connect/disconnect shared with the Settings modal.
  const { accounts, initialized, connecting, connect, disconnect } = useGoogleAccounts()
  // The account the user explicitly picked (null = none chosen yet). The
  // *effective* active account is derived below, so it stays valid as the
  // list changes without a setState-in-effect.
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null)
  const [listsByEmail, setListsByEmail] = useState<Record<string, ListWithTasks[]>>({})
  // Which lists have their completed tasks revealed - keyed by list id, so
  // the setting is remembered across a refresh (but not across app restarts).
  const [expandedCompleted, setExpandedCompleted] = useState<Set<string>>(new Set())
  const [editState, setEditState] = useState<{
    mode: 'create' | 'edit'
    listId: string
    task?: GTask
  } | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  // The list a drag started from, so a drop can tell same-list reordering from
  // a cross-list move.
  const [draggedListId, setDraggedListId] = useState<string | null>(null)
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null)
  // The list currently hovered during a drag - highlights the drop target and,
  // for empty spots, appends to that list's end.
  const [dragOverListId, setDragOverListId] = useState<string | null>(null)
  // The list whose open tasks are currently being reordered by due date on
  // the server (a one-shot action, not a persistent view mode). Its sort
  // button shows a spinner and every list's button is disabled while it runs.
  const [sortingListId, setSortingListId] = useState<string | null>(null)
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null)
  // Bumped by the refresh button; the fetch effect keys on it.
  const [refreshSeq, setRefreshSeq] = useState(0)
  // Which fetch has finished (and with what error). Loading/error are derived
  // from comparing this against the current fetch key, so the effect below
  // never has to set state synchronously to reset them.
  const [fetchDone, setFetchDone] = useState<{ key: string; error: string | null }>({
    key: '',
    error: null
  })

  // Keep the active account valid as the list changes (initial load, connect,
  // disconnect) without a setState-in-effect: keep the user's pick if it's
  // still connected, else fall back to the first account.
  const activeEmail =
    selectedEmail && accounts.includes(selectedEmail) ? selectedEmail : (accounts[0] ?? null)

  const fetchKey = `${refreshSeq}:${activeEmail ?? ''}`
  const loading = !!activeEmail && fetchDone.key !== fetchKey
  const error = fetchDone.key === fetchKey ? fetchDone.error : null

  useEffect(() => {
    if (!activeEmail) return
    let cancelled = false
    ;(async () => {
      const listsResult = await window.api.gtasksLists(activeEmail)
      if (cancelled) return
      if (!listsResult.success) {
        setFetchDone({ key: fetchKey, error: listsResult.error })
        return
      }
      const withTasks = await Promise.all(
        listsResult.data.map(async (list): Promise<ListWithTasks> => {
          const tasksResult = await window.api.gtasksTasks(activeEmail, list.id)
          if (!tasksResult.success) return { list, tasks: [], error: tasksResult.error }
          return { list, tasks: sortTasks(tasksResult.data) }
        })
      )
      if (cancelled) return
      setListsByEmail((prev) => ({ ...prev, [activeEmail]: withTasks }))
      setFetchDone({ key: fetchKey, error: null })
    })()
    return () => {
      cancelled = true
    }
  }, [activeEmail, refreshSeq])

  // Re-pulls just one list after a mutation (create/edit/complete) - cheaper
  // and less jarring than refetching every list in every account.
  const refetchList = async (email: string, listId: string): Promise<void> => {
    const tasksResult = await window.api.gtasksTasks(email, listId)
    if (!tasksResult.success) return
    setListsByEmail((prev) => ({
      ...prev,
      [email]: (prev[email] ?? []).map((entry) =>
        entry.list.id === listId
          ? { ...entry, tasks: sortTasks(tasksResult.data), error: undefined }
          : entry
      )
    }))
  }

  const toggleComplete = async (task: GTask, listId: string): Promise<void> => {
    if (!activeEmail) return
    setTogglingTaskId(task.id)
    try {
      const result = await window.api.gtasksUpdateTask(activeEmail, listId, task.id, {
        status: task.status === 'completed' ? 'needsAction' : 'completed'
      })
      if (!result.success) {
        await alertDialog(result.error)
        return
      }
      await refetchList(activeEmail, listId)
    } finally {
      setTogglingTaskId(null)
    }
  }

  const saveTask = async (input: GTaskInput): Promise<boolean> => {
    if (!activeEmail || !editState) return false
    const result =
      editState.mode === 'create'
        ? await window.api.gtasksCreateTask(activeEmail, editState.listId, input)
        : await window.api.gtasksUpdateTask(
            activeEmail,
            editState.listId,
            editState.task!.id,
            input
          )
    if (!result.success) {
      await alertDialog(result.error)
      return false
    }
    await refetchList(activeEmail, editState.listId)
    return true
  }

  // Handles both drag gestures against open tasks:
  //   - same source/target list: reorder, inserting sourceTaskId just before
  //     targetTaskId (the tab bar's reorderTab semantics);
  //   - different lists: move the task into targetListId, before targetTaskId
  //     (or appended when targetTaskId is undefined, e.g. dropped on empty
  //     space), via the Tasks API's `destinationTasklist` move param.
  // Applied optimistically and left in place on success - Google's `move`
  // endpoint is known to lag behind its own list() for a beat, so refetching
  // right after a successful move would overwrite the correct new order with a
  // stale read and visibly snap the drop back. Only a failure triggers a
  // refetch, to revert to the server's real order.
  const moveTask = async (
    sourceListId: string,
    sourceTaskId: string,
    targetListId: string,
    targetTaskId?: string
  ): Promise<void> => {
    if (!activeEmail) return
    const entries = listsByEmail[activeEmail] ?? []
    const sourceEntry = entries.find((e) => e.list.id === sourceListId)
    const targetEntry = entries.find((e) => e.list.id === targetListId)
    if (!sourceEntry || !targetEntry) return
    const moved = sourceEntry.tasks.find((t) => t.id === sourceTaskId)
    if (!moved || moved.status !== 'needsAction') return

    const sameList = sourceListId === targetListId
    // A same-list drop onto self / nowhere is a no-op.
    if (sameList && (!targetTaskId || sourceTaskId === targetTaskId)) return

    const sourceDone = sourceEntry.tasks.filter((t) => t.status === 'completed')
    const sourceOpenRemaining = sourceEntry.tasks.filter(
      (t) => t.status === 'needsAction' && t.id !== sourceTaskId
    )

    // Destination open order with the task inserted at the drop position.
    const targetBaseOpen = sameList
      ? sourceOpenRemaining
      : targetEntry.tasks.filter((t) => t.status === 'needsAction')
    const targetDone = sameList
      ? sourceDone
      : targetEntry.tasks.filter((t) => t.status === 'completed')
    const insertIdx = targetTaskId
      ? targetBaseOpen.findIndex((t) => t.id === targetTaskId)
      : targetBaseOpen.length
    const newTargetOpen = [...targetBaseOpen]
    newTargetOpen.splice(insertIdx === -1 ? newTargetOpen.length : insertIdx, 0, moved)

    setListsByEmail((prev) => ({
      ...prev,
      [activeEmail]: (prev[activeEmail] ?? []).map((e) => {
        if (e.list.id === targetListId) return { ...e, tasks: [...newTargetOpen, ...targetDone] }
        if (e.list.id === sourceListId)
          return { ...e, tasks: [...sourceOpenRemaining, ...sourceDone] }
        return e
      })
    }))

    const movedIdx = newTargetOpen.findIndex((t) => t.id === sourceTaskId)
    const previousId = movedIdx > 0 ? newTargetOpen[movedIdx - 1].id : undefined
    const result = await window.api.gtasksMoveTask(
      activeEmail,
      sourceListId,
      sourceTaskId,
      previousId,
      sameList ? undefined : targetListId
    )
    if (!result.success) {
      await alertDialog(result.error)
      // The move never took effect server-side - resync with the real order.
      await refetchList(activeEmail, sourceListId)
      if (!sameList) await refetchList(activeEmail, targetListId)
    }
  }

  // Clears every transient drag flag - called from both drop handlers and
  // onDragEnd (a cross-list drop unmounts the source row before its dragend
  // fires, so drop must reset too or the moved task stays dimmed).
  const endDrag = (): void => {
    setDraggedTaskId(null)
    setDraggedListId(null)
    setDragOverTaskId(null)
    setDragOverListId(null)
  }

  const toggleShowCompleted = (listId: string): void => {
    setExpandedCompleted((prev) => {
      const next = new Set(prev)
      if (next.has(listId)) next.delete(listId)
      else next.add(listId)
      return next
    })
  }

  // One-shot "sort by due date": permanently reorders this list's open tasks
  // on the server (ascending due date, undated last) via sequential move
  // calls, so the order sticks rather than being a local-only view. Applied
  // optimistically with a spinner on the button; a failure reverts via
  // refetch. Per the move-endpoint lag note we don't refetch on success.
  const sortListByDue = async (listId: string): Promise<void> => {
    if (!activeEmail || sortingListId) return
    const entry = (listsByEmail[activeEmail] ?? []).find((e) => e.list.id === listId)
    if (!entry) return
    const open = entry.tasks.filter((t) => t.status === 'needsAction')
    const done = entry.tasks.filter((t) => t.status === 'completed')
    const ordered = orderByDue(open)
    // Nothing to do if it's already in due-date order.
    if (ordered.every((t, i) => t.id === open[i]?.id)) return

    setSortingListId(listId)
    setListsByEmail((prev) => ({
      ...prev,
      [activeEmail]: (prev[activeEmail] ?? []).map((e) =>
        e.list.id === listId ? { ...e, tasks: [...ordered, ...done] } : e
      )
    }))
    try {
      // Position each task just after its predecessor, front to back - each
      // move is relative to a sibling the previous iteration already placed,
      // so the final order is exactly `ordered` regardless of the start state.
      let previousId: string | undefined
      for (const task of ordered) {
        const result = await window.api.gtasksMoveTask(activeEmail, listId, task.id, previousId)
        if (!result.success) {
          await alertDialog(result.error)
          await refetchList(activeEmail, listId)
          return
        }
        previousId = task.id
      }
    } finally {
      setSortingListId(null)
    }
  }

  const addAccount = async (): Promise<void> => {
    const email = await connect()
    // Focus the newly connected account (the derived activeEmail only
    // guarantees *some* valid account stays selected, not the new one).
    if (email) setSelectedEmail(email)
  }

  const removeAccount = async (email: string): Promise<void> => {
    if (!(await disconnect(email))) return
    setListsByEmail((prev) => {
      const next = { ...prev }
      delete next[email]
      return next
    })
  }

  if (!initialized) return null

  if (accounts.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-500">
        <SquareCheckBig size={28} className="text-gray-600" />
        <span className="text-sm">Connect a Google account to see your tasks.</span>
        <button
          className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white flex items-center gap-1.5"
          disabled={connecting}
          onClick={addAccount}
        >
          {connecting && <Loader2 size={12} className="animate-spin" />}
          {connecting ? 'Waiting for browser sign-in…' : 'Add Google Account'}
        </button>
        <span className="text-[11px] text-gray-600 max-w-sm text-center">
          Requires an OAuth client (Settings → Google Tasks → Configure…).
        </span>
      </div>
    )
  }

  const lists = activeEmail ? listsByEmail[activeEmail] : undefined

  return (
    <div className="flex flex-col h-full min-h-0 bg-fleet-bg">
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-fleet-border shrink-0">
        <div className="flex gap-0.5 bg-fleet-header rounded-md p-0.5 text-xs min-w-0 overflow-x-auto">
          {accounts.map((email) => (
            <div
              key={email}
              className={clsx(
                'group flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer shrink-0',
                email === activeEmail
                  ? 'bg-fleet-active text-fleet-textHover'
                  : 'text-gray-400 hover:text-gray-200'
              )}
              onClick={() => setSelectedEmail(email)}
            >
              <span className="truncate max-w-[180px]">{email}</span>
              <X
                size={11}
                className="opacity-0 group-hover:opacity-50 hover:!opacity-100 shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  removeAccount(email)
                }}
              />
            </div>
          ))}
        </div>
        <button
          className="p-1 hover:bg-fleet-active rounded text-gray-400 hover:text-fleet-textHover shrink-0 disabled:opacity-40"
          title="Add Google Account"
          disabled={connecting}
          onClick={addAccount}
        >
          {connecting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        </button>
        <div className="flex-1" />
        <button
          className="p-1 hover:bg-fleet-active rounded text-gray-400 hover:text-fleet-textHover shrink-0"
          title="Refresh"
          onClick={() => setRefreshSeq((s) => s + 1)}
        >
          <RefreshCw size={13} className={clsx(loading && 'animate-spin')} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-3">
        {error ? (
          <div className="text-xs text-red-400">{error}</div>
        ) : !lists ? (
          <div className="text-xs text-gray-500 italic">Loading…</div>
        ) : lists.length === 0 ? (
          <div className="text-xs text-gray-500 italic">No task lists.</div>
        ) : (
          <div className="grid gap-3 items-start [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
            {lists.map(({ list, tasks, error: listError }) => {
              const open = tasks.filter((t) => t.status === 'needsAction')
              const completed = tasks.filter((t) => t.status === 'completed')
              const showCompleted = expandedCompleted.has(list.id)
              const sorting = sortingListId === list.id
              // A drag from another list can drop anywhere on this card (not
              // just onto a row), so the whole card is a drop target that
              // appends to the list's end.
              const isDropTarget =
                dragOverListId === list.id && draggedListId !== list.id && !dragOverTaskId
              return (
                <div
                  key={list.id}
                  className={clsx(
                    'border rounded-lg p-2 min-w-0 bg-fleet-header shadow-sm',
                    isDropTarget ? 'border-blue-500/60 bg-blue-500/5' : 'border-fleet-border'
                  )}
                  onDragOver={(e) => {
                    if (!draggedTaskId || draggedListId === list.id) return
                    e.preventDefault()
                    setDragOverListId(list.id)
                  }}
                  onDragLeave={(e) => {
                    // Only clear when the pointer actually leaves the card, not
                    // when it moves between the card's own children.
                    if (!e.currentTarget.contains(e.relatedTarget as Node))
                      setDragOverListId((id) => (id === list.id ? null : id))
                  }}
                  onDrop={(e) => {
                    if (!draggedTaskId || !draggedListId || draggedListId === list.id) return
                    e.preventDefault()
                    const src = draggedListId
                    const id = draggedTaskId
                    endDrag()
                    moveTask(src, id, list.id)
                  }}
                >
                  <div className="flex items-center gap-1.5 px-2 pb-1.5 mb-1 border-b border-fleet-border">
                    <span className="text-xs font-medium text-fleet-textHover truncate flex-1">
                      {list.title}
                    </span>
                    <span className="text-[10px] text-gray-500 shrink-0">{open.length}</span>
                    <button
                      className="p-0.5 rounded shrink-0 hover:bg-fleet-border text-gray-400 hover:text-fleet-textHover disabled:opacity-50 disabled:hover:bg-transparent"
                      title="Sort by due date"
                      disabled={!!sortingListId}
                      onClick={() => sortListByDue(list.id)}
                    >
                      {sorting ? (
                        <Loader2 size={12} className="animate-spin text-blue-400" />
                      ) : (
                        <CalendarArrowDown size={12} />
                      )}
                    </button>
                    <button
                      className="p-0.5 rounded hover:bg-fleet-border text-gray-400 hover:text-fleet-textHover shrink-0"
                      title="New Task"
                      onClick={() => setEditState({ mode: 'create', listId: list.id })}
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                  {listError ? (
                    <div className="text-[11px] text-red-400 px-2 py-1">{listError}</div>
                  ) : (
                    <>
                      {open.length === 0 && completed.length === 0 && (
                        <div className="text-[11px] text-gray-600 italic px-2 py-1">No tasks.</div>
                      )}
                      {open.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          draggable
                          isDragging={draggedTaskId === task.id}
                          isDragOver={dragOverTaskId === task.id}
                          togglePending={togglingTaskId === task.id}
                          onToggleComplete={() => toggleComplete(task, list.id)}
                          onEdit={() => setEditState({ mode: 'edit', listId: list.id, task })}
                          onDragStart={() => {
                            setDraggedTaskId(task.id)
                            setDraggedListId(list.id)
                          }}
                          onDragEnd={endDrag}
                          onDragOver={(e) => {
                            if (!draggedTaskId || draggedTaskId === task.id) return
                            e.preventDefault()
                            e.stopPropagation()
                            setDragOverTaskId(task.id)
                            setDragOverListId(list.id)
                          }}
                          onDragLeave={() => setDragOverTaskId(null)}
                          onDrop={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (draggedTaskId && draggedListId) {
                              const src = draggedListId
                              const id = draggedTaskId
                              // Reset drag state now, not just in onDragEnd: a
                              // cross-list move unmounts the source row, so its
                              // dragend may never fire, leaving the moved task
                              // stuck at opacity-40 (isDragging) in its new list.
                              endDrag()
                              moveTask(src, id, list.id, task.id)
                            } else endDrag()
                          }}
                        />
                      ))}
                      {completed.length > 0 && (
                        <button
                          className="w-full flex items-center gap-1 px-2 py-1 text-[10px] text-gray-500 hover:text-fleet-text"
                          onClick={() => toggleShowCompleted(list.id)}
                        >
                          {showCompleted ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          {showCompleted ? 'Hide' : 'Show'} completed ({completed.length})
                        </button>
                      )}
                      {showCompleted &&
                        completed.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            togglePending={togglingTaskId === task.id}
                            onToggleComplete={() => toggleComplete(task, list.id)}
                            onEdit={() => setEditState({ mode: 'edit', listId: list.id, task })}
                          />
                        ))}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editState && (
        <GoogleTaskEditModal
          mode={editState.mode}
          task={editState.task}
          onSave={saveTask}
          onClose={() => setEditState(null)}
          dictationEnabled={settings.dictationEnabled}
          voiceModel={settings.voiceModel}
          voiceLanguage={settings.voiceLanguage}
          onVoiceModelChange={(model) => updateSetting('voiceModel', model)}
          onVoiceLanguageChange={(language) => updateSetting('voiceLanguage', language)}
        />
      )}
    </div>
  )
}
