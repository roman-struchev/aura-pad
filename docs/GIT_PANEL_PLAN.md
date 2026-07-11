# Git Panel Redesign — JetBrains-style Commit UI

Implementation plan. Execute the steps in order; each step compiles on its own.
Do not start new architectural discussions — all decisions below are final.

## Goal

Replace the current staged/unstaged git panel with a JetBrains-IDEA-style
commit tool window: one "Changes" list with checkboxes (checked = will be
committed), an "Unversioned Files" group, filename-first rows colored by
status, a commit box pinned to the bottom with **Commit** and **Commit & Push**
buttons, ahead/behind counters on the branch row, and an **Amend** checkbox.

The staging area is hidden from the user: *checked ⇔ staged* is the invariant.
Toggling a checkbox stages/unstages the file. Commit re-adds all checked paths
first (so unstaged-on-top edits of a checked file are included, like IDEA),
then commits.

## Non-goals (do NOT touch)

- The diff stays in the existing `Modal` (no editor tabs for diffs).
- The multi-repo switcher chips in `GitPanel` stay as they are.
- Watcher/`git-status-changed` push flow, settings, menu actions — unchanged.
- Push/pull result reporting via `alertDialog` — unchanged.
- No new dependencies. Use native `<input type="checkbox">` (supports
  `indeterminate` via ref), not icon-based checkboxes.

## Current state (file map)

| File | Role |
|---|---|
| `src/main/git.ts` | git CLI wrapper: status/numstat/stage/unstage/discard/commit/push/pull |
| `src/main/index.ts:335-375` | git IPC handlers (`git-status`, `git-stage`, `git-commit`, …) |
| `src/preload/index.ts:103-115`, `src/preload/index.d.ts:72-94` | IPC bridge + types |
| `src/shared/gitStatus.ts` | `GitFileState`, `GitFileEntry`, `GitRepoStatus` |
| `src/renderer/src/hooks/useGitStatus.ts` | renderer-side state + IPC wrappers + dialogs |
| `src/renderer/src/components/GitPanel.tsx` | the panel UI (rewritten by this plan) |
| `src/renderer/src/components/Sidebar.tsx` | hosts GitPanel inside a scrollable wrapper |
| `src/renderer/src/App.tsx:863-885` | threads `useGitStatus` results into Sidebar |
| `src/renderer/src/components/FileTree.tsx:26-33` | `GIT_BADGE` colors in the file tree |

Key existing behaviors to preserve:

- `useGitStatus.discard` deletes untracked files to Trash via `deletePath`
  and runs `git checkout HEAD --` for tracked ones (resets index + worktree).
- Every mutating IPC returns `{ …, statuses }` and the hook calls
  `setRawRepos(result.statuses)` — keep that pattern for all changed calls.
- Checkbox state must be **derived from props** (staged ⇔ checked), never
  duplicated in local `useState`, so watcher-driven status pushes can't desync it.

## Target UI (panel, sidebar width ~256px)

```
 [repo chips — unchanged, only when >1 repo]
 ⎇ main ↑2 ↓1                     ⇣  ⇡      ← branch row + pull/push buttons
 ☑ Changes                        3 files    ← group checkbox (indeterminate ok)
   ☑ M  App.tsx        src/renderer   +5 −2
   ☑ A  git.ts         src/main       +120
   ☑ D  old.css        src/styles     −80
 Unversioned Files                     1     ← no group checkbox
   ☐ U  notes.md                      +40
─────────────────────────────────────────── ← commit area pinned to bottom
 ┌─────────────────────────────────────────┐
 │ Commit message…            (textarea)   │
 └─────────────────────────────────────────┘
 ☐ Amend
 [Commit]  [Commit & Push]
```

Row anatomy (left → right): checkbox · status letter · **filename** colored by
status · parent dir in dim gray (truncated) · `+N −N` counters · hover-only
discard button (RotateCcw). Clicking the row (not the checkbox) opens the diff
modal, as today. Full `relPath` goes into the row `title` attribute.

Status palette (IDEA-familiar), used for both the letter and the filename:

| state | letter | Tailwind class |
|---|---|---|
| modified | M | `text-blue-400` |
| renamed | R | `text-blue-400` |
| added | A | `text-green-500` |
| deleted | D | `text-gray-500` + `line-through` on the name |
| untracked | U | `text-red-400` |

---

