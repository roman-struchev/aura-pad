import React from 'react'
import {
  AlignLeft,
  Code2,
  Crosshair,
  Eye,
  FolderOpen,
  Loader2,
  Mic,
  PanelLeft,
  PanelLeftClose,
  Play,
  Search,
  Settings as SettingsIcon,
  Share2,
  Square,
  SquareCheckBig,
  Terminal as TerminalIcon,
  Volume2
} from 'lucide-react'
import { BranchSelector } from './BranchSelector'
import { ToolbarButton } from './ToolbarButton'
import { VoiceLevelMeter } from './VoiceLevelMeter'
import { isFormattablePath, isPythonPath } from '../lib/fileType'
import type { GitRepoStatus } from '../../../shared/gitStatus'
import type { useGitStatus } from '../hooks/useGitStatus'
import type { useVoiceInput } from '../hooks/useVoiceInput'
import type { useReadAloud } from '../hooks/useReadAloud'

interface AppHeaderProps {
  projectLabel: string
  headerRepo: GitRepoStatus | null | undefined
  git: ReturnType<typeof useGitStatus>
  // Active file facts the buttons key off.
  selectedPath: string | null
  isFileInWorkspace: boolean
  hasFileActions: boolean
  showPreview: boolean
  isPreviewable: boolean
  canDictate: boolean
  isProse: boolean
  googleTasksEnabled: boolean
  googleTasksActive: boolean
  workTogetherEnabled: boolean
  workTogetherSharing: boolean
  workTogetherParticipantCount: number
  terminalShown: boolean
  sidebarVisible: boolean
  voice: ReturnType<typeof useVoiceInput>
  readAloud: ReturnType<typeof useReadAloud>
  onRevealActiveFile: () => void
  onRunPython: () => void
  onFormatDocument: () => void
  onTogglePreview: () => void
  onToggleDictation: () => void
  onStartReadAloud: () => void
  onOpenGlobalSearch: () => void
  onAddFolder: () => void
  onOpenGoogleTasks: () => void
  onOpenShare: () => void
  onToggleTerminal: () => void
  onToggleSidebar: () => void
  onOpenSettings: () => void
}

