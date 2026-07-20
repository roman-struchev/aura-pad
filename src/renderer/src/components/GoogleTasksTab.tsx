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
  ChevronRight
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

// Open tasks first in the API's own (manual) order, completed ones after,
// newest completion first.
function sortTasks(tasks: GTask[]): GTask[] {
  const open = tasks.filter((t) => t.status === 'needsAction')
  const done = tasks
    .filter((t) => t.status === 'completed')
    .sort((a, b) => (b.completed ?? '').localeCompare(a.completed ?? ''))
  return [...open, ...done]
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
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null)
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

  // Reorders open tasks within one list by moving sourceTaskId to just before
  // targetTaskId (same drag semantics as the tab bar's reorderTab). Applied
  // optimistically and left in place on success - Google's `move` endpoint
  // is known to lag behind its own list() for a beat, so refetching right
  // after a successful move would overwrite the correct new order with a
  // stale read and visibly snap the drop back to where it started. Only a
  // failed move triggers a refetch, to revert to the server's real order.
  const reorderTask = async (
    listId: string,
    sourceTaskId: string,
    targetTaskId: string
  ): Promise<void> => {
    if (!activeEmail || sourceTaskId === targetTaskId) return
    const entry = (listsByEmail[activeEmail] ?? []).find((e) => e.list.id === listId)
    if (!entry) return
    const open = entry.tasks.filter((t) => t.status === 'needsAction')
    const completedTasks = entry.tasks.filter((t) => t.status === 'completed')
    const sourceIdx = open.findIndex((t) => t.id === sourceTaskId)
    const targetIdx = open.findIndex((t) => t.id === targetTaskId)
    if (sourceIdx === -1 || targetIdx === -1) return

    const reordered = [...open]
    const [moved] = reordered.splice(sourceIdx, 1)
    reordered.splice(targetIdx, 0, moved)

    setListsByEmail((prev) => ({
      ...prev,
      [activeEmail]: (prev[activeEmail] ?? []).map((e) =>
        e.list.id === listId ? { ...e, tasks: [...reordered, ...completedTasks] } : e
      )
    }))

    const movedIdx = reordered.findIndex((t) => t.id === sourceTaskId)
    const previousId = movedIdx > 0 ? reordered[movedIdx - 1].id : undefined
    const result = await window.api.gtasksMoveTask(activeEmail, listId, sourceTaskId, previousId)
    if (!result.success) {
      await alertDialog(result.error)
      // The move never took effect server-side - resync with the real order.
      await refetchList(activeEmail, listId)
    }
  }

  const toggleShowCompleted = (listId: string): void => {
    setExpandedCompleted((prev) => {
      const next = new Set(prev)
      if (next.has(listId)) next.delete(listId)
      else next.add(listId)
      return next
    })
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
          className="p-1 hover:bg-fleet-active rounded text-gray-400 hover:text-white shrink-0 disabled:opacity-40"
          title="Add Google Account"
          disabled={connecting}
          onClick={addAccount}
        >
          {connecting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        </button>
        <div className="flex-1" />
        <button
          className="p-1 hover:bg-fleet-active rounded text-gray-400 hover:text-white shrink-0"
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
              return (
                <div
                  key={list.id}
                  className="border border-fleet-border rounded-lg p-2 min-w-0 bg-fleet-sidebar/40"
                >
                  <div className="flex items-center gap-1.5 px-2 pb-1.5 mb-1 border-b border-fleet-border">
                    <span className="text-xs font-medium text-fleet-textHover truncate flex-1">
                      {list.title}
                    </span>
                    <span className="text-[10px] text-gray-500 shrink-0">{open.length}</span>
                    <button
                      className="p-0.5 rounded hover:bg-fleet-border text-gray-400 hover:text-white shrink-0"
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
                          onDragStart={() => setDraggedTaskId(task.id)}
                          onDragEnd={() => {
                            setDraggedTaskId(null)
                            setDragOverTaskId(null)
                          }}
                          onDragOver={(e) => {
                            e.preventDefault()
                            if (draggedTaskId && draggedTaskId !== task.id)
                              setDragOverTaskId(task.id)
                          }}
                          onDragLeave={() => setDragOverTaskId(null)}
                          onDrop={(e) => {
                            e.preventDefault()
                            setDragOverTaskId(null)
                            if (draggedTaskId) reorderTask(list.id, draggedTaskId, task.id)
                          }}
                        />
                      ))}
                      {completed.length > 0 && (
                        <button
                          className="w-full flex items-center gap-1 px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300"
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
