/**
 * TorrentStreamer — Settings Manager
 * JSON file-based persistent settings with portable mode support
 */
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const DEFAULTS = {
  playerPath: '',
  playerArgs: '',
  downloadPath: path.join(os.homedir(), 'Downloads'),
  launchDelay: 10,
  autoLaunch: true,
  streamOnly: false,
  theme: 'dark',
  minimizeToTray: false,
  bufferThresholdMB: 1,
  maxConnections: 200,
  maxDownloadSpeed: 0,
  maxUploadSpeed: 0
}

class SettingsManager {
  constructor() {
    const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR
    this.dataDir = isPortable
      ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'TorrentStreamer_Data')
      : path.join(app.getPath('userData'))
    fs.mkdirSync(this.dataDir, { recursive: true })
    this.filePath = path.join(this.dataDir, 'settings.json')
    this.data = this._load()
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8')
        return { ...DEFAULTS, ...JSON.parse(raw) }
      }
    } catch (e) {
      console.error('[Settings] Load error:', e.message)
    }
    return { ...DEFAULTS }
  }

  _save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (e) {
      console.error('[Settings] Save error:', e.message)
    }
  }

  getAll() { return { ...this.data } }

  get(key) { return this.data[key] ?? DEFAULTS[key] }

  set(key, value) {
    this.data[key] = value
    this._save()
  }

  update(partial) {
    this.data = { ...this.data, ...partial }
    this._save()
  }

  getDataDir() { return this.dataDir }
}

module.exports = { SettingsManager }
