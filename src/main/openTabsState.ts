import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { writeConfigFile } from './configFile'
import type { OpenTabsState } from '../shared/openTabsState'

const openTabsConfigPath = path.join(app.getPath('userData'), 'openTabs.json')

const EMPTY_STATE: OpenTabsState = { paths: [], activeTabPath: null, pinnedPaths: [] }

export function loadOpenTabsState(): OpenTabsState {
  try {
    if (fs.existsSync(openTabsConfigPath)) {
      return { ...EMPTY_STATE, ...JSON.parse(fs.readFileSync(openTabsConfigPath, 'utf-8')) }
    }
  } catch (e) {
    console.warn('Failed to load openTabs.json:', e)
  }
  return { ...EMPTY_STATE }
}

export function saveOpenTabsState(state: OpenTabsState): void {
  writeConfigFile(openTabsConfigPath, state)
}
