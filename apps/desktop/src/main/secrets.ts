import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { SecretStore } from './service'

/**
 * Secrets (the Claude API key), encrypted with Electron's safeStorage: on macOS the key
 * that encrypts them lives in the Keychain, so the file on disk is useless elsewhere. Only
 * the main process ever sees a secret in the clear; the UI gets a hint ("sk-ant-…abcd").
 */
export function keychainStore(dir: string): SecretStore {
  const file = (name: string) => join(dir, `${name.replace(/[^a-z0-9-]/gi, '')}.bin`)
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    get(name) {
      try {
        return safeStorage.decryptString(readFileSync(file(name)))
      } catch {
        return null // none stored (or unreadable, which is the same to the app)
      }
    },
    set(name, value) {
      if (value == null) {
        rmSync(file(name), { force: true })
        return
      }
      if (!safeStorage.isEncryptionAvailable()) throw new Error('The system keychain isn’t available, so the key can’t be stored safely.')
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileSync(file(name), safeStorage.encryptString(value), { mode: 0o600 })
      chmodSync(file(name), 0o600)
    },
  }
}
