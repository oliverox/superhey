import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import { fileHeaders, type ApiEvent } from '../shared/api'
import { moveOldDataFolder } from './dataFolder'
import { keychainStore } from './secrets'
import { AppService } from './service'

// A separate data root (debugging, and trying the move from @myhey/desktop on a copy).
if (process.env.SUPERHEY_APP_DATA) {
  app.setPath('appData', process.env.SUPERHEY_APP_DATA)
  app.setPath('userData', join(process.env.SUPERHEY_APP_DATA, app.getName()))
}
// A separate data folder lets a second instance run beside a normal one (debugging).
if (process.env.SUPERHEY_USER_DATA) app.setPath('userData', process.env.SUPERHEY_USER_DATA)
// The app used to be "@myhey/desktop"; its data follows it to the SuperHey folder, once.
else {
  const moved = moveOldDataFolder(join(app.getPath('appData'), '@myhey', 'desktop'), app.getPath('userData'))
  if (moved === 'moved') console.log(`[data] moved the old @myhey/desktop folder to ${app.getPath('userData')}`)
}

const service = new AppService({
  dbPath: join(app.getPath('userData'), 'cache.db'),
  openFile: async (path) => {
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  },
  pickFiles: async () => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? [] : res.filePaths
  },
  secrets: keychainStore(join(app.getPath('userData'), 'secrets')),
})

// superhey-file://attachment/<id> serves cached attachments to the renderer (thumbnails).
const FILE_SCHEME = 'superhey-file'
protocol.registerSchemesAsPrivileged([
  { scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

async function serveFile(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.host === 'avatar') return serveAvatar(decodeURIComponent(url.pathname.slice(1)))
  if (url.host !== 'attachment') return new Response(null, { status: 404 })
  try {
    const file = await service.attachmentFile(decodeURIComponent(url.pathname.slice(1)))
    const body = await net.fetch(pathToFileURL(file.path).toString())
    return new Response(body.body, {
      headers: { ...fileHeaders(file.contentType, file.filename), 'access-control-allow-origin': '*' },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1b1d' : '#fbfbfa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Links in email open in the browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

ipcMain.handle('api', (_event, method: unknown, args: unknown) => {
  if (typeof method !== 'string' || !Array.isArray(args)) throw new Error('bad api call')
  return service.dispatch(method, args)
})

service.on('event', (event: ApiEvent) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('api:event', event)
})

async function serveAvatar(avatarUrl: string): Promise<Response> {
  const file = await service.avatarFile(avatarUrl).catch(() => null)
  if (!file) return new Response(null, { status: 404 })
  const body = await net.fetch(pathToFileURL(file.path).toString())
  return new Response(body.body, {
    headers: { 'content-type': file.contentType, 'cache-control': 'private, max-age=86400', 'access-control-allow-origin': '*' },
  })
}

app.whenReady().then(() => {
  protocol.handle(FILE_SCHEME, serveFile)
  createWindow()
  void service.boot()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// A message in its undo window was sent on purpose, so quitting delivers it first; with
// nothing pending, quitting is left alone. Delivery gets a time limit, then the app exits
// regardless, so quitting can never hang.
const FLUSH_LIMIT_MS = 15_000
let exiting = false
async function deliverThenExit() {
  if (exiting) return
  exiting = true
  await Promise.race([service.flushOutbox(), new Promise((r) => setTimeout(r, FLUSH_LIMIT_MS))]).catch(() => {})
  service.stop()
  app.exit(0)
}
app.on('before-quit', (event) => {
  if (!service.hasPendingSends()) return service.stop()
  event.preventDefault()
  void deliverThenExit()
})
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void deliverThenExit())
process.on('exit', () => service.stop())
