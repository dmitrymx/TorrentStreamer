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

/* ── App Icon Helper ──────────────────────────────────────── */
const fs = require('fs')

function getAppIcon() {
  // Build candidate paths — order matters, first match wins
  const candidates = [
    // Packaged portable: exe extracts to temp, resources/ is next to exe
    path.join(path.dirname(process.execPath), 'resources', 'icon.ico'),
    path.join(path.dirname(process.execPath), 'resources', 'icon.png'),
    // Standard packaged: process.resourcesPath is set by Electron
    path.join(process.resourcesPath || '', 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.png'),
    // Dev mode: relative to src/main/
    path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    path.join(__dirname, '..', '..', 'build', 'icon.png'),
    path.join(__dirname, '..', '..', 'assets', 'icon.png')
  ]

  for (const iconPath of candidates) {
    try {
      if (!fs.existsSync(iconPath)) continue
      const img = nativeImage.createFromPath(iconPath)
      if (!img.isEmpty()) {
        console.log('[Main] Icon loaded from:', iconPath)
        return img
      }
    } catch (e) {
      console.warn('[Main] Icon load failed:', iconPath, e.message)
    }
  }

  // Log all attempted paths for debugging
  console.warn('[Main] No icon file found, tried:', candidates.join(', '))
  console.warn('[Main] execPath:', process.execPath)
  console.warn('[Main] resourcesPath:', process.resourcesPath)
  console.warn('[Main] __dirname:', __dirname)

  // Fallback: generate a 32x32 teal circle
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  const cx = size / 2, cy = size / 2, r = size / 2 - 1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      const idx = (y * size + x) * 4
      if (dist <= r) {
        buf[idx] = 20; buf[idx + 1] = 184; buf[idx + 2] = 166; buf[idx + 3] = 255
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

/* ── Tray Icon ────────────────────────────────────────────── */
function setupTray() {
  if (tray) return

  const trayIcon = getAppIcon().resize({ width: 32, height: 32 })
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
  const appIcon = getAppIcon()

  mainWindow = new BrowserWindow({
    width: 920,
    height: 700,
    minWidth: 760,
    minHeight: 560,
    frame: false,
    icon: appIcon,
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
  const { Logger } = require('./logger')

  settingsManager = new SettingsManager()

  // Initialize logger FIRST so all console output is captured
  const logger = new Logger(settingsManager.getDataDir())
  console.log('[Main] App starting — v1.4.0')

  torrentEngine = new TorrentEngine(settingsManager)
  await torrentEngine.init()

  registerWindowIpc()
  registerIpcHandlers(torrentEngine, settingsManager, () => mainWindow, logger)

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
