import { app } from 'electron'
import path from 'path'
import { readConfigFile, writeConfigFile } from './configFile'
import type { OpenTabsState } from '../shared/openTabsState'

const openTabsConfigPath = path.join(app.getPath('userData'), 'openTabs.json')

const EMPTY_STATE: OpenTabsState = { paths: [], activeTabPath: null, pinnedPaths: [] }

export function loadOpenTabsState(): OpenTabsState {
  return {
    ...EMPTY_STATE,
    ...readConfigFile<Partial<OpenTabsState>>(openTabsConfigPath, () => ({}))
  }
}

export function saveOpenTabsState(state: OpenTabsState): void {
  writeConfigFile(openTabsConfigPath, state)
}