## Step 1 — shared types (`src/shared/gitStatus.ts`)

Add ahead/behind to `GitRepoStatus`:

```ts
export interface GitRepoStatus {
  root: string
  branch: string
  ahead: number   // commits ahead of upstream; 0 when none/no upstream
  behind: number  // commits behind upstream; 0 when none/no upstream
  staged: GitFileEntry[]
  unstaged: GitFileEntry[]
}
```

## Step 2 — backend (`src/main/git.ts`)

1. **Ahead/behind.** Replace `parseBranch(headerLine): string` with
   `parseBranchHeader(headerLine): { branch: string; ahead: number; behind: number }`.
   Keep the existing branch-name logic. Additionally parse the bracket suffix
   of `git status -b` porcelain headers, e.g.
   `## main...origin/main [ahead 2, behind 1]`, `[ahead 2]`, `[behind 3]`,
   `[gone]` → regexes `/\[.*ahead (\d+)/` and `/behind (\d+)\]?/` are enough;
   default both to 0. Wire the two numbers into the `GitRepoStatus` returned
   by `getRepoStatus`.

2. **Batch stage/unstage.** Change signatures to take arrays (single git spawn):

   ```ts
   export function stagePaths(root: string, relPaths: string[]) // ['add', '--', ...relPaths]
   export function unstagePaths(root: string, relPaths: string[]) // ['reset', '--', ...relPaths]
   ```

   Return type stays `Promise<{ success: boolean; error?: string }>`. Note:
   `git add -- <path>` also stages deletions of tracked files — no special
   casing for deleted paths.

3. **Commit over checked paths + amend.** Replace `commit(root, message)` with:

   ```ts
   export async function commit(
     root: string,
     message: string,
     relPaths: string[],
     amend: boolean
   ): Promise<{ success: boolean; error?: string }>
   ```

   Behavior: if `relPaths.length > 0`, first run `git add -- <relPaths>`
   (re-adds checked files so unstaged-on-top edits are included; also stages
   deletions). Then `git commit -m <message>` plus `--amend` when `amend` is
   true. If the `add` step fails, return its error without committing.
   `relPaths` may be empty only when `amend` is true (message-only amend).

4. **Last commit message** (for Amend prefill):

   ```ts
   export async function lastCommitMessage(root: string): Promise<string>
   // runGit(root, ['log', '-1', '--pretty=%B']).trim(); '' on error (e.g. no commits)
   ```

## Step 3 — IPC handlers (`src/main/index.ts`, git section at lines 335–375)

- `git-stage` / `git-unstage`: accept `relPaths: string[]` instead of a single
  `relPath`; call the renamed batch functions. Keep returning
  `{ ...result, statuses: await refreshedStatuses() }`.
- `git-commit`: accept `(root, message, relPaths: string[], amend: boolean)`,
  call the new `commit`.
- New handler `git-last-commit-message`: `(root) => lastCommitMessage(root)`.
- `git-discard`, `git-status`, `git-diff`, `git-push`, `git-pull` — unchanged.

## Step 4 — preload (`src/preload/index.ts` + `src/preload/index.d.ts`)

Update the bridge and the `window.api` declarations to match Step 3:

```ts
gitStage: (root: string, relPaths: string[]) => ipcRenderer.invoke('git-stage', root, relPaths)
gitUnstage: (root: string, relPaths: string[]) => ipcRenderer.invoke('git-unstage', root, relPaths)
gitCommit: (root: string, message: string, relPaths: string[], amend: boolean) =>
  ipcRenderer.invoke('git-commit', root, message, relPaths, amend)
gitLastCommitMessage: (root: string) => ipcRenderer.invoke('git-last-commit-message', root)
```

Return types in `index.d.ts` keep the `{ success, error?, statuses }` shape;
`gitLastCommitMessage` returns `Promise<string>`.

## Step 5 — hook (`src/renderer/src/hooks/useGitStatus.ts`)

- `stage`/`unstage` take `relPaths: string[]`.
- `commit(root, message, relPaths, amend)` — same alert-on-failure flow,
  returns `boolean`.
- New `commitAndPush(root, message, relPaths, amend)`: run `commit`; if it
  returns true, run the existing `push` (which alerts the push output). Return
  the commit result.
- New `lastCommitMessage(root)` passthrough.
- `fileStates`, `discard`, `push`, `pull`, `diff`, `refresh` — unchanged.
- Export the new functions from the hook's return object.

