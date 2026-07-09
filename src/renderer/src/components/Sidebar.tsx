import React from 'react'
import { Files, GitBranch } from 'lucide-react'
import clsx from 'clsx'
import { FileTree, type FileNode } from './FileTree'
import { GitPanel } from './GitPanel'
import type { GitFileEntry, GitFileState, GitRepoStatus } from '../../../shared/gitStatus'

interface SidebarProps {
  isDark: boolean
  rowPadding: string
  sidebarView: 'files' | 'git'
  setSidebarView: (view: 'files' | 'git') => void
  // File tree
  rootNodes: FileNode[]
  selectedPath: string | null
  revealPath: string | null
  onSelect: (path: string) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  onCreateNew: (node: FileNode, type: 'file' | 'directory') => void
  onMove: (sourcePath: string, targetDirPath: string) => void
  onFocusNode: (node: FileNode) => void
  onRunPython: (node: FileNode) => void
  onPreviewMarkdown: (node: FileNode) => void
  gitFileStates: Record<string, GitFileState>
  // Git panel
  gitRepos: GitRepoStatus[]
  onGitStage: (root: string, relPath: string) => void
  onGitUnstage: (root: string, relPath: string) => void
  onGitDiscard: (root: string, entry: GitFileEntry) => void
  onGitCommit: (root: string, message: string) => Promise<boolean>
  onGitPush: (root: string) => void
  onGitPull: (root: string) => void
  onGitDiff: (root: string, relPath: string) => Promise<{ original: string; modified: string }>
}

// The sidebar's own content (the outer w-64/border chrome stays in App.tsx,
// since it also needs a plain ref for tree-focus detection). Switches between
// the file tree and the git panel; the switcher itself only shows up once a
// git repo is actually open, so non-git workspaces look exactly as before.
export const Sidebar: React.FC<SidebarProps> = ({
  isDark,
  rowPadding,
  sidebarView,
  setSidebarView,
  rootNodes,
  selectedPath,
  revealPath,
  onSelect,
  onContextMenu,
  onCreateNew,
  onMove,
  onFocusNode,
  onRunPython,
  onPreviewMarkdown,
  gitFileStates,
  gitRepos,
  onGitStage,
  onGitUnstage,
  onGitDiscard,
  onGitCommit,
  onGitPush,
  onGitPull,
  onGitDiff
}) => {
  return (
    <>
      {gitRepos.length > 0 && (
        <div className="flex border-b border-fleet-border shrink-0 text-xs">
          <button
            className={clsx(
              'flex-1 flex items-center justify-center gap-1.5 py-1.5',
              sidebarView === 'files'
                ? 'text-fleet-textHover bg-fleet-active'
                : 'text-gray-400 hover:text-gray-200'
            )}
            onClick={() => setSidebarView('files')}
          >
            <Files size={12} /> Files
          </button>
          <button
            className={clsx(
              'flex-1 flex items-center justify-center gap-1.5 py-1.5',
              sidebarView === 'git'
                ? 'text-fleet-textHover bg-fleet-active'
                : 'text-gray-400 hover:text-gray-200'
            )}
            onClick={() => setSidebarView('git')}
          >
            <GitBranch size={12} /> Git
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 pt-3">
        {sidebarView === 'git' && gitRepos.length > 0 ? (
          <GitPanel
            repos={gitRepos}
            isDark={isDark}
            onStage={onGitStage}
            onUnstage={onGitUnstage}
            onDiscard={onGitDiscard}
            onCommit={onGitCommit}
            onPush={onGitPush}
            onPull={onGitPull}
            onDiff={onGitDiff}
          />
        ) : rootNodes.length > 0 ? (
          <div className="flex flex-col gap-2">
            {rootNodes.map((rootNode) => (
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
                revealPath={revealPath}
                rowPadding={rowPadding}
                gitStatus={gitFileStates}
              />
            ))}
          </div>
        ) : (
          <div className="text-center mt-10 text-gray-500 text-sm p-4">No folder opened.</div>
        )}
      </div>
    </>
  )
}
