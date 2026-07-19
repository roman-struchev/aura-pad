import React, { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { subscribeDialogRequests, type DialogRequest } from '../lib/dialogs'

export const DialogHost: React.FC = () => {
  const [request, setRequest] = useState<DialogRequest | null>(null)

  useEffect(() => subscribeDialogRequests(setRequest), [])

  if (!request) return null

  if (request.kind === 'alert') {
    return (
      <Modal onClose={() => request.resolve()}>
        <div className="text-sm text-fleet-text mb-4 whitespace-pre-wrap">{request.message}</div>
        <div className="flex justify-end">
          <button
            data-autofocus
            className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white"
            onClick={() => request.resolve()}
          >
            OK
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={() => request.resolve(false)}>
      <div className="text-sm text-fleet-text mb-4 whitespace-pre-wrap">{request.message}</div>
      <div className="flex justify-end gap-2">
        <button
          data-autofocus
          className="px-3 py-1 text-xs rounded hover:bg-fleet-active text-gray-400"
          onClick={() => request.resolve(false)}
        >
          Cancel
        </button>
        <button
          className="px-3 py-1 text-xs rounded bg-red-600 hover:bg-red-500 text-white"
          onClick={() => request.resolve(true)}
        >
          Confirm
        </button>
      </div>
    </Modal>
  )
}
