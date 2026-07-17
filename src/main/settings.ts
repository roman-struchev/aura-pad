import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { writeConfigFile } from './configFile'
import { type AppSettings, DEFAULT_SETTINGS } from '../shared/settings'

const settingsConfigPath = path.join(app.getPath('userData'), 'settings.json')

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(settingsConfigPath)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsConfigPath, 'utf-8')) }
    }
  } catch (e) {
    console.warn('Failed to load settings.json:', e)
  }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: AppSettings): void {
  writeConfigFile(settingsConfigPath, settings)
}
