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
  // Manual-order sort key the API assigns/updates on create and move() - a
  // zero-padded numeric string, so plain lexicographic comparison sorts
  // correctly. tasks.list() does NOT guarantee its response is already in
  // this order (a documented API quirk), so callers must sort by it
  // themselves to get the order the Google Tasks app shows.
  position?: string
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