## Step 6 — panel rewrite (`src/renderer/src/components/GitPanel.tsx`)

This is the main step. Rewrite the component; keep the props-based design
(everything comes in via props from App → Sidebar, no direct `window.api`).

### 6.1 New props

```ts
interface GitPanelProps {
  repos: GitRepoStatus[]
  monacoTheme: string
  onStage: (root: string, relPaths: string[]) => void
  onUnstage: (root: string, relPaths: string[]) => void
  onDiscard: (root: string, entry: GitFileEntry) => void
  onCommit: (root, message, relPaths: string[], amend: boolean) => Promise<boolean>
  onCommitAndPush: (root, message, relPaths: string[], amend: boolean) => Promise<boolean>
  onPush: (root: string) => void
  onPull: (root: string) => void
  onDiff: (root: string, relPath: string) => Promise<{ original: string; modified: string }>
  onLastCommitMessage: (root: string) => Promise<string>
}
```

### 6.2 Merged change model (pure function, derived every render)

Merge `repo.staged` + `repo.unstaged` into one list keyed by `relPath`:

```ts
interface MergedEntry {
  relPath: string
  path: string        // abs path (from either entry)
  state: GitFileState // display state, see rule below
  checked: boolean    // true ⇔ a staged entry exists for this relPath
  added?: number      // sum of staged+unstaged stats when both present
  removed?: number
  discardEntry: GitFileEntry // the entry to pass to onDiscard (prefer the unstaged one)
}
```

Display-state rule: if the staged entry's state is `'added'` or `'renamed'`,
use it (a new file edited after staging is still "A" to the user); otherwise
use the unstaged entry's state when present, else the staged one.

Split the merged list into two groups:

- **Changes** — every entry whose state ≠ `'untracked'`.
- **Unversioned Files** — entries with state `'untracked'` (these are never
  staged by definition of `git status`, so they render unchecked).

Sort each group by `relPath`. Empty groups are not rendered; when both are
empty render the existing "No changes." placeholder (commit area hidden too).

### 6.3 Behavior

- **Row checkbox toggle:** checked → `onUnstage(root, [relPath])`; unchecked →
  `onStage(root, [relPath])`. No optimistic local state — the IPC response
  refreshes `repos` and the checkbox re-derives. Checking an untracked file
  stages it, so on the next status it moves from Unversioned to Changes as
  "A" — that is the intended IDEA-like "Add to VCS" behavior.
- **Changes group checkbox:** checked when all Changes entries are checked,
  `indeterminate` (set via ref) when some are. Toggle stages/unstages all
  Changes entries in one call (`onStage(root, allUncheckedRelPaths)` /
  `onUnstage(root, allCheckedRelPaths)`). Unversioned group has a header with
  a count but no group checkbox.
- **Row click** (outside the checkbox/discard button): open the diff modal —
  same `openDiff` + `Modal` + `DiffEditor` code as today, keep it.
- **Hover discard:** the RotateCcw button, `title` = "Delete" for untracked
  else "Discard changes", calls `onDiscard(root, mergedEntry.discardEntry)`.
  The old +/− hover buttons are gone (checkbox replaces them).
- **Branch row:** `⎇ {branch}` then, when non-zero, `↑{ahead}` and `↓{behind}`
  in `text-gray-500 text-[10px]`; pull/push icon buttons stay on the right.
- **Commit area** (pinned to panel bottom, see Step 7 for the layout change):
  - textarea, 3 rows, per-root message state (keep the existing
    `messages: Record<string, string>` pattern).
  - `Cmd/Ctrl+Enter` inside the textarea triggers Commit
    (`(e.metaKey || e.ctrlKey) && e.key === 'Enter'`).
  - **Amend** checkbox, per-root state. When toggled ON and the message box is
    empty, prefill it with `await onLastCommitMessage(root)`.
  - Buttons: `[Commit]` (primary blue, like the current one) and
    `[Commit & Push]` (secondary: border style). Both disabled while a commit
    is in flight, or when the message is blank, or when zero files are checked
    **and** Amend is off. On success clear the message and reset Amend.
  - `checkedRelPaths` passed to commit = all merged entries with
    `checked === true` across both groups.

### 6.4 Row rendering

