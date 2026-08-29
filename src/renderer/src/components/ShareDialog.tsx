import React, { useState } from 'react'
import clsx from 'clsx'
import { Check, Copy, Loader2, X } from 'lucide-react'
import { Modal } from './Modal'
import type { WorkTogetherSessionView } from '../hooks/useWorkTogether'
import type { WorkTogetherLinkRole } from '../../../shared/workTogether'

interface ShareDialogProps {
  fileName: string
  session: WorkTogetherSessionView | undefined
  onShare: (role: WorkTogetherLinkRole, ttlSeconds: number) => Promise<{ error?: string }>
  onRevokeLink: (linkId: string) => Promise<void>
  onStop: () => Promise<void>
  onClose: () => void
}

const TTL_OPTIONS: { value: number; label: string }[] = [
  { value: 900, label: '15 minutes' },
  { value: 3600, label: '1 hour' },
  { value: 14400, label: '4 hours' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '7 days' },
  { value: 2592000, label: '30 days' }
]

// "Share…" - the entry point to Work Together for the active tab: pick a
// permission and an expiry, mint a link, hand it to the user to copy. Also
// where the active session's live participant list and existing links live,
// since they're only ever relevant while this dialog (or the presence badge
// that reopens it) is in view.
export const ShareDialog: React.FC<ShareDialogProps> = ({
  fileName,
  session,
  onShare,
  onRevokeLink,
  onStop,
  onClose
}) => {
  const [role, setRole] = useState<WorkTogetherLinkRole>('read')
  const [ttlSeconds, setTtlSeconds] = useState(3600)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)

  const handleCreate = async (): Promise<void> => {
    setCreating(true)
    setError(null)
    const result = await onShare(role, ttlSeconds)
    setCreating(false)
    if (result.error) setError(result.error)
  }

  const handleCopy = (linkId: string, url: string): void => {
    navigator.clipboard.writeText(url)
    setCopiedLinkId(linkId)
    setTimeout(() => setCopiedLinkId((prev) => (prev === linkId ? null : prev)), 1500)
  }

  const handleStop = async (): Promise<void> => {
    setStopping(true)
    await onStop()
    setStopping(false)
    onClose()
  }

  const links = session?.links ?? []
  const participants = session?.participants ?? []

  return (
    <Modal title="Share" onClose={onClose} width="w-[26rem]">
      <div className="flex flex-col gap-4">
        <div className="text-xs text-gray-500 truncate">{fileName}</div>

        {session && (
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className={clsx(
                'w-1.5 h-1.5 rounded-full',
                session.status === 'connected'
                  ? 'bg-green-500'
                  : session.status === 'connecting'
                    ? 'bg-yellow-500 animate-pulse'
                    : 'bg-gray-500'
              )}
            />
            <span className="text-gray-400">
              {session.status === 'connected'
                ? 'Live'
                : session.status === 'connecting'
                  ? 'Connecting…'
                  : (session.closedReason ?? 'Disconnected')}
            </span>
          </div>
        )}

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 flex-1">
            <span className="text-[11px] text-gray-500">Permission</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as WorkTogetherLinkRole)}
              className="bg-fleet-bg border border-fleet-border rounded px-2 py-1 text-xs text-fleet-text outline-none focus:border-blue-500"
            >
              <option value="read">Read only</option>
              <option value="write">Read &amp; write</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1">
            <span className="text-[11px] text-gray-500">Expires after</span>
            <select
              value={ttlSeconds}
              onChange={(e) => setTtlSeconds(Number(e.target.value))}
              className="bg-fleet-bg border border-fleet-border rounded px-2 py-1 text-xs text-fleet-text outline-none focus:border-blue-500"
            >
              {TTL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="px-2.5 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 shrink-0"
            disabled={creating}
            onClick={handleCreate}
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : 'Create Link'}
          </button>
        </div>

        {error && <span className="text-xs text-red-400">{error}</span>}

        <span className="text-[11px] text-gray-600">
          The server does not save your file. It only passes edits between everyone connected, and
          forgets everything once you stop sharing.
        </span>

        {links.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-gray-500">Active links</span>
            {links.map((link) => (
              <div
                key={link.linkId}
                className="flex items-center gap-2 px-2 py-1 rounded border border-fleet-border bg-fleet-bg text-xs"
              >
                <span className="truncate flex-1 text-fleet-text">{link.url}</span>
                <span className="text-gray-500 shrink-0">
                  {link.role === 'write' ? 'read & write' : 'read only'}
                </span>
                <button
                  className="opacity-60 hover:opacity-100 shrink-0"
                  title="Copy link"
                  onClick={() => handleCopy(link.linkId, link.url)}
                >
                  {copiedLinkId === link.linkId ? (
                    <Check size={12} className="text-green-500" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
                <button
                  className="opacity-60 hover:opacity-100 shrink-0"
                  title="Revoke link"
                  onClick={() => onRevokeLink(link.linkId)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-gray-500">
            {participants.length === 0
              ? 'No one else is here yet'
              : `${participants.length} ${participants.length === 1 ? 'person' : 'people'} here`}
          </span>
          {participants.map((p) => (
            <div key={p.connectionId} className="flex items-center gap-2 text-xs text-fleet-text">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: p.color || '#5B8DEF' }}
              />
              <span className="truncate">{p.displayName}</span>
              <span className="text-gray-500 shrink-0">
                {p.role === 'write' ? 'read & write' : 'read only'}
              </span>
            </div>
          ))}
        </div>

        {session && (
          <div className="flex items-center border-t border-fleet-border pt-3">
            <button
              className="text-xs text-red-400 hover:text-accent-error disabled:opacity-40 flex items-center gap-1.5"
              disabled={stopping}
              onClick={handleStop}
            >
              {stopping && <Loader2 size={12} className="animate-spin" />}
              Stop Sharing
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
