import React, { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import { Modal } from './Modal'
import type { AppSettings, HttpClientEnvironment } from '../../../shared/settings'

interface HttpEnvironmentsModalProps {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  onClose: () => void
}

// The HTTP Client tab's environments: named sets of constants that fill in
// the {{placeholders}} in a request. The same idea as the http-client.env.json
// files a .http file can sit next to - except the tab has no file, so its
// environments are settings.
//
// Written straight through to settings on every keystroke rather than into a
// draft that has to be confirmed: there is nothing here to get half-right,
// and a dialog whose Cancel silently drops a token someone just pasted in is
// the worse failure.
export const HttpEnvironmentsModal: React.FC<HttpEnvironmentsModalProps> = ({
  settings,
  updateSetting,
  onClose
}) => {
  const client = settings.extensions.httpClient
  const environments = client.environments
  const [selected, setSelected] = useState(
    () => client.selectedEnvironment || environments[0]?.name || ''
  )

  const write = (next: HttpClientEnvironment[], selectedName = client.selectedEnvironment): void =>
    updateSetting('extensions', {
      ...settings.extensions,
      httpClient: { ...client, environments: next, selectedEnvironment: selectedName }
    })

  const current = environments.find((e) => e.name === selected) ?? null

  const patchCurrent = (patch: Partial<HttpClientEnvironment>): void => {
    if (!current) return
    const renamed = patch.name !== undefined && patch.name !== current.name
    write(
      environments.map((e) => (e.name === current.name ? { ...e, ...patch } : e)),
      // A rename has to carry the selection with it, or the form would be
      // left pointing at a name that no longer exists and silently stop
      // substituting.
      renamed && client.selectedEnvironment === current.name
        ? (patch.name ?? '')
        : client.selectedEnvironment
    )
    if (renamed) setSelected(patch.name ?? '')
  }

  const addEnvironment = (): void => {
    // "Environment 2" while an "Environment 2" is still open would make two
    // rows nothing can tell apart - the list is keyed by name, which is also
    // what the request refers to.
    let name = 'New environment'
    for (let n = 2; environments.some((e) => e.name === name); n++) name = `New environment ${n}`
    write([...environments, { name, variables: [{ name: '', value: '' }] }])
    setSelected(name)
  }

  const removeEnvironment = (name: string): void => {
    const next = environments.filter((e) => e.name !== name)
    write(next, client.selectedEnvironment === name ? '' : client.selectedEnvironment)
    if (selected === name) setSelected(next[0]?.name ?? '')
  }

  const setVariableAt = (index: number, patch: Partial<{ name: string; value: string }>): void => {
    if (!current) return
    patchCurrent({
      variables: current.variables.map((v, i) => (i === index ? { ...v, ...patch } : v))
    })
  }

  return (
    <Modal title="HTTP Environments" onClose={onClose} width="w-[38rem]">
      <div className="flex gap-3 min-h-[16rem]">
        <div className="w-44 shrink-0 flex flex-col gap-1 border-r border-fleet-border pr-3">
          {environments.length === 0 && (
            <div className="text-[11px] text-gray-500 py-1">
              No environments yet. Add one, fill in its constants, then use them as{' '}
              <span className="font-mono">{'{{name}}'}</span> in the request.
            </div>
          )}
          {environments.map((env) => (
            <div key={env.name} className="flex items-center gap-1">
              <button
                onClick={() => setSelected(env.name)}
                className={clsx(
                  'flex-1 min-w-0 text-left text-xs px-2 py-1 rounded truncate',
                  env.name === selected
                    ? 'bg-fleet-active text-fleet-textHover'
                    : 'text-fleet-text hover:bg-fleet-active hover:text-fleet-textHover'
                )}
              >
                {env.name}
              </button>
              <button
                onClick={() => removeEnvironment(env.name)}
                aria-label={`Delete ${env.name}`}
                title={`Delete ${env.name}`}
                className="p-1 text-gray-500 hover:text-red-300"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            onClick={addEnvironment}
            className="self-start flex items-center gap-1 text-[11px] text-gray-400 hover:text-fleet-textHover px-1 py-0.5"
          >
            <Plus size={12} />
            Add environment
          </button>
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {!current ? (
            <div className="text-[11px] text-gray-500">Pick an environment to edit it.</div>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-500">Name</span>
                <input
                  value={current.name}
                  onChange={(e) => patchCurrent({ name: e.target.value })}
                  aria-label="Environment name"
                  spellCheck={false}
                  className="bg-fleet-sidebar border border-fleet-border rounded px-2 py-1 text-xs text-fleet-text outline-none focus:border-blue-500"
                />
              </label>

              <div className="text-[11px] text-gray-500">Constants</div>
              <div className="flex flex-col gap-1">
                {current.variables.map((variable, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      value={variable.name}
                      onChange={(e) => setVariableAt(index, { name: e.target.value })}
                      placeholder="host"
                      aria-label={`Constant ${index + 1} name`}
                      spellCheck={false}
                      className="w-40 bg-fleet-sidebar border border-fleet-border rounded px-2 py-1 text-[11px] font-mono text-fleet-text outline-none focus:border-blue-500"
                    />
                    <input
                      value={variable.value}
                      onChange={(e) => setVariableAt(index, { value: e.target.value })}
                      placeholder="https://api.example.com"
                      aria-label={`Constant ${index + 1} value`}
                      spellCheck={false}
                      className="flex-1 min-w-0 bg-fleet-sidebar border border-fleet-border rounded px-2 py-1 text-[11px] font-mono text-fleet-text outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={() =>
                        patchCurrent({
                          variables: current.variables.filter((_, i) => i !== index)
                        })
                      }
                      aria-label={`Remove constant ${index + 1}`}
                      title="Remove"
                      className="p-1 text-gray-500 hover:text-fleet-textHover"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    patchCurrent({ variables: [...current.variables, { name: '', value: '' }] })
                  }
                  className="self-start flex items-center gap-1 text-[11px] text-gray-400 hover:text-fleet-textHover px-1 py-0.5"
                >
                  <Plus size={12} />
                  Add constant
                </button>
              </div>

              <div className="text-[11px] text-gray-500 mt-1">
                These are stored in the app&apos;s settings file in plain text, like the rest of its
                configuration. For a secret that must not sit there, keep the request in a .http
                file and put the value in a http-client.private.env.json beside it.
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
