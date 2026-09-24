import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import { fileHeaders, type ApiEvent } from '../shared/api'
import { AppService } from './service'

// A separate data folder lets a second instance run beside a normal one (debugging).
if (process.env.MYHEY_USER_DATA) app.setPath('userData', process.env.MYHEY_USER_DATA)

const service = new AppService({
  dbPath: join(app.getPath('userData'), 'cache.db'),
  openFile: async (path) => {
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  },
})

// myhey-file://attachment/<id> serves cached attachments to the renderer (thumbnails).
const FILE_SCHEME = 'myhey-file'
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

app.on('before-quit', () => service.stop())
process.on('exit', () => service.stop())
