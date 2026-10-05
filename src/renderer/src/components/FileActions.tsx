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
  SpellCheck,
  Square,
  Volume2
} from 'lucide-react'
import { ToolbarButton } from './ToolbarButton'
import { VoiceLevelMeter } from './VoiceLevelMeter'
import { isFormattablePath, isHttpPath, isProsePath, isPythonPath } from '../lib/fileType'
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
  // Environments the active .http file can run against (empty when it has no
  // http-client.env.json near it), and which one is picked.
  // Spell checking, when it is on for this file: how many unknown words the
  // last pass found, and jumping to the next one.
  spellcheckOn: boolean
  spellIssueCount: number
  onNextSpellingIssue: () => void
  httpEnvironmentNames: string[]
  httpEnvironment: string
  onSelectHttpEnvironment: (name: string) => void
  voice: ReturnType<typeof useVoiceInput>
  readAloud: ReturnType<typeof useReadAloud>
  onRevealActiveFile: () => void
  onRunPython: () => void
  onRunHttp: () => void
  onFormatDocument: () => void
  onToggleFold: () => void
  onTogglePreview: () => void
  onToggleDictation: () => void
  onStartReadAloud: () => void
  onOpenShare: () => void
  // Smaller icons and no backdrop, for when the row sits inside the
  // breadcrumbs strip instead of floating over the editor.
  compact?: boolean
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
  spellcheckOn,
  spellIssueCount,
  onNextSpellingIssue,
  httpEnvironmentNames,
  httpEnvironment,
  onSelectHttpEnvironment,
  voice,
  readAloud,
  onRevealActiveFile,
  onRunPython,
  onRunHttp,
  onFormatDocument,
  onToggleFold,
  onTogglePreview,
  onToggleDictation,
  onStartReadAloud,
  onOpenShare,
  compact = false
}) => {
  const iconSize = compact ? 13 : 16
  const voiceBusy = voice.status === 'downloading' || voice.status === 'transcribing'
  const isFormattable = isFormattablePath(selectedPath)
  // Uniform, muted secondary tone: file actions are a quiet toolbar, not
  // status decoration - they light up on hover to read as clickable.
  const muted = 'text-gray-500 hover:text-fleet-textHover'

  return (
    <div
      className={
        compact
          ? 'flex items-center gap-0.5 shrink-0'
          : 'flex items-center gap-0.5 shrink-0 rounded-md bg-fleet-header/80 px-0.5 backdrop-blur-sm'
      }
    >
      {/* In the breadcrumbs strip the file's own crumb already does this. */}
      {isFileInWorkspace && !compact && (
        <ToolbarButton
          dense={compact}
          onClick={onRevealActiveFile}
          title="Select Opened File in Tree"
          colorClassName={muted}
        >
          <Crosshair size={iconSize} />
        </ToolbarButton>
      )}
      {isPythonPath(selectedPath) && (
        <ToolbarButton
          dense={compact}
          onClick={onRunPython}
          title="Run Python"
          colorClassName={muted}
        >
          <Play size={iconSize} />
        </ToolbarButton>
      )}
      {isHttpPath(selectedPath) && httpEnvironmentNames.length > 0 && (
        // Sits next to Run because that is the moment it matters: the
        // selected environment is what {{host}} and {{token}} resolve to.
        <select
          value={httpEnvironmentNames.includes(httpEnvironment) ? httpEnvironment : ''}
          onChange={(e) => onSelectHttpEnvironment(e.target.value)}
          aria-label="HTTP environment"
          title="Environment (http-client.env.json)"
          className="bg-transparent border border-fleet-border rounded px-1 py-0.5 mx-0.5 text-[11px] text-gray-400 hover:text-fleet-textHover outline-none focus:border-blue-500"
        >
          {/* Short on purpose: this is the widest thing in a toolbar
              that has none to spare, and it is read next to a picker
              whose label already says what it picks. */}
          <option value="">No env</option>
          {httpEnvironmentNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
      {isHttpPath(selectedPath) && (
        <ToolbarButton
          dense={compact}
          onClick={onRunHttp}
          title="Run Request (Cmd+Enter)"
          colorClassName={muted}
        >
          <Play size={iconSize} />
        </ToolbarButton>
      )}
      {spellcheckOn && isProsePath(selectedPath) && (
        // A count rather than a badge: clicking it walks to the next unknown
        // word, which is the only thing anyone wants to do with the number.
        <ToolbarButton
          dense={compact}
          onClick={onNextSpellingIssue}
          title={
            spellIssueCount === 0
              ? 'Spelling: nothing unknown'
              : `Spelling: ${spellIssueCount} unknown ${spellIssueCount === 1 ? 'word' : 'words'} (click for the next)`
          }
          ariaLabel={`Spelling issues: ${spellIssueCount}`}
          colorClassName={muted}
        >
          <span className="flex items-center gap-0.5">
            <SpellCheck size={iconSize} />
            {spellIssueCount > 0 && (
              <span className="text-[10px] leading-none">{spellIssueCount}</span>
            )}
          </span>
        </ToolbarButton>
      )}
      {isFormattable && (
        <ToolbarButton
          dense={compact}
          onClick={onFormatDocument}
          title={
            selectedPath?.endsWith('.json')
              ? 'Format JSON (Option+Cmd+L)'
              : 'Format Document (Option+Cmd+L)'
          }
          colorClassName={muted}
        >
          <AlignLeft size={iconSize} />
        </ToolbarButton>
      )}
      {canFold && (
        <ToolbarButton
          dense={compact}
          onClick={onToggleFold}
          active={foldedAll}
          colorClassName={muted}
          title={foldedAll ? 'Unfold All' : 'Fold All'}
        >
          {foldedAll ? <ChevronsUpDown size={iconSize} /> : <ChevronsDownUp size={iconSize} />}
        </ToolbarButton>
      )}
      {isPreviewable && (
        <ToolbarButton
          dense={compact}
          onClick={onTogglePreview}
          active={showPreview}
          colorClassName={muted}
          title={showPreview ? 'Show Source (Cmd+Shift+P)' : 'Show Preview (Cmd+Shift+P)'}
        >
          {showPreview ? <Code2 size={iconSize} /> : <Eye size={iconSize} />}
        </ToolbarButton>
      )}
      {canDictate && (
        <>
          <ToolbarButton
            dense={compact}
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
              <Loader2 size={iconSize} className="animate-spin" />
            ) : voice.status === 'recording' ? (
              <Square size={iconSize} className="fill-current" />
            ) : (
              <Mic size={iconSize} />
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
            dense={compact}
            onClick={onOpenShare}
            active={workTogetherSharing}
            title={workTogetherSharing ? 'Work Together (sharing)' : 'Share…'}
            colorClassName={muted}
          >
            <Share2 size={iconSize} />
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
            dense={compact}
            onClick={readAloud.speaking ? readAloud.stop : onStartReadAloud}
            title={readAloud.speaking ? 'Stop Reading (Esc)' : 'Read Aloud'}
            colorClassName={readAloud.speaking ? 'text-blue-400 bg-fleet-active' : muted}
          >
            {readAloud.speaking ? (
              <Square size={iconSize} className="fill-current" />
            ) : (
              <Volume2 size={iconSize} />
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
                className="px-1.5 py-0.5 rounded-full bg-fleet-active text-blue-400 text-[11px] font-medium hover:text-fleet-textHover select-none"
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
