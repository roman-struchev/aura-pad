import React from 'react'
import {
  AlignLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  Crosshair,
  Eye,
  Loader2,
  Mic,
  Play,
  Share2,
  Square,
  Volume2
} from 'lucide-react'
import { ToolbarButton } from './ToolbarButton'
import { VoiceLevelMeter } from './VoiceLevelMeter'
import { isFormattablePath, isPythonPath } from '../lib/fileType'
import type { useVoiceInput } from '../hooks/useVoiceInput'
import type { useReadAloud } from '../hooks/useReadAloud'

interface FileActionsProps {
  selectedPath: string | null
  isFileInWorkspace: boolean
  showPreview: boolean
  isPreviewable: boolean
  canFold: boolean
  foldedAll: boolean
  canDictate: boolean
  isProse: boolean
  workTogetherEnabled: boolean
  workTogetherSharing: boolean
  workTogetherParticipantCount: number
  voice: ReturnType<typeof useVoiceInput>
  readAloud: ReturnType<typeof useReadAloud>
  onRevealActiveFile: () => void
  onRunPython: () => void
  onFormatDocument: () => void
  onToggleFold: () => void
  onTogglePreview: () => void
  onToggleDictation: () => void
  onStartReadAloud: () => void
  onOpenShare: () => void
}

// The active file's action buttons: reveal-in-tree, run, format, preview
// toggle, dictation (with live level meter), Work Together share, and
// read-aloud (with speed control). Floated over the editor's top-right corner
// (Obsidian's view-header actions), keyed off whichever file is focused.
export const FileActions: React.FC<FileActionsProps> = ({
  selectedPath,
  isFileInWorkspace,
  showPreview,
  isPreviewable,
  canFold,
  foldedAll,
  canDictate,
  isProse,
  workTogetherEnabled,
  workTogetherSharing,
  workTogetherParticipantCount,
  voice,
  readAloud,
  onRevealActiveFile,
  onRunPython,
  onFormatDocument,
  onToggleFold,
  onTogglePreview,
  onToggleDictation,
  onStartReadAloud,
  onOpenShare
}) => {
  const voiceBusy = voice.status === 'downloading' || voice.status === 'transcribing'
  const isFormattable = isFormattablePath(selectedPath)
  // Uniform, muted secondary tone: file actions are a quiet toolbar, not
  // status decoration - they light up on hover to read as clickable.
  const muted = 'text-gray-500 hover:text-white'

  return (
    <div className="flex items-center gap-0.5 shrink-0 rounded-md bg-fleet-header/80 px-0.5 backdrop-blur-sm">
      {isFileInWorkspace && (
        <ToolbarButton
          onClick={onRevealActiveFile}
          title="Select Opened File in Tree"
          colorClassName={muted}
        >
          <Crosshair size={16} />
        </ToolbarButton>
      )}
      {isPythonPath(selectedPath) && (
        <ToolbarButton onClick={onRunPython} title="Run Python" colorClassName={muted}>
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
          colorClassName={muted}
        >
          <AlignLeft size={16} />
        </ToolbarButton>
      )}
      {canFold && (
        <ToolbarButton
          onClick={onToggleFold}
          active={foldedAll}
          colorClassName={muted}
          title={foldedAll ? 'Unfold All' : 'Fold All'}
        >
          {foldedAll ? <ChevronsUpDown size={16} /> : <ChevronsDownUp size={16} />}
        </ToolbarButton>
      )}
      {isPreviewable && (
        <ToolbarButton
          onClick={onTogglePreview}
          active={showPreview}
          colorClassName={muted}
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
            colorClassName={voice.status === 'recording' ? 'text-blue-400 bg-fleet-active' : muted}
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
            colorClassName={muted}
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
            colorClassName={readAloud.speaking ? 'text-blue-400 bg-fleet-active' : muted}
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
  )
}
