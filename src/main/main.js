/**
 * TorrentStreamer — Main Process
 * Electron entry point
 */
const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron')
const path = require('path')

let mainWindow = null
let torrentEngine = null
let settingsManager = null
let tray = null
let isQuitting = false

/* ── Single Instance Lock ─────────────────────────────────── */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit() }

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

/* ── Tray Icon ────────────────────────────────────────────── */
function setupTray() {
  if (tray) return

  // Try loading the app icon from multiple possible locations
  // Prefer .ico on Windows for best tray rendering
  let trayIcon = null
  const iconPaths = [
    path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    path.join(__dirname, '..', '..', 'build', 'icon.png'),
    path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    path.join(process.resourcesPath || '', 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.ico'),
    path.join(app.getAppPath(), 'build', 'icon.png')
  ]

  for (const iconPath of iconPaths) {
    try {
      if (!require('fs').existsSync(iconPath)) continue
      const img = nativeImage.createFromPath(iconPath)
      if (!img.isEmpty()) {
        // Resize to proper tray size (32x32 for crisp rendering on Windows)
        trayIcon = img.resize({ width: 32, height: 32 })
        console.log('[Main] Tray icon loaded from:', iconPath)
        break
      }
    } catch {}
  }

  // Fallback: generate a 32x32 teal circle programmatically using raw RGBA buffer
  if (!trayIcon || trayIcon.isEmpty()) {
    const size = 32
    const buf = Buffer.alloc(size * size * 4) // RGBA
    const cx = size / 2, cy = size / 2, r = size / 2 - 1
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        const idx = (y * size + x) * 4
        if (dist <= r) {
          buf[idx] = 20     // R (teal)
          buf[idx + 1] = 184 // G
          buf[idx + 2] = 166 // B
          buf[idx + 3] = 255 // A
        } else {
          buf[idx + 3] = 0  // transparent
        }
      }
    }
    trayIcon = nativeImage.createFromBuffer(buf, { width: size, height: size })
    console.log('[Main] Using generated tray icon')
  }

  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    { label: '🎵 TorrentStreamer', enabled: false },
    { type: 'separator' },
    { label: 'Показать', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: 'Выход', click: () => { isQuitting = true; app.quit() } }
  ])
  tray.setToolTip('TorrentStreamer')
  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

function destroyTray() {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

/* ── Window Creation ──────────────────────────────────────── */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 700,
    minWidth: 760,
    minHeight: 560,
    frame: false,
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    // Setup tray if setting is enabled on startup
    if (settingsManager && settingsManager.get('minimizeToTray')) {
      setupTray()
      console.log('[Main] Tray enabled on startup')
    }
  })

  // Intercept close — hide to tray if tray is active
  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault()
      mainWindow.hide()
      console.log('[Main] Window hidden to tray')
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

/* ── Window Control IPC ───────────────────────────────────── */
function registerWindowIpc() {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.restore()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  // Tray management from renderer
  ipcMain.on('tray:enable', () => {
    setupTray()
    console.log('[Main] Tray enabled via settings')
  })
  ipcMain.on('tray:disable', () => {
    destroyTray()
    console.log('[Main] Tray disabled via settings')
  })
}

/* ── App Lifecycle ────────────────────────────────────────── */
app.whenReady().then(async () => {
  const { SettingsManager } = require('./settings')
  const { TorrentEngine } = require('./torrent-engine')
  const { registerIpcHandlers } = require('./ipc-handlers')

  settingsManager = new SettingsManager()
  torrentEngine = new TorrentEngine(settingsManager)
  await torrentEngine.init()

  registerWindowIpc()
  registerIpcHandlers(torrentEngine, settingsManager, () => mainWindow)

  createWindow()
})

app.on('before-quit', async (e) => {
  isQuitting = true
  if (torrentEngine) {
    e.preventDefault()
    try { await torrentEngine.shutdown() } catch {}
    destroyTray()
    app.exit(0)
  }
})

app.on('window-all-closed', () => {
  // Don't quit if tray is active (window is just hidden)
  if (!tray) {
    app.quit()
  }
})