Reuse the palette table from "Target UI" as a `Record<GitFileState, …>` const
(letter + color class). Filename = `relPath.split('/').pop()`; parent dir =
the remainder (may be empty), rendered `text-gray-600 text-[10px] truncate`.
Filename gets the status color and, for `deleted`, `line-through`. Keep the
`+N/−N` counters (green/red, `text-[10px] font-mono`) hidden on hover when
the discard button shows, matching the current `group-hover` pattern.

## Step 7 — sidebar layout (`src/renderer/src/components/Sidebar.tsx`)

The commit area must be pinned to the bottom, so GitPanel needs to own its
scrolling. Today Sidebar wraps everything in one scrollable div
(`flex-1 overflow-y-auto … p-2 pt-3`).

Change: when `sidebarView === 'git' && gitRepos.length > 0`, render GitPanel
inside `<div className="flex-1 flex flex-col min-h-0 p-2 pt-3">` (no
overflow-y) instead of the scrollable wrapper; the file-tree branch keeps the
current scrollable div. Inside GitPanel, the root becomes
`flex flex-col h-full min-h-0`; the chips + branch row are `shrink-0`, the
groups live in `flex-1 overflow-y-auto min-h-0`, and the commit area is a
`shrink-0` block with `border-t border-fleet-border pt-2`.

Also update Sidebar's prop types/threading for the changed signatures
(`onGitStage`/`onGitUnstage` take arrays; add `onGitCommitAndPush`,
`onGitLastCommitMessage`).

## Step 8 — App wiring (`src/renderer/src/App.tsx`, ~lines 863–885)

Thread the new/changed hook members into Sidebar:
`onGitStage={git.stage}`, `onGitUnstage={git.unstage}` (signatures already
match after Step 5), `onGitCommit={git.commit}`,
`onGitCommitAndPush={git.commitAndPush}`,
`onGitLastCommitMessage={git.lastCommitMessage}`. Nothing else in App changes
(the title-bar branch label at lines 499–503 keeps using `repo.branch`).

## Step 9 — file tree color alignment (`src/renderer/src/components/FileTree.tsx`)

Align `GIT_BADGE` (lines 26–33) with the panel palette so the same file has
the same color everywhere:

```ts
staged:    { label: '●', className: 'text-blue-400' }   // unchanged
modified:  { label: 'M', className: 'text-blue-400' }   // was amber
renamed:   { label: 'R', className: 'text-blue-400' }   // was amber
added:     { label: 'A', className: 'text-green-500' }  // unchanged
untracked: { label: 'U', className: 'text-red-400' }    // was green
deleted:   { label: 'D', className: 'text-gray-500' }   // was red
```

## Edge cases (must handle)

- **Partially staged file** (appears in both `staged` and `unstaged`): one
  merged row, checked; stats are the sum; commit re-adds it so the whole
  working-tree state is committed (documented IDEA-like behavior).
- **No upstream / `[gone]`:** ahead/behind are 0 → no arrows rendered.
- **Deleted tracked file:** checkbox works (`git add` stages the deletion);
  diff modal shows original vs empty (existing `getDiff` already tolerates a
  missing worktree file).
- **Empty repo (no commits yet):** `lastCommitMessage` returns `''`; amend
  commit will fail — surface git's error via the existing `alertDialog`, do
  not special-case.
- **Commit in flight:** disable both buttons (simple `busy` state) so a slow
  hook can't double-commit.

## Verification

1. `npm run typecheck` and `npm run lint` pass.
2. Manual, via `npm run dev` in a repo with mixed changes (modified + new +
   deleted + partially staged file):
   - checkbox toggles move files between staged/unstaged (`git status` in a
     terminal confirms); group checkbox + indeterminate state work;
   - untracked file renders red under "Unversioned Files", unchecked; checking
     it moves it to Changes as green "A";
   - commit with a subset checked commits exactly those paths, including
     unstaged-on-top edits of a checked file (`git show --stat` confirms);
   - Commit & Push commits then shows the push output dialog;
   - Amend ON prefills the last message and `git log` shows one amended commit;
   - Cmd+Enter commits; message clears on success;
   - branch row shows `↑/↓` matching `git status -sb`;
   - commit area stays pinned while the file list scrolls (50+ changed files);
   - row click still opens the diff modal; hover discard still works for both
     tracked (confirm dialog → checkout) and untracked (trash) files;
   - with 2 workspace roots both being repos, the chips switcher still works.
