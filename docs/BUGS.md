# Known bugs and risks

Produced by a code scan of AuraPad v1.42.0 (2026-08-11), with every item below
either **verified live** against a running build (isolated profile, driven over
CDP — see `.claude/skills/verify`) or traced to the exact lines that cause it.
Ordered by severity. Findings that were already fixed while writing this are
marked as such rather than dropped, so the reasoning stays on record.

Most of what's left is concentrated in **the trust boundary around the
renderer**: the app treats its own renderer as fully trusted, and one feature
(HTML preview) deliberately runs untrusted code inside it. The editing path
itself — save, autosave, encoding round-tripping — has been hardened over
several passes and held up here, with one exception found late (finding 8, a
path by which an outside edit can be silently overwritten).

---

## 1. CRITICAL — previewing an `.html` file gives that file full control of the app

**Verified live.** An `.html` file placed in a workspace, opened and previewed,
executed its own `<script>` with complete access to the privileged bridge:

- read any file on the machine (`api.readFile`) — a canary file outside the
  previewed document was read back in full,
- write any file (`api.saveFile`) — created a new file in the workspace,
- **spawn a shell and run commands** (`api.createPty` + `api.ptyWrite`) —
  created `/tmp/aurapad-rce-proof` from inside the previewed page.

All 79 methods of `window.api` were reachable. In other words: cloning a repo,
opening its `index.html` and clicking the eye icon is enough for that repo to
run arbitrary code as the user.

**The chain**

| Link | Where |
|---|---|
| Preview iframe gets `allow-scripts` **and** `allow-same-origin` | `src/renderer/src/components/HtmlPreview.tsx:23` |
| Content is injected as `srcDoc`, so the frame inherits the app's own origin — `parent.api` is one property access away | `HtmlPreview.tsx:24` |
| App-wide CSP is loosened to `script-src 'unsafe-inline' 'unsafe-eval' https:` so previewed scripts run — and so a previewed file may pull a script off **any** https host, which then inherits the same access | `src/renderer/index.html:26` |
| The bridge is exposed on the window the iframe can reach, and has no notion of "which frame is asking" | `src/preload/index.ts:79` |
| No IPC handler validates paths, so "reachable" means the whole filesystem (finding 2) | `src/main/ipcHandlers.ts` |

The tradeoff is documented in `HtmlPreview.tsx` and `index.html` as deliberate
("previews files the user opens themselves, not arbitrary remote content"). The
gap is that _files the user opens_ routinely come from repos, downloads and
colleagues — and the comment frames the risk as "the file's own scripts run",
while the actual exposure is arbitrary code execution outside the sandbox. Note
a preload-side frame check would **not** help: the iframe never gets its own
bridge, it reaches the parent's.

**Fix options, best first**

1. Render the preview in a frame with a **different origin** — drop
   `allow-same-origin` (keep `allow-scripts`), or load the content from a custom
   protocol/`about:blank` document instead of `srcDoc`. `parent.api` then throws
   a cross-origin error. The nested-`document.write` case the current comment
   protects would break; that's the price.
2. Give the preview frame its own CSP (`<meta>` injected into the previewed
   document, or a dedicated `BrowserView`/`webview` with `preload: undefined`
   and `sandbox: true`), and tighten the app's own CSP back to `'self'`.
3. If scripts in previews are worth keeping at full power, gate them: an
   explicit per-file "run scripts in this preview" opt-in, defaulting to a
   script-stripped render.

**Interim mitigation:** previewing is opt-in per file (the eye icon / `⇧⌘P`),
so simply opening an `.html` file is safe today — only previewing it is not.

---

## 2. CRITICAL — no path validation anywhere in the filesystem / pty IPC layer — **FIXED**

`src/main/ipc.ts` passed arguments straight through, and every filesystem
handler acted on whatever absolute path it was handed:

- `read-file`, `save-file` — any file on disk,
- `copy-paths`, `delete-paths`, `move-path`, `rename-path`, `create-path` —
  write/trash anywhere,
