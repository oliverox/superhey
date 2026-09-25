import { existsSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * The app was called "@myhey/desktop", and Electron named its data folder after it. Now it's
 * SuperHey: on the first launch under the new name, the old folder (cache, settings,
 * attachments) moves across whole. Never over an existing folder. Keys encrypted under the
 * old name can't be read under the new one, so the app asks for them again.
 * Returns what happened, for the log.
 */
export function moveOldDataFolder(oldDir: string, newDir: string): 'moved' | 'nothing to move' | 'already there' {
  if (!existsSync(oldDir)) return 'nothing to move'
  if (existsSync(newDir)) return 'already there'
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
