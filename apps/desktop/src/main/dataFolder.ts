import { existsSync, readdirSync, renameSync, rmdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The app was called "@myhey/desktop", and Electron named its data folder after it. Now it's
 * SuperHey: on the first launch under the new name, the old folder (cache, settings,
 * attachments) moves across whole, never over one that already has the app's data. Keys encrypted under the
 * old name can't be read under the new one, so the app asks for them again.
 * Returns what happened, for the log.
 */
export function moveOldDataFolder(oldDir: string, newDir: string): 'moved' | 'nothing to move' | 'already there' {
  if (!existsSync(oldDir)) return 'nothing to move'
  // The app's own data is already under the new name: nothing to do (ever again).
  if (existsSync(join(newDir, 'cache.db'))) return 'already there'
  // Electron creates the data folder (and may start filling it) before the app's code runs,
  // so a new folder without the app's data is Electron's own start: it makes way.
  if (existsSync(newDir)) {
    const aside = `${newDir}.electron-start-${Date.now()}`
    renameSync(newDir, aside)
    rmSync(aside, { recursive: true, force: true })
  }
  renameSync(oldDir, newDir)
  // "@myhey" held nothing else: don't leave it behind empty.
  const parent = dirname(oldDir)
  try {
    if (readdirSync(parent).length === 0) rmdirSync(parent)
  } catch {
    // not ours to worry about
  }
  return 'moved'
}
