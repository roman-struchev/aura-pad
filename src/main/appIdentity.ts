import { app } from 'electron'

// Imported for its side effects before any module that touches
// app.getPath('userData') (settings, workspaces, recent files - they resolve
// their file paths at import time).
//
// In dev, Electron derives the profile dir name from package.json's `name`
// ("aurapad", npm names must be lowercase), while packaged builds use
// electron-builder's productName ("AuraPad") - leaving dev and the installed
// app with two separate profiles for no good reason. Pin the name so both
// share ~/Library/Application Support/AuraPad.
app.setName('AuraPad')

// Opt-in profile override for running a second instance in parallel (e.g.
// driving a dev build while the installed app is open) - without it the two
// share userData and fight over the single-instance lock, and the dev build
// silently quits at startup.
const overrideDir = process.env.AURAPAD_USER_DATA_DIR
if (overrideDir) app.setPath('userData', overrideDir)
