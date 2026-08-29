import type { MenuAction } from '../../../shared/menuAction'
import { isFormattablePath, isPreviewablePath } from './fileType'

// The command palette's registry. Almost everything the app can do already
// exists as a MenuAction (src/main/menu.ts owns the accelerators), so the
// palette is a list *over* that registry rather than a second set of
// handlers: each entry names the action to send and how to label it. App
// supplies the handlers it already passes to useMenuActions, plus the extras
// that have no menu entry at all.

export interface Command {
  id: string
  label: string
  // Shown dimmed on the left; also searched, so "git" finds "Toggle Git Panel".
  group: string
  // Accelerator in the neutral form ("Mod+Shift+A"), rendered per platform.
  accelerator?: string
  run: () => void
}

// What decides whether a command is worth offering at all. A palette that
// lists "Format Document" for a .txt file is noise, so unavailable commands
// are left out rather than greyed.
export interface CommandEnv {
  activePath: string | null
  canDictate: boolean
  canReadAloud: boolean
  translateEnabled: boolean
}

interface MenuCommand {
  action: MenuAction
  label: string
  group: string
  accelerator?: string
  when?: (env: CommandEnv) => boolean
}

const hasFile = (env: CommandEnv): boolean => !!env.activePath

const MENU_COMMANDS: MenuCommand[] = [
  { action: 'open-folder', label: 'Open Folder…', group: 'File' },
  { action: 'save', label: 'Save', group: 'File', accelerator: 'Mod+S', when: hasFile },
  { action: 'close-tab', label: 'Close Tab', group: 'File', accelerator: 'Mod+W', when: hasFile },
  { action: 'reopen-tab', label: 'Reopen Closed Tab', group: 'File', accelerator: 'Mod+Shift+T' },
  {
    action: 'detach-tab',
    label: 'Move Tab to New Window',
    group: 'File',
    accelerator: 'Mod+Shift+D',
    when: hasFile
  },
  { action: 'go-to-file', label: 'Go to File…', group: 'Go', accelerator: 'Shift Shift' },
  { action: 'go-to-line', label: 'Go to Line…', group: 'Go', accelerator: 'Mod+L', when: hasFile },
  {
    action: 'go-to-symbol',
    label: 'File Structure…',
    group: 'Go',
    accelerator: 'Mod+F12',
    when: hasFile
  },
  { action: 'find-in-files', label: 'Find in Files', group: 'Go', accelerator: 'Mod+Shift+F' },
  {
    action: 'replace-in-files',
    label: 'Replace in Files',
    group: 'Go',
    accelerator: 'Mod+Shift+R'
  },
  {
    action: 'format-document',
    label: 'Format Document',
    group: 'Edit',
    accelerator: 'Alt+Mod+L',
    when: (env) => isFormattablePath(env.activePath)
  },
  {
    action: 'toggle-dictation',
    label: 'Start/Stop Dictation',
    group: 'Edit',
    accelerator: 'Mod+D',
    when: (env) => env.canDictate
  },
  {
    action: 'translate-selection',
    label: 'Translate Selection',
    group: 'Edit',
    accelerator: 'Alt+Mod+T',
    when: (env) => env.translateEnabled && hasFile(env)
  },
  {
    action: 'run-http-request',
    label: 'Run HTTP Request',
    group: 'Run',
    accelerator: 'Mod+Enter',
    when: hasFile
  },
  { action: 'toggle-sidebar', label: 'Toggle Sidebar', group: 'View', accelerator: 'Mod+B' },
  { action: 'toggle-git-panel', label: 'Toggle Git Panel', group: 'View', accelerator: 'Mod+K' },
  {
    action: 'toggle-preview',
    label: 'Toggle Preview',
    group: 'View',
    accelerator: 'Mod+Shift+P',
    when: (env) => isPreviewablePath(env.activePath)
  },
  { action: 'toggle-terminal', label: 'Toggle Terminal', group: 'View', accelerator: 'Ctrl+`' },
  { action: 'preferences', label: 'Preferences…', group: 'View', accelerator: 'Mod+,' }
]

export function buildCommands(
  actions: Record<MenuAction, () => void>,
  env: CommandEnv,
  extras: Command[]
): Command[] {
  const fromMenu = MENU_COMMANDS.filter((entry) => !entry.when || entry.when(env)).map((entry) => ({
    id: entry.action,
    label: entry.label,
    group: entry.group,
    accelerator: entry.accelerator,
    run: () => actions[entry.action]?.()
  }))
  return [...fromMenu, ...extras]
}

// "Mod+Shift+A" as the platform writes it. Mac gets the symbols the native
// menu shows next to the very same command, so the palette and the menu can't
// disagree about what a key is called.
export function formatAccelerator(accelerator: string, platform: string): string {
  const mac = platform === 'darwin'
  const parts = accelerator.split('+').map((part) => {
    if (part === 'Mod') return mac ? '⌘' : 'Ctrl'
    if (part === 'Alt') return mac ? '⌥' : 'Alt'
    if (part === 'Shift') return mac ? '⇧' : 'Shift'
    if (part === 'Ctrl') return mac ? '⌃' : 'Ctrl'
    if (part === 'Enter') return mac ? '⏎' : 'Enter'
    return part
  })
  return mac ? parts.join('') : parts.join('+')
}