- `reveal-in-finder`, and `create-pty` (`src/main/terminals.ts`), which spawns a
  login shell with an arbitrary `cwd`.

On its own this is the normal "the renderer is trusted" posture of a desktop
editor. It stops being defensible in combination with finding 1, and it is what
turns any future renderer-side injection (a Monaco/marked/DOMPurify bypass, a
malicious model file, a compromised npm dependency in the renderer bundle) from
a UI nuisance into total machine compromise.

**Fixed** in `src/main/pathAccess.ts`, applied by every filesystem, git, lint
and pty handler (`ipcHandlers.ts`, `terminals.ts`). A path is acted on only if,
after `realpath`, it sits inside an open workspace, the app's own `userData`,
or something main itself handed out:

| Grant | Where it comes from |
|---|---|
| Workspace roots | `workspaces.json` — added through the native folder dialog |
| `userData` | the app's own state (settings, history, tokens) |
| A file the OS asked us to open | `openFileInApp` (`index.ts`) — double-click, `open -a`, dock drop |
| A file dropped on the window | `webUtils.getPathForFile` in **preload**, which tells main over a channel the page cannot reach (a `File` the page fabricates has no path) |
| Entries of a Quick Open path listing | `list-path-matches` grants the directory and the entries it returns |
| Paths pasted from the OS file clipboard | `clipboard-read-files` |
| The recent-external list | already-granted files, kept across restarts by its own retention policy |

Everything else comes back as `{ success: false, error }` (`create-pty`
rejects, since its contract has no error channel). `realpath` first means a
symlink planted inside a workspace can't smuggle a target from outside it back
in, and git's repo-relative arguments are additionally required to resolve
inside the repo they name, so `../../..` can't walk back out.

`touch-recent-external-file` now ignores paths that aren't already allowed —
otherwise the renderer could write itself a permanent grant.

A path that doesn't exist yet — a file being created, a rename's target, a
request saved into `api/orders.http` before there is an `api/` — is judged by
its nearest ancestor that *does* exist, with the missing tail appended.
`path.resolve` has already collapsed every `..` by then, so the tail can only
go deeper, and the part that exists is still `realpath`ed: a made-up tail
cannot reach a directory its root isn't allowed to reach (A11 checks exactly
that).

**The deliberate limit:** Quick Open's path mode is how a file outside every
workspace gets opened at all, and its listings grant what they return. Injected
script can still walk directories the same way instead of naming a path
outright — a round trip per directory rather than free access. Closing that
would mean removing the feature; what it can no longer do is touch a path
nobody ever listed, or spawn a shell outside the opened folders.

Covered by A11 in the smoke suite (read/write/create/delete/move/pty refusals,
the symlink bypass, and both halves of what must keep working).

---

## 3. HIGH — the update installer pipes an unpinned remote script into bash

```
spawn('/bin/bash', ['-c', `curl -fsSL ${INSTALL_SCRIPT_URL} | bash`], …)
```

`src/main/updater.ts:99`, where `INSTALL_SCRIPT_URL` is
`raw.githubusercontent.com/…/main/scripts/install.sh` (`updater.ts:8`).

