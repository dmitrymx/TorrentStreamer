/**
 * TorrentStreamer — Preload Script
 * Secure bridge between main and renderer via contextBridge
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {

  /* ── Window Controls ─────────────────────────────────────── */
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    enableTray: () => ipcRenderer.send('tray:enable'),
    disableTray: () => ipcRenderer.send('tray:disable')
  },

  /* ── Torrent ──────────────────────────────────────────────── */
  torrent: {
    add: (source, downloadPath, streamOnly) => ipcRenderer.invoke('torrent:add', source, downloadPath, streamOnly),
    cancel: () => ipcRenderer.invoke('torrent:cancel'),
    getActive: () => ipcRenderer.invoke('torrent:getActive'),
    onProgress: (cb) => {
      const handler = (_e, data) => cb(data)
      ipcRenderer.on('torrent:progress', handler)
      return () => ipcRenderer.removeListener('torrent:progress', handler)
    },
    onFiles: (cb) => {
      const handler = (_e, files, audioCount) => cb(files, audioCount)
      ipcRenderer.on('torrent:files', handler)
      return () => ipcRenderer.removeListener('torrent:files', handler)
    },
    onCover: (cb) => {
      const handler = (_e, coverPath) => cb(coverPath)
      ipcRenderer.on('torrent:cover', handler)
      return () => ipcRenderer.removeListener('torrent:cover', handler)
    },
    onStreamReady: (cb) => {
      const handler = (_e, streamUrls) => cb(streamUrls)
      ipcRenderer.on('torrent:streamReady', handler)
      return () => ipcRenderer.removeListener('torrent:streamReady', handler)
    },
    onPlayerLaunched: (cb) => {
      const handler = () => cb()
      ipcRenderer.on('torrent:playerLaunched', handler)
      return () => ipcRenderer.removeListener('torrent:playerLaunched', handler)
    },
    onDone: (cb) => {
      const handler = () => cb()
      ipcRenderer.on('torrent:done', handler)
      return () => ipcRenderer.removeListener('torrent:done', handler)
    },
    onError: (cb) => {
      const handler = (_e, msg) => cb(msg)
      ipcRenderer.on('torrent:error', handler)
      return () => ipcRenderer.removeListener('torrent:error', handler)
    }
  },

  /* ── Player ───────────────────────────────────────────────── */
  player: {
    detect: () => ipcRenderer.invoke('player:detect'),
    launch: (filePaths) => ipcRenderer.invoke('player:launch', filePaths)
  },

  /* ── Settings ─────────────────────────────────────────────── */
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (data) => ipcRenderer.invoke('settings:set', data)
  },

  /* ── Dialogs ──────────────────────────────────────────────── */
  dialog: {
    selectDir: () => ipcRenderer.invoke('dialog:selectDir'),
    selectFile: () => ipcRenderer.invoke('dialog:selectFile'),
    selectTorrent: () => ipcRenderer.invoke('dialog:selectTorrent')
  },

  /* ── Shell ────────────────────────────────────────────────── */
  shell: {
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
    showInFolder: (p) => ipcRenderer.invoke('shell:showItemInFolder', p)
  }
})
