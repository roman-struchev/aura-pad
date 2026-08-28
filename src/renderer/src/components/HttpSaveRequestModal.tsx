import React, { useMemo, useState } from 'react'
import clsx from 'clsx'
import { FileText, FolderPlus } from 'lucide-react'
import { Modal } from './Modal'
import { relativeToRoot } from '../lib/path'
import type { FileNode } from '../../../shared/fileNode'

interface HttpSaveRequestModalProps {
  // The workspace trees, already gitignore-filtered by main. Both lists below
  // come out of them, so no directory the file tree doesn't show can be
  // picked here either.
  rootNodes: FileNode[]
  // The `### heading` the request is filed under, prefilled from the request
  // itself and editable - "POST /orders" says less than "create an order".
  defaultName: string
  onCancel: () => void
  onSave: (filePath: string, name: string) => void
}

const REQUEST_FILE = /\.(http|rest)$/i

// Everything of one kind in the trees, depth-first, so both lists read in the
// order the file tree shows them.
function collect(nodes: FileNode[], want: 'file' | 'directory', out: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.type === want && (want === 'directory' || REQUEST_FILE.test(node.name))) out.push(node)
    if (node.children) collect(node.children, want, out)
  }
  return out
}

// Where a request from the HTTP Client form should land. A .http file is a
// list of requests, and a project accumulates several of them - one per API,
// per service, per feature - so this asks which one rather than appending
// everything to a single requests.http at the top of the repository.
//
// The other half is that the file often doesn't exist yet: picking a folder
// and naming it here saves a trip to the file tree, and a name with slashes
// in it makes the folders it needs on the way.
export const HttpSaveRequestModal: React.FC<HttpSaveRequestModalProps> = ({
  rootNodes,
  defaultName,
  onCancel,
  onSave
}) => {
  const rootPaths = useMemo(() => rootNodes.map((r) => r.path), [rootNodes])
  const files = useMemo(() => collect(rootNodes, 'file'), [rootNodes])
  // The roots first (where a requests.http usually goes), then everything
  // under them. A root is a directory too, hence the dedupe.
  const folders = useMemo(
    () => [...new Set([...rootNodes, ...collect(rootNodes, 'directory')].map((n) => n.path))],
    [rootNodes]
  )

  const [name, setName] = useState(defaultName)
  const [filter, setFilter] = useState('')
  // Empty means "the new file below": there is always exactly one target, and
  // which one it is has to be visible at a glance rather than inferred from
  // which field was touched last.
  const [selected, setSelected] = useState(files[0]?.path ?? '')
  const [folder, setFolder] = useState(rootPaths[0] ?? '')
  const [newName, setNewName] = useState('requests.http')

  const shown = filter.trim()
    ? files.filter((f) =>
        relativeToRoot(f.path, rootPaths).toLowerCase().includes(filter.trim().toLowerCase())
      )
    : files

  // A name is a file name, not an extension quiz: anything that isn't already
  // a request file becomes one.
  const withExtension = (value: string): string =>
    REQUEST_FILE.test(value) ? value : `${value.replace(/\/+$/, '')}.http`

  const typed = newName.trim()
  const target = selected || (folder && typed ? `${folder}/${withExtension(typed)}` : '')

  const save = (): void => {
    if (!target) return
    onSave(target, name.trim() || defaultName)
  }

  return (
    <Modal title="Save Request" onClose={onCancel} width="w-[34rem]">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Request name"
            data-autofocus
            spellCheck={false}
            className="bg-fleet-sidebar border border-fleet-border rounded px-2 py-1 text-xs text-fleet-text outline-none focus:border-blue-500"
          />
          <span className="text-[10px] text-gray-500">
            The <span className="font-mono">### heading</span> the request is filed under.
          </span>
        </label>

        {files.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 flex-1">
                Add to an existing request file
              </span>
              {files.length > 6 && (
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter"
                  aria-label="Filter request files"
                  spellCheck={false}
                  className="w-40 bg-fleet-sidebar border border-fleet-border rounded px-2 py-1 text-[11px] text-fleet-text outline-none focus:border-blue-500"
                />
              )}
            </div>
            <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5 border border-fleet-border rounded p-1">
              {shown.length === 0 && (
                <div className="text-[11px] text-gray-500 px-1 py-0.5">Nothing matches.</div>
              )}
              {shown.map((file) => (
                <button
                  key={file.path}
                  onClick={() => setSelected(file.path)}
                  title={file.path}
                  data-http-target={file.path}
                  className={clsx(
                    'flex items-center gap-1.5 text-left text-[11px] font-mono px-1.5 py-1 rounded truncate',
                    selected === file.path
                      ? 'bg-fleet-active text-fleet-textHover'
                      : 'text-fleet-text hover:bg-fleet-active hover:text-fleet-textHover'
                  )}
                >
                  <FileText size={12} className="shrink-0 opacity-70" />
                  <span className="truncate">{relativeToRoot(file.path, rootPaths)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">
            {files.length > 0 ? 'Or make a new one' : 'Make a request file'}
          </span>
          <div className="flex items-center gap-2">
            <select
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value)
                setSelected('')
              }}
              aria-label="Folder"
              className="flex-1 min-w-0 bg-fleet-sidebar border border-fleet-border rounded px-2 py-1 text-[11px] text-fleet-text outline-none focus:border-blue-500"
            >
              {folders.length === 0 && <option value="">No open folder</option>}
              {folders.map((path) => (
                <option key={path} value={path}>
                  {relativeToRoot(path, rootPaths)}
                </option>
              ))}
            </select>
            <span className="text-gray-500 text-[11px]">/</span>
            <input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                setSelected('')
              }}
              onFocus={() => setSelected('')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
              }}
              placeholder="requests.http"
              aria-label="New request file"
              spellCheck={false}
              className="w-52 bg-fleet-sidebar border border-fleet-border rounded px-2 py-1 text-[11px] font-mono text-fleet-text outline-none focus:border-blue-500"
            />
          </div>
          <span className="text-[10px] text-gray-500 flex items-center gap-1">
            <FolderPlus size={11} className="opacity-70" />
            Slashes make folders: <span className="font-mono">api/orders.http</span>
          </span>
        </div>

        <div className="text-[11px] text-gray-500 truncate" title={target}>
          {target ? (
            <>
              Saving to <span className="font-mono text-fleet-text">{target}</span>
            </>
          ) : (
            'Pick a file, or name a new one.'
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded text-fleet-text hover:bg-fleet-active"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!target}
            className={clsx(
              'px-3 py-1.5 text-xs rounded font-medium',
              target
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'bg-fleet-active text-gray-500 cursor-not-allowed'
            )}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
