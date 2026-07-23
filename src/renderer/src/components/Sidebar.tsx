import React from 'react'
import { Files, FolderOpen, GitBranch, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { FileTree, type FileNode, type RevealRequest } from './FileTree'
import { GitPanel } from './GitPanel'
import { getFileIcon } from '../lib/fileIcon'
import { findRepoForRoot } from '../lib/repoForRoot'
import type { useGitStatus } from '../hooks/useGitStatus'

interface SidebarProps {
  monacoTheme: string
  rowPadding: string
  sidebarView: 'files' | 'git'
  setSidebarView: (view: 'files' | 'git') => void
  // File tree
  rootNodes: FileNode[]
  onAddFolder: () => void
  // Enabled built-in extensions that open as tabs (see lib/extensions.ts).
  // The section is hidden when this is empty.
  extensions: { id: string; icon: LucideIcon; label: string }[]
  activeExtensionId: string | null
  onOpenExtension: (id: string) => void
  recentExternalFiles: string[]
  onRemoveRecentExternalFile: (path: string) => void
  selectedPath: string | null
  revealRequest: RevealRequest | null
  onSelect: (path: string) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  onCreateNew: (node: FileNode, type: 'file' | 'directory') => void
  onMove: (sourcePath: string, targetDirPath: string) => void
  onFocusNode: (node: FileNode) => void
  onRunPython: (node: FileNode) => void
  onPreviewMarkdown: (node: FileNode) => void
  // Git: the whole hook is passed down rather than a dozen callbacks - the
  // panel is the hook's only consumer besides the tree badges.
  git: ReturnType<typeof useGitStatus>
  gitPanelRoot: string | null
  onSelectGitRoot: (root: string) => void
  // Receives the workspace root's path; App resolves it to the repo root.
  onOpenGit: (rootPath: string) => void
  isPathShared?: (path: string) => boolean
  onOpenShare?: (path: string) => void
}

// The sidebar's own content (the outer w-64/border chrome stays in App.tsx,
// since it also needs a plain ref for tree-focus detection). Switches between
// the file tree and the git panel; the switcher itself only shows up once a
// git repo is actually open, so non-git workspaces look exactly as before.
export const Sidebar: React.FC<SidebarProps> = ({
  monacoTheme,
  rowPadding,
  sidebarView,
  setSidebarView,
  rootNodes,
  onAddFolder,
  extensions,
  activeExtensionId,
  onOpenExtension,
  recentExternalFiles,
  onRemoveRecentExternalFile,
  selectedPath,
  revealRequest,
  onSelect,
  onContextMenu,
  onCreateNew,
  onMove,
  onFocusNode,
  onRunPython,
  onPreviewMarkdown,
  git,
  gitPanelRoot,
  onSelectGitRoot,
  onOpenGit,
  isPathShared,
  onOpenShare
}) => {
  return (
    <>
      {git.repos.length > 0 && (
        <div className="px-2 pt-2 shrink-0">
          <div className="flex gap-0.5 bg-fleet-bg rounded-md p-0.5 text-xs">
            <button
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 py-1 rounded transition-colors',
                sidebarView === 'files'
                  ? 'bg-fleet-active text-fleet-textHover'
                  : 'text-gray-400 hover:text-gray-200'
              )}
              onClick={() => setSidebarView('files')}
            >
              <Files size={12} /> Files
            </button>
            <button
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 py-1 rounded transition-colors',
                sidebarView === 'git'
                  ? 'bg-fleet-active text-fleet-textHover'
                  : 'text-gray-400 hover:text-gray-200'
              )}
              onClick={() => setSidebarView('git')}
            >
              <GitBranch size={12} /> Git
            </button>
          </div>
        </div>
      )}
      {sidebarView === 'git' && git.repos.length > 0 ? (
        <div className="flex-1 flex flex-col min-h-0 p-2 pt-3">
          <GitPanel
            git={git}
            monacoTheme={monacoTheme}
            selectedRoot={gitPanelRoot}
            onSelectRoot={onSelectGitRoot}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar p-2 pt-3">
          <div>
            <div className="flex items-center justify-between mb-1 px-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">Workspaces</span>
              <button
                className="p-0.5 rounded text-gray-400 hover:text-white hover:bg-fleet-border"
                title="Open Folder"
                onClick={onAddFolder}
              >
                <FolderOpen size={13} />
              </button>
            </div>
            {rootNodes.length > 0 ? (
              <div className="flex flex-col gap-2">
                {rootNodes.map((rootNode) => {
                  const repo = findRepoForRoot(git.repos, rootNode.path)
                  return (
                    <FileTree
                      key={rootNode.path}
                      node={rootNode}
                      onSelect={onSelect}
                      onContextMenu={onContextMenu}
                      onCreateNew={onCreateNew}
                      onMove={onMove}
                      onFocusNode={onFocusNode}
                      onRunPython={onRunPython}
                      onPreviewMarkdown={onPreviewMarkdown}
                      selectedPath={selectedPath}
                      revealRequest={revealRequest}
                      rowPadding={rowPadding}
                      gitStatus={git.fileStates}
                      rootBranch={repo?.branch}
                      onOpenGit={repo ? onOpenGit : undefined}
                      isPathShared={isPathShared}
                      onOpenShare={onOpenShare}
                    />
                  )
                })}
              </div>
            ) : (
              <div className="px-2 text-xs text-gray-500">No folder opened.</div>
            )}
          </div>

          {extensions.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 px-2">
                Extensions
              </div>
              {extensions.map((ext) => (
                <div
                  key={ext.id}
                  className={clsx(
                    'group flex items-center px-2 cursor-pointer leading-normal hover:bg-fleet-active text-fleet-text hover:text-fleet-textHover transition-colors',
                    rowPadding,
                    activeExtensionId === ext.id && 'bg-fleet-active text-fleet-textHover'
                  )}
                  title={ext.label}
                  onClick={() => onOpenExtension(ext.id)}
                >
                  <span className="mr-1.5 opacity-70 flex items-center justify-center w-4 h-4">
                    <ext.icon size={14} />
                  </span>
                  <span className="truncate flex-1">{ext.label}</span>
                </div>
              ))}
            </div>
          )}

          {recentExternalFiles.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 px-2">
                Recently Opened (Outside)
              </div>
              {recentExternalFiles.map((path) => (
                <div
                  key={path}
                  className={clsx(
                    'group flex items-center px-2 cursor-pointer leading-normal hover:bg-fleet-active text-fleet-text hover:text-fleet-textHover transition-colors',
                    rowPadding,
                    selectedPath === path && 'bg-fleet-active text-fleet-textHover'
                  )}
                  title={path}
                  onClick={() => onSelect(path)}
                >
                  <span className="mr-1.5 opacity-70 flex items-center justify-center w-4 h-4">
                    {getFileIcon(path.split('/').pop() || path, 'file', false)}
                  </span>
                  <span className="truncate flex-1">{path.split('/').pop()}</span>
                  <button
                    className="hidden group-hover:block ml-1 p-0.5 rounded hover:bg-fleet-border text-gray-400 hover:text-white shrink-0"
                    title="Remove from list"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveRecentExternalFile(path)
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
