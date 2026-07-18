import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { writeConfigFile } from './configFile'
import { type AppSettings, DEFAULT_SETTINGS } from '../shared/settings'

const settingsConfigPath = path.join(app.getPath('userData'), 'settings.json')

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(settingsConfigPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsConfigPath, 'utf-8'))
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
          }
        }
      }
      // Legacy flat key from before extension settings were namespaced. Only
      // consulted while the namespaced value has never been written.
      if (saved.extensions?.git?.enabled === undefined && typeof saved.gitEnabled === 'boolean') {
        settings.extensions.git.enabled = saved.gitEnabled
      }
      return settings
    }
  } catch (e) {
    console.warn('Failed to load settings.json:', e)
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: AppSettings): void {
  writeConfigFile(settingsConfigPath, settings)
}
