export interface GTaskList {
  id: string
  title: string
}

export interface GTask {
  id: string
  title: string
  notes?: string
  status: 'needsAction' | 'completed'
  // RFC 3339 timestamps as the Tasks API returns them. `due` only carries a
  // date (the API discards the time part), `completed` is set only for
  // completed tasks.
  due?: string
  completed?: string
  updated?: string
}

// Payload for creating/updating a task. `due`, when present, is either a full
// RFC 3339 timestamp (Tasks discards the time-of-day part anyway) or ''
// to clear it - callers convert a plain <input type="date"> value to that at
// the UI boundary (GoogleTaskEditModal), so main just forwards it to the API.
export interface GTaskInput {
  title: string
  notes?: string
  due?: string
}