Clicking "Install update" fetches whatever is on the **main branch right now**
and executes it as the user. There is no pinning to the release tag, no
checksum, and no signature check on the app bundle the script then installs
(macOS builds aren't notarized, which is why this path exists at all). A repo
compromise, a bad push to `main`, or a stale/poisoned CDN response executes
arbitrary code on every user who updates.

**Fix:** pin the URL to the tag being installed (`.../v1.42.0/scripts/install.sh`),
ship a checksum of the script and of the `.dmg`/`.zip` next to the release and
verify both before executing, and download the script to a temp file and run
that file rather than piping into `bash` (so the fetched bytes are the bytes
verified).

---

## 4. MEDIUM — long-lived credentials are stored unencrypted

| Secret | File |
|---|---|
| Google OAuth **refresh tokens** (full read/write on the user's Tasks, valid until revoked) | `googleTasksAccounts.json` (`src/main/googleTasks.ts:29`, written at `:44`) |
| Work Together **host tokens** (control of a live share session) | `workTogetherSessions.json` (`src/main/workTogetherResumeState.ts:17`) |
| Google OAuth **client secret** | `settings.json` |

All plain JSON, written at default `0644` by `writeConfigFile`
(`src/main/configFile.ts:38`). `electron`'s `safeStorage` is not used anywhere
in the codebase.

Severity is medium rather than high because the containing directory is `0700`
(verified: `~/Library/Application Support/AuraPad` is `drwx------`), so other
_users_ can't read them. Other _processes running as the same user_ can —
including anything the user installs, and any backup/sync tool that walks the
directory.

**Fix:** encrypt the token fields with `safeStorage.encryptString` (Keychain /
DPAPI / libsecret-backed), and write these files with `mode: 0o600`.

---

## 5. MEDIUM — watcher did a synchronous full-file read on every filesystem event — **FIXED**

`handleFsWatchEvent` → `matchesLastSelfWrite()` read and hashed the entire file
with `fs.readFileSync` on the main process's event loop, for every event that
survived the ignore filter. A workspace holding multi-megabyte files that are
rewritten often (or a build writing into a directory `.gitignore` doesn't cover)
stalled the main process in bursts: IPC, menus and window events all queue
behind it.

**Fixed** in `src/main/watcher.ts`: `recordSelfWrite` now also stores the file's
`size` and `mtimeMs` as measured right after our own write, and the event
handler compares those first. An event whose stat still matches can't be
carrying different content, so the read is skipped entirely — which covers both
common cases, our own (auto)save echoing back and the metadata-only touches a
sync daemon emits afterwards. The hash read remains as the fallback whenever
either number moved, so nothing that used to be detected stops being detected.
Same "has this file changed" proxy make/rsync/git's stat cache use; a writer
that changes content while restoring both the original size *and* mtime would
slip through, which normal tooling doesn't do.

Verified live: our own save, an `xattr`-only touch, and an external rewrite with
byte-identical content all stay silent, while a real external edit is still
broadcast.

The `fs.realpathSync` per event (`selfWriteKey`) was left as is: it costs a few
lstat calls against the file read's megabytes, and every cheap way to cache it
risks a stale entry, which would resurrect the false "changed on disk" banners
this module exists to prevent.

---

## 6. LOW — the OAuth loopback flow has no `state` parameter

`waitForAuthCode` (`src/main/googleTasks.ts:95`) resolves on the first request
carrying a `code` query parameter, whatever its origin. During the 5-minute
window the loopback port is open, any local process — or any web page the user
has open, via a plain `<img>`/`fetch` to `127.0.0.1:<port>` — can deliver a code
of its choosing.

PKCE saves it in practice: an injected code was minted against the attacker's
own verifier, so the token exchange fails and the sign-in ends in an error
rather than in the user's account being linked to someone else's. The
consequence is a confusing failed sign-in, not account takeover — but `state` is
the standard defense and costs one comparison.

**Fix:** generate a random `state`, pass it in the auth URL, and reject a
callback whose `state` doesn't match.

---

## 7. LOW — a missing `expires_in` makes every Tasks API call refresh the token

`getAccessToken` computes `expiresAt = Date.now() + (Number(tokens.expires_in || 0) - 60) * 1000`
(`src/main/googleTasks.ts:252`). If the token response omits `expires_in`, the
cached token is born already expired, so every subsequent API call performs a
full refresh round-trip — extra latency and an easy way into Google's rate
limits.

**Fix:** fall back to a sane default (`3600`) when the field is absent.

---

## 8. HIGH — an external edit to a file AuraPad itself saved is never reported — **FIXED**

Listed out of severity order because it was found later — while verifying the
fix for finding 5, not during the original pass.

**Verified live, deterministic.** Save a file through the app, then modify it
from outside (another editor, `git checkout`, a sync daemon): the recursive
`fs.watch` delivers that outside modification as a **`'rename'`** event rather
than `'change'`. The rename branch (`src/main/watcher.ts`, the block after the
`'change'` early return) only schedules a debounced tree rebuild — it never
broadcasts `file-changed-externally`. Measured over 6 rounds of
save-then-externally-modify: 6/6 produced exactly one structural event and zero
external-change events. The same run against the pre-finding-5 code behaves
identically, so this predates that fix.

The cause is a macOS FSEvents property: its flags are per-path and coalesced, so
once our own save (temp-file + `rename`, see `writeFileContent`) has marked the
path as renamed, later events for it keep carrying that flag, and Node maps them
to `'rename'`.

**Impact — silent loss of the outside edit.** The tab keeps showing its stale
buffer with no "This file changed on disk" banner. Nothing else catches it:
`saveAllDirtyFileTabs` only skips tabs whose `externalChangeAvailable` is set,
and it never got set. So as soon as the user types one character in that tab,
autosave writes the stale content back over the external change — and the
watcher then suppresses that write as a self-write, so it happens without a
trace. This is the exact scenario the branch-switch guard in `useTabs.ts` was
written to prevent, reached by a different route.

**The fix** (`src/main/watcher.ts`) stops keying the decision on the event type
alone. The `'rename'` branch runs the same suppression checks it always did —
the grace window, then the stat/hash comparison against what we last wrote —
and anything that survives them *and is still a file* is now broadcast as
`file-changed-externally` alongside the debounced tree rebuild. Getting that far
already means the content is not what this app put there, whatever the event was
called. The same path covers editors that save atomically themselves (vim, VS
Code), whose writes reach us as `'rename'` even for files AuraPad never touched.

One thing had to change with it: after telling the renderer about a change, the
watcher now **records the content it reported** under the same key self-writes
use, instead of dropping the record. One outside save arrives as several events
(macOS delivers a `'rename'` and a `'change'` for an atomic write), and the
repeat used to be broadcast again — landing on a tab the user had meanwhile
started typing in, flagging it as changed on disk when nothing had, and, because
`saveAllDirtyFileTabs` skips such tabs, stranding that typing in the buffer. A
later change *away* from the reported content still differs from the record, so
it is still reported.

Belt and braces: local history (`src/main/localHistory.ts`) stores what each
write replaced, so even a clobber that slipped through is recoverable from the
tab's Local History.

Covered by smoke A2, which saves a file through the app, edits it from outside,
and watches the Markdown preview (ordinary React DOM, unlike Monaco's) pick the
outside edit up.

---

## Fixed while writing this document

**The tree's clipboard accepted relative paths from clipboard text.**
`readFilesFromClipboard`'s plain-text fallback checked candidates with
`fs.existsSync` without requiring them to be absolute
(`src/main/clipboardFiles.ts`), so a relative path copied as ordinary text — a
line like `src/main/index.ts` out of a README or a terminal — was resolved
against the **main process's** working directory. Verified live: copying that
exact string made `readClipboardFiles()` return it as a file, so `⌘V` in the
tree would have copied an unrelated file into the user's workspace. Now
`path.isAbsolute` is required.

---

## What was checked and found sound

So the next scan doesn't re-tread it: save/autosave ordering and the
"buffer changed while the write was in flight" guards (`useTabs.ts`), the
external-change reload path, encoding detection and round-tripping including
the map-eviction fallback (`encoding.ts`), atomic writes with symlink and
permission preservation (`workspaces.ts`, `configFile.ts`), overwrite guards on
rename/move/copy, the dialog queue (no promise can be left unresolved), Monaco
model disposal on close/rename/delete, worker lifecycle and idle unload
(`useModelWorker.ts`), Markdown preview sanitization (DOMPurify), git and lint
subprocess arguments (`execFile` with argv arrays, no shell), terminal command
quoting (`shellQuote.ts`), and `openExternal` protocol allowlisting.
