import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { moveOldDataFolder } from './dataFolder'

function appData() {
  const root = mkdtempSync(join(tmpdir(), 'superhey-data-'))
  const oldDir = join(root, '@myhey', 'desktop')
  mkdirSync(join(oldDir, 'attachments'), { recursive: true })
  writeFileSync(join(oldDir, 'cache.db'), 'the cache')
  return { root, oldDir, newDir: join(root, 'SuperHey') }
}

describe('moving the old data folder', () => {
  it('moves it whole to the new name, and tidies the empty parent', () => {
    const { root, oldDir, newDir } = appData()
    expect(moveOldDataFolder(oldDir, newDir)).toBe('moved')
    expect(readFileSync(join(newDir, 'cache.db'), 'utf8')).toBe('the cache')
    expect(existsSync(join(newDir, 'attachments'))).toBe(true)
    expect(existsSync(join(root, '@myhey'))).toBe(false)
  })

  it('moves over the folder Electron creates at startup, before the app runs', () => {
    const { oldDir, newDir } = appData()
    mkdirSync(join(newDir, 'GPUCache'), { recursive: true })
    writeFileSync(join(newDir, 'Local State'), '{}')
    expect(moveOldDataFolder(oldDir, newDir)).toBe('moved')
    expect(readFileSync(join(newDir, 'cache.db'), 'utf8')).toBe('the cache')
    expect(existsSync(join(newDir, 'GPUCache'))).toBe(false)
  })

  it('never moves over a folder that has the app’s data, and does nothing twice', () => {
    const { oldDir, newDir } = appData()
    mkdirSync(newDir)
    writeFileSync(join(newDir, 'cache.db'), 'newer')
    expect(moveOldDataFolder(oldDir, newDir)).toBe('already there')
    expect(readFileSync(join(newDir, 'cache.db'), 'utf8')).toBe('newer')
    expect(existsSync(oldDir)).toBe(true)
    expect(moveOldDataFolder(join(oldDir, 'nope'), newDir)).toBe('nothing to move')
  })

  it('leaves the parent when something else lives there', () => {
    const { root, oldDir, newDir } = appData()
    mkdirSync(join(root, '@myhey', 'other'))
    moveOldDataFolder(oldDir, newDir)
    expect(existsSync(join(root, '@myhey', 'other'))).toBe(true)
  })
})
