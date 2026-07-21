import { app } from 'electron'
import path from 'path'
import { readConfigFile, writeConfigFile } from './configFile'
import type { WorkTogetherResumeState } from '../shared/workTogether'

const resumeConfigPath = path.join(app.getPath('userData'), 'workTogetherSessions.json')

const EMPTY_STATE: WorkTogetherResumeState = { sessions: [] }

export function loadWorkTogetherResumeState(): WorkTogetherResumeState {
  return {
    ...EMPTY_STATE,
    ...readConfigFile<Partial<WorkTogetherResumeState>>(resumeConfigPath, () => ({}))
  }
}

export function saveWorkTogetherResumeState(state: WorkTogetherResumeState): void {
  writeConfigFile(resumeConfigPath, state)
}
