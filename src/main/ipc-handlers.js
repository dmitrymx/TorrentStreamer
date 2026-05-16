/**
 * TorrentStreamer — IPC Handlers
 * Bridges Main process ↔ Renderer
 */
const { ipcMain, dialog, shell } = require('electron')
const path = require('path')
const { detectPlayers, launchPlayer } = require('./player-launcher')

function registerIpcHandlers(engine, settings, getWindow) {

  /* ── Torrent ──────────────────────────────────────────────── */

  ipcMain.handle('torrent:add', async (_e, source, downloadPath, streamOnly) => {
    try {
      const info = await engine.addTorrent(source, downloadPath, streamOnly)
      return { success: true, data: info }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('torrent:cancel', () => {
    engine.cancel()
    return { success: true }
  })

  ipcMain.handle('torrent:getActive', () => {
    return engine.getActiveInfo()
  })

  /* ── Engine events → Renderer ─────────────────────────────── */

  engine.on('progress', (data) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('torrent:progress', data)
    }
  })

  engine.on('files', (files, audioCount) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('torrent:files', files, audioCount)
    }
  })

  engine.on('cover', (coverPath) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('torrent:cover', coverPath)
    }
  })

  // Stream URLs ready — audio can be played immediately via HTTP
  engine.on('streamReady', (streamUrls) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('torrent:streamReady', streamUrls)
    }

    // Auto-launch external player with HTTP stream URLs
    // foobar2000, VLC, AIMP, etc. all support HTTP URLs natively
    const playerPath = settings.get('playerPath')
    if (settings.get('autoLaunch') && !engine.playerLaunched && playerPath) {
      const delay = (settings.get('launchDelay') || 10) * 1000
      const httpUrls = streamUrls.map(s => s.url)
      console.log(`[IPC] Auto-launching external player in ${delay / 1000}s with ${httpUrls.length} stream URL(s)`)

      setTimeout(() => {
        if (engine.playerLaunched) return
        const result = launchPlayer(playerPath, httpUrls, settings.get('playerArgs'))
        engine.playerLaunched = true
        if (win && !win.isDestroyed()) {
          if (result.success) {
            win.webContents.send('torrent:playerLaunched')
          } else {
            win.webContents.send('torrent:error', `Ошибка запуска плеера: ${result.error}`)
          }
        }
      }, delay)
    } else if (!playerPath) {
      console.log('[IPC] No external player — built-in streaming player will handle playback')
    }
  })

  engine.on('done', (localPaths) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('torrent:done', localPaths)
    }
  })

  engine.on('error', (message) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('torrent:error', message)
    }
  })

  /* ── Player ───────────────────────────────────────────────── */

  ipcMain.handle('player:detect', () => {
    return detectPlayers()
  })

  ipcMain.handle('player:launch', (_e, filePaths) => {
    const playerPath = settings.get('playerPath')
    if (!playerPath) return { success: false, error: 'Плеер не настроен' }
    const result = launchPlayer(playerPath, filePaths || [], settings.get('playerArgs'))
    if (result.success) engine.playerLaunched = true
    return result
  })

  /* ── Settings ─────────────────────────────────────────────── */

  ipcMain.handle('settings:get', () => settings.getAll())

  ipcMain.handle('settings:set', (_e, data) => {
    settings.update(data)
    return { success: true }
  })

  /* ── Dialogs ──────────────────────────────────────────────── */

  ipcMain.handle('dialog:selectDir', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win, {
      title: 'Выберите папку для загрузки',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectFile', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win, {
      title: 'Выберите плеер',
      filters: [{ name: 'Приложения', extensions: ['exe'] }],
      properties: ['openFile']
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectTorrent', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win, {
      title: 'Выберите .torrent файл',
      filters: [{ name: 'Torrent файлы', extensions: ['torrent'] }],
      properties: ['openFile']
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  /* ── Shell ────────────────────────────────────────────────── */

  ipcMain.handle('shell:openPath', async (_e, filePath) => {
    try {
      await shell.openPath(filePath)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('shell:showItemInFolder', (_e, filePath) => {
    shell.showItemInFolder(filePath)
    return { success: true }
  })
}

module.exports = { registerIpcHandlers }
