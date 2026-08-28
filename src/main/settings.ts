import { app } from 'electron'
import path from 'path'
import { readConfigFile, writeConfigFile } from './configFile'
import { type AppSettings, DEFAULT_SETTINGS } from '../shared/settings'

const settingsConfigPath = path.join(app.getPath('userData'), 'settings.json')

export function loadSettings(): AppSettings {
  const saved = readConfigFile<Partial<AppSettings> & { gitEnabled?: boolean }>(
    settingsConfigPath,
    () => ({})
  )
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    // The top-level spread is shallow, so a partially-saved `extensions`
    // block (older version, or one written before a new extension
    // existed) must be re-merged per extension or missing sub-keys would
    // silently lose their defaults.
    extensions: {
      git: { ...DEFAULT_SETTINGS.extensions.git, ...saved.extensions?.git },
      googleTasks: {
        ...DEFAULT_SETTINGS.extensions.googleTasks,
        ...saved.extensions?.googleTasks
      },
      workTogether: {
        ...DEFAULT_SETTINGS.extensions.workTogether,
        ...saved.extensions?.workTogether
      },
      httpClient: {
        ...DEFAULT_SETTINGS.extensions.httpClient,
        ...saved.extensions?.httpClient,
        request: {
          ...DEFAULT_SETTINGS.extensions.httpClient.request,
          ...saved.extensions?.httpClient?.request
        }
      },
      ports: { ...DEFAULT_SETTINGS.extensions.ports, ...saved.extensions?.ports }
    }
  }
  // Renamed when the panel stopped being only the history (it lists the
  // project's saved requests too), so someone who had opened it keeps it
  // open. Only consulted while the new key has never been written.
  const legacyHistoryCollapsed = (
    saved.extensions?.httpClient as { historyCollapsed?: boolean } | undefined
  )?.historyCollapsed
  if (
    saved.extensions?.httpClient?.sidePanelCollapsed === undefined &&
    typeof legacyHistoryCollapsed === 'boolean'
  ) {
    settings.extensions.httpClient.sidePanelCollapsed = legacyHistoryCollapsed
  }

  // Legacy flat key from before extension settings were namespaced. Only
  // consulted while the namespaced value has never been written.
  if (saved.extensions?.git?.enabled === undefined && typeof saved.gitEnabled === 'boolean') {
    settings.extensions.git.enabled = saved.gitEnabled
  }
  return settings
}

export function saveSettings(settings: AppSettings): void {
  writeConfigFile(settingsConfigPath, settings)
}