// The window-title header: breadcrumb + branch selector on the left with the
// active file's action buttons, app-wide buttons (search, folders, tasks,
// terminal, settings) on the right.
export const AppHeader: React.FC<AppHeaderProps> = ({
  projectLabel,
  headerRepo,
  git,
  selectedPath,
  isFileInWorkspace,
  hasFileActions,
  showPreview,
  isPreviewable,
  canDictate,
  isProse,
  googleTasksEnabled,
  googleTasksActive,
  workTogetherEnabled,
  workTogetherSharing,
  workTogetherParticipantCount,
  terminalShown,
  sidebarVisible,
  voice,
  readAloud,
  onRevealActiveFile,
  onRunPython,
  onFormatDocument,
  onTogglePreview,
  onToggleDictation,
  onStartReadAloud,
  onOpenGlobalSearch,
  onAddFolder,
  onOpenGoogleTasks,
  onOpenShare,
  onToggleTerminal,
  onToggleSidebar,
  onOpenSettings
}) => {
  const voiceBusy = voice.status === 'downloading' || voice.status === 'transcribing'
  const isFormattable = isFormattablePath(selectedPath)

  return (
    <div className="h-9 border-b border-fleet-border flex items-center justify-between px-3 bg-fleet-header select-none drag-region shrink-0">
      <div className="ml-24 font-medium text-xs text-gray-400 flex items-center gap-2 min-w-0">
        <span className="truncate max-w-[40vw]">{projectLabel}</span>
        {headerRepo && (
          <div className="no-drag-region shrink-0">
            <BranchSelector
              key={headerRepo.root}
              root={headerRepo.root}
              branch={headerRepo.branch}
              onBranches={git.branches}
              onCheckout={git.checkout}
              triggerClassName="text-gray-500"
            />
          </div>
        )}
        {hasFileActions && (
          <div className="flex items-center gap-1 no-drag-region shrink-0">
            <div className="w-px h-4 bg-fleet-border mx-1" />
            {isFileInWorkspace && (
              <ToolbarButton
                onClick={onRevealActiveFile}
                title="Select Opened File in Tree"
                colorClassName="text-gray-400 hover:text-white"
              >
                <Crosshair size={16} />
              </ToolbarButton>
            )}
            {isPythonPath(selectedPath) && (
              <ToolbarButton
                onClick={onRunPython}
                title="Run Python"
                colorClassName="text-green-500"
              >
                <Play size={16} />
              </ToolbarButton>
            )}
            {isFormattable && (
              <ToolbarButton
                onClick={onFormatDocument}
                title={
                  selectedPath?.endsWith('.json')
                    ? 'Format JSON (Option+Cmd+L)'
                    : 'Format Document (Option+Cmd+L)'
                }
                colorClassName="text-yellow-500"
              >
                <AlignLeft size={16} />
              </ToolbarButton>
            )}
            {isPreviewable && (
              <ToolbarButton
                onClick={onTogglePreview}
                active={showPreview}
                title={showPreview ? 'Show Source (Cmd+Shift+P)' : 'Show Preview (Cmd+Shift+P)'}
              >
                {showPreview ? <Code2 size={16} /> : <Eye size={16} />}
              </ToolbarButton>
            )}
            {canDictate && (
              <>
                <ToolbarButton
                  onClick={onToggleDictation}
                  title={
                    voice.status === 'recording'
                      ? 'Stop Dictation (Cmd+D)'
                      : voice.status === 'transcribing'
                        ? 'Transcribing…'
                        : voiceBusy
                          ? 'Downloading speech model…'
                          : 'Voice Dictation (Cmd+D)'
                  }
                  colorClassName={
                    voice.status === 'recording'
                      ? 'text-blue-400 bg-fleet-active'
                      : 'text-gray-400 hover:text-white'
                  }
                >
                  {voiceBusy ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : voice.status === 'recording' ? (
                    <Square size={16} className="fill-current" />
                  ) : (
                    <Mic size={16} />
                  )}
                </ToolbarButton>
                {voice.status === 'recording' && (
                  <span className="flex items-center px-2 py-0.5 rounded-full bg-fleet-active text-blue-400 select-none">
                    {voice.analyser ? (
                      <VoiceLevelMeter analyser={voice.analyser} />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    )}
                  </span>
                )}
              </>
            )}
            {workTogetherEnabled && (
              <>
                <ToolbarButton
                  onClick={onOpenShare}
                  active={workTogetherSharing}
                  title={workTogetherSharing ? 'Work Together (sharing)' : 'Share…'}
                  colorClassName="text-gray-400 hover:text-white"
                >
                  <Share2 size={16} />
                </ToolbarButton>
                {workTogetherSharing && workTogetherParticipantCount > 0 && (
                  <span
                    className="px-1.5 py-0.5 rounded-full bg-fleet-active text-blue-400 text-[11px] font-medium select-none"
                    title={`${workTogetherParticipantCount} ${workTogetherParticipantCount === 1 ? 'person' : 'people'} here`}
                  >
                    {workTogetherParticipantCount}
                  </span>
                )}
              </>
            )}
            {(isProse || readAloud.speaking) && (
              <>
                <ToolbarButton
                  onClick={readAloud.speaking ? readAloud.stop : onStartReadAloud}
                  title={readAloud.speaking ? 'Stop Reading (Esc)' : 'Read Aloud'}
                  colorClassName={
                    readAloud.speaking
                      ? 'text-blue-400 bg-fleet-active'
                      : 'text-gray-400 hover:text-white'
                  }
                >
                  {readAloud.speaking ? (
                    <Square size={16} className="fill-current" />
                  ) : (
                    <Volume2 size={16} />
                  )}
                </ToolbarButton>
                {readAloud.speaking &&
                  (readAloud.downloadProgress !== null ? (
                    <span
                      className="px-1.5 py-0.5 rounded-full bg-fleet-active text-blue-400 text-[11px] font-medium select-none"
                      title="Downloading voice…"
                    >
                      {readAloud.downloadProgress}%
                    </span>
                  ) : (
                    <button
                      onClick={readAloud.cycleRate}
                      className="px-1.5 py-0.5 rounded-full bg-fleet-active text-blue-400 text-[11px] font-medium hover:text-white select-none"
                      title="Reading speed"
                    >
                      {readAloud.rate}×
                    </button>
                  ))}
              </>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 no-drag-region shrink-0">
        <ToolbarButton
          onClick={onOpenGlobalSearch}
          title="Global Search (Cmd+Shift+F)"
          tooltipAlign="right"
          colorClassName="text-gray-400 hover:text-white"
        >
          <Search size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={onAddFolder}
          title="Add Folder"
          tooltipAlign="right"
          colorClassName="text-gray-400 hover:text-white"
        >
          <FolderOpen size={16} />
        </ToolbarButton>
        {googleTasksEnabled && (
          <ToolbarButton
            onClick={onOpenGoogleTasks}
            active={googleTasksActive}
            title="Google Tasks"
            tooltipAlign="right"
            colorClassName="text-gray-400 hover:text-white"
          >
            <SquareCheckBig size={16} />
          </ToolbarButton>
        )}
        <div className="w-px h-4 bg-fleet-border mx-1" />
        <ToolbarButton
          onClick={onToggleSidebar}
          active={!sidebarVisible}
          title={sidebarVisible ? 'Hide Sidebar (Cmd+B)' : 'Show Sidebar (Cmd+B)'}
          tooltipAlign="right"
          colorClassName="text-gray-400 hover:text-white"
        >
          {sidebarVisible ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
        </ToolbarButton>
        <ToolbarButton
          onClick={onToggleTerminal}
          active={terminalShown}
          title="Toggle Terminal (Ctrl+`)"
          tooltipAlign="right"
        >
          <TerminalIcon size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={onOpenSettings}
          title="Settings (Cmd+,)"
          tooltipAlign="right"
          colorClassName="text-gray-400 hover:text-white"
        >
          <SettingsIcon size={16} />
        </ToolbarButton>
      </div>
    </div>
  )
}
