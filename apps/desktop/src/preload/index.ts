import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// The only surface the renderer gets: call an API method, listen for events.
contextBridge.exposeInMainWorld('bridge', {
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('api', method, args),
  onEvent: (cb: (event: unknown) => void) => {
    const listener = (_: IpcRendererEvent, event: unknown) => cb(event)
    ipcRenderer.on('api:event', listener)
    return () => ipcRenderer.removeListener('api:event', listener)
  },
})
