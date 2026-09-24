import { contextBridge, ipcRenderer } from 'electron'

// One IPC listener for the whole page, fanned out to every subscriber. (A listener per
// subscriber would pile up on ipcRenderer as components come and go.)
const subscribers = new Set<(event: unknown) => void>()
ipcRenderer.on('api:event', (_e, event: unknown) => {
  for (const cb of subscribers) cb(event)
})

// The only surface the renderer gets: call an API method, listen for events.
contextBridge.exposeInMainWorld('bridge', {
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('api', method, args),
  onEvent: (cb: (event: unknown) => void) => {
    subscribers.add(cb)
    return () => {
      subscribers.delete(cb)
    }
  },
})
