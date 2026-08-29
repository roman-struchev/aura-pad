import { Menu } from 'electron'
import type { MenuAction } from '../shared/menuAction'

const APP_NAME = 'AuraPad'

// Custom menu without a "Close Window" accelerator, so Cmd/Ctrl+W is free
// for the renderer to use for closing the active file instead of the window.
// Every command below owns its accelerator here (not in the renderer's own
// keydown handler) so a key press only ever triggers one handler - except the
// three marked `registerAccelerator: false`, which only *display* their key
// here and let the renderer handle it (see the note on Find Action…).
export function buildAppMenu(sendAction: (action: MenuAction) => void): Menu {
  const isMac = process.platform === 'darwin'

  const preferencesItem: Electron.MenuItemConstructorOptions = {
    label: 'Preferences…',
    accelerator: 'CmdOrCtrl+,',
    click: () => sendAction('preferences')
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              preferencesItem,
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } as Electron.MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          click: () => sendAction('open-folder')
        },
        { type: 'separator' },
        {
          // The keyboard half of dragging a tab out of the strip. In a
          // torn-off window the same command sends the tab back.
          label: 'Move Tab to New Window',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => sendAction('detach-tab')
        },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendAction('save') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendAction('close-tab') },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => sendAction('reopen-tab')
        },
        ...(!isMac
          ? [{ type: 'separator' } as Electron.MenuItemConstructorOptions, preferencesItem]
          : [])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Start/Stop Dictation',
          accelerator: 'CmdOrCtrl+D',
          click: () => sendAction('toggle-dictation')
        },
        {
          // Alt+Cmd+T is unbound in Monaco, so no unbind in monaco-setup.ts
          // (unlike Cmd+D). On some Linux desktops Ctrl+Alt+T is the OS
          // "open terminal" shortcut and may shadow this; the editor's
          // right-click menu still has the action there.
          label: 'Translate Selection',
          accelerator: 'Alt+CmdOrCtrl+T',
          click: () => sendAction('translate-selection')
        },
        {
          label: 'Format Document',
          accelerator: 'Alt+CmdOrCtrl+L',
          click: () => sendAction('format-document')
        },
        { type: 'separator' },
        {
          // The same Cmd+Enter is also a Monaco action (App's editor mount),
          // which is what actually fires while the editor has focus - this
          // entry covers every other focus state and makes the feature
          // discoverable at all.
          label: 'Run HTTP Request',
          accelerator: 'CmdOrCtrl+Return',
          click: () => sendAction('run-http-request')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          // The three below carry `registerAccelerator: false`: the key is
          // shown here for discoverability but handled in the renderer
          // (useGlobalHotkeys), like double-Shift quick open. Cmd+L in
          // particular has to be a renderer key - the terminal panel needs
          // Ctrl+L to keep reaching the shell.
          label: 'Find Action…',
          accelerator: 'CmdOrCtrl+Shift+A',
          registerAccelerator: false,
          click: () => sendAction('command-palette')
        },
        { type: 'separator' },
        { label: 'Go to File…', click: () => sendAction('go-to-file') },
        {
          label: 'Go to Line…',
          accelerator: 'CmdOrCtrl+L',
          registerAccelerator: false,
          click: () => sendAction('go-to-line')
        },
        {
          // IDEA's File Structure key.
          label: 'File Structure…',
          accelerator: 'CmdOrCtrl+F12',
          registerAccelerator: false,
          click: () => sendAction('go-to-symbol')
        },
        {
          label: 'Find in Files',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => sendAction('find-in-files')
        },
        {
          // The IDEA key for "Replace in Path" - the same overlay as Find in
          // Files, opened with its replace row already showing.
          label: 'Replace in Files',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => sendAction('replace-in-files')
        },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendAction('toggle-sidebar')
        },
        {
          // Also the terminal's "clear" key: with focus inside the terminal
          // panel the renderer routes this to clearing that terminal instead
          // (App.tsx), which is where Cmd+K goes in iTerm2 and VS Code.
          label: 'Toggle Git Panel',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendAction('toggle-git-panel')
        },
        {
          label: 'Toggle Preview',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => sendAction('toggle-preview')
        },
        {
          label: 'Toggle Terminal',
          accelerator: 'Ctrl+`',
          click: () => sendAction('toggle-terminal')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac
          ? [
              { role: 'zoom' } as Electron.MenuItemConstructorOptions,
              { type: 'separator' } as Electron.MenuItemConstructorOptions,
              { role: 'front' } as Electron.MenuItemConstructorOptions
            ]
          : [])
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
