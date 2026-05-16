/**
 * TorrentStreamer — Torrent Engine
 * WebTorrent wrapper with HTTP streaming server for real-time playback
 */
const path = require('path')
const fs = require('fs')
const os = require('os')

const COVER_NAMES = [
  'cover', 'folder', 'front', 'artwork', 'albumart', 'album',
  'thumb', 'scan', 'booklet'
]
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp']

const AUDIO_EXTENSIONS = [
  '.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac',
  '.ape', '.wv', '.wma', '.opus', '.alac', '.aiff', '.dsf', '.dff'
]

const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'http://bt.t-ru.org/ann',
  'http://bt2.t-ru.org/ann',
  'http://bt3.t-ru.org/ann',
  'http://bt4.t-ru.org/ann'
]

class TorrentEngine {
  constructor(settingsManager) {
    this.settings = settingsManager
    this.client = null
    this.activeTorrent = null
    this.progressInterval = null
    this.bufferReady = false
    this.playerLaunched = false
    this._onProgress = null
    this._onBufferReady = null
    this._onDone = null
    this._onError = null
    this._onFiles = null
    this._onCover = null
    this._onStreamReady = null
    this._ready = false
    this.streamOnly = false
    this.tempPath = null
    // HTTP streaming server
    this.streamServer = null
    this.streamPort = 0
  }

  async init() {
    const WebTorrent = (await import('webtorrent')).default
    const maxConns = this.settings.get('maxConnections') || 200
    this.client = new WebTorrent({ maxConns })
    this.client.on('error', (err) => {
      console.error('[Engine] Client error:', err.message)
      if (this._onError) this._onError(err.message)
    })

    // Start HTTP streaming server on a random available port
    await this._startStreamServer()

    this._ready = true
    console.log('[Engine] Initialized (WebTorrent)')
  }

  /** Start HTTP streaming server for real-time audio playback */
  async _startStreamServer() {
    return new Promise((resolve) => {
      try {
        const instance = this.client.createServer({ origin: 'http://localhost' })
        this.streamServer = instance
        // Listen on port 0 = OS picks a free port
        instance.server.listen(0, '127.0.0.1', () => {
          this.streamPort = instance.server.address().port
          console.log(`[Engine] Stream server listening on http://127.0.0.1:${this.streamPort}`)
          resolve()
        })
        instance.server.on('error', (err) => {
          console.error('[Engine] Stream server error:', err.message)
          resolve()
        })
      } catch (e) {
        console.error('[Engine] Failed to create stream server:', e.message)
        resolve()
      }
    })
  }

  /**
   * Add magnet link OR .torrent file and start sequential download
   * @param {string} source - magnet URI or path to .torrent file
   * @param {string} downloadPath
   * @returns {Promise<object>} Initial torrent info
   */
  addTorrent(source, downloadPath, streamOnly = false) {
    return new Promise((resolve, reject) => {
      if (!this._ready) return reject(new Error('Движок не инициализирован'))

      // Determine source type
      let torrentSource
      const isMagnet = source.startsWith('magnet:')
      const isTorrentFile = source.endsWith('.torrent') || fs.existsSync(source)

      if (isMagnet) {
        // Sanitize magnet URI: strip \r \n, empty tracker params, trailing &tr=
        torrentSource = source
          .replace(/[\r\n]+/g, '')          // remove carriage returns & newlines
          .replace(/&tr=(?=&|$)/g, '')      // remove empty &tr= params
          .replace(/&tr=$/, '')             // remove trailing &tr=
          .trim()
        console.log('[Engine] Adding magnet...')
      } else if (isTorrentFile) {
        try {
          torrentSource = fs.readFileSync(source)
          console.log('[Engine] Adding .torrent file:', path.basename(source))
        } catch (e) {
          return reject(new Error('Не удалось прочитать .torrent файл: ' + e.message))
        }
      } else {
        return reject(new Error('Неверный источник. Используйте магнет-ссылку или .torrent файл'))
      }

      // Cancel any active download first (also cleans up temp if needed)
      this.cancel()

      // Stream-only mode: use temp directory
      this.streamOnly = streamOnly
      let dest
      if (streamOnly) {
        this.tempPath = path.join(os.tmpdir(), 'TorrentStreamer_cache', Date.now().toString())
        dest = this.tempPath
        console.log('[Engine] Stream-only mode — temp path:', dest)
      } else {
        dest = downloadPath || this.settings.get('downloadPath')
        this.tempPath = null
      }
      fs.mkdirSync(dest, { recursive: true })

      this.bufferReady = false
      this.playerLaunched = false

      console.log('[Engine] Download path:', dest)

      // Metadata timeout (only meaningful for magnets)
      const metaTimeout = setTimeout(() => {
        if (this.activeTorrent && (!this.activeTorrent.name || this.activeTorrent.name === this.activeTorrent.infoHash)) {
          const msg = 'Не удалось получить метаданные за 90 секунд. Проверьте ссылку и наличие сидов.'
          console.error('[Engine]', msg)
          if (this._onError) this._onError(msg)
        }
      }, 90000)

      this.activeTorrent = this.client.add(torrentSource, {
        path: dest,
        strategy: 'sequential',
        announce: PUBLIC_TRACKERS,
        destroyStoreOnDestroy: false
      }, (torrent) => {
        clearTimeout(metaTimeout)
        console.log(`[Engine] Torrent ready: ${torrent.name} | ${torrent.files.length} files | ${torrent.length} bytes`)

        const audioFiles = this._getAudioFiles(torrent)
        const allFiles = this._getAllFilesInfo(torrent)

        if (this._onFiles) this._onFiles(allFiles, audioFiles.length)

        // Load cover art (streams via WebTorrent, sends as data URL)
        this._loadCoverArt(torrent)

        // Build stream URLs for audio files
        const streamUrls = this._getStreamUrls(torrent)
        if (streamUrls.length > 0 && this._onStreamReady) {
          this._onStreamReady(streamUrls)
        }

        // Start progress monitoring
        this._startProgressMonitor(torrent)

        resolve({
          name: torrent.name,
          infoHash: torrent.infoHash,
          size: torrent.length,
          fileCount: torrent.files.length,
          audioFileCount: audioFiles.length,
          files: allFiles
        })
      })

      this.activeTorrent.on('error', (err) => {
        clearTimeout(metaTimeout)
        console.error('[Engine] Torrent error:', err.message)
        if (this._onError) this._onError(err.message)
        reject(err)
      })

      this.activeTorrent.on('warning', (err) => {
        console.warn('[Engine] Warning:', err.message || err)
      })

      this.activeTorrent.on('done', () => {
        console.log('[Engine] Download complete!')

        // Force final progress update with all files at 100%
        const finalFiles = torrent.files.map((f, i) => ({
          index: i,
          name: f.name,
          path: f.path,
          size: f.length,
          progress: 100,
          isAudio: AUDIO_EXTENSIONS.includes(path.extname(f.name).toLowerCase()),
          fullPath: path.join(torrent.path, f.path)
        })).sort((a, b) => a.path.localeCompare(b.path))

        if (this._onProgress) this._onProgress({
          percent: 100,
          downloaded: torrent.length,
          total: torrent.length,
          downloadSpeed: 0,
          uploadSpeed: torrent.uploadSpeed,
          numPeers: torrent.numPeers,
          eta: 0,
          ratio: torrent.downloaded > 0 ? (torrent.uploaded / torrent.downloaded) : 0,
          files: finalFiles,
          done: true
        })

        // Collect local file paths for all audio files
        const audioFiles = this._getAudioFiles(torrent)
        const localPaths = audioFiles.map(f => ({
          name: f.name,
          path: f.path,
          filePath: path.join(torrent.path, f.path)
        }))
        if (this._onDone) this._onDone(localPaths)
      })
    })
  }

  /** Get streaming HTTP URLs for audio files using WebTorrent's native streamURL */
  _getStreamUrls(torrent) {
    if (!this.streamPort || !torrent) return []
    const audioFiles = this._getAudioFiles(torrent)
    return audioFiles.map(f => {
      // streamURL may contain backslashes on Windows — normalize to forward slashes
      const cleanUrl = (f.streamURL || '').replace(/\\/g, '/')
      return {
        name: f.name,
        path: f.path,
        size: f.length,
        url: `http://127.0.0.1:${this.streamPort}${cleanUrl}`
      }
    })
  }

  /** Start progress monitoring every 500ms */
  _startProgressMonitor(torrent) {
    if (this.progressInterval) clearInterval(this.progressInterval)

    this.progressInterval = setInterval(() => {
      if (!torrent || torrent.destroyed) {
        this._stopProgressMonitor()
        return
      }

      const progress = {
        percent: Math.round(torrent.progress * 1000) / 10,
        downloaded: torrent.downloaded,
        total: torrent.length,
        downloadSpeed: torrent.downloadSpeed,
        uploadSpeed: torrent.uploadSpeed,
        numPeers: torrent.numPeers,
        eta: torrent.timeRemaining ? Math.round(torrent.timeRemaining / 1000) : 0,
        ratio: torrent.downloaded > 0 ? (torrent.uploaded / torrent.downloaded) : 0,
        files: this._getAllFilesInfo(torrent),
        done: torrent.progress >= 1
      }

      if (this._onProgress) this._onProgress(progress)
    }, 500)
  }

  _stopProgressMonitor() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval)
      this.progressInterval = null
    }
  }

  /** Get audio files from torrent, sorted by path */
  _getAudioFiles(torrent) {
    if (!torrent || !torrent.files) return []
    return torrent.files
      .filter(f => AUDIO_EXTENSIONS.includes(path.extname(f.name).toLowerCase()))
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  /** Get all files info for UI */
  _getAllFilesInfo(torrent) {
    if (!torrent || !torrent.files) return []
    return torrent.files.map((f, i) => ({
      index: i,
      name: f.name,
      path: f.path,
      size: f.length,
      progress: Math.round(f.progress * 1000) / 10,
      isAudio: AUDIO_EXTENSIONS.includes(path.extname(f.name).toLowerCase()),
      fullPath: path.join(torrent.path, f.path)
    })).sort((a, b) => a.path.localeCompare(b.path))
  }

  /** Cancel the active download */
  cancel() {
    this._stopProgressMonitor()
    const shouldCleanup = this.streamOnly && this.tempPath
    if (this.activeTorrent && !this.activeTorrent.destroyed) {
      try {
        this.client.remove(this.activeTorrent.infoHash, { destroyStore: shouldCleanup })
      } catch (e) {
        console.error('[Engine] Cancel error:', e.message)
      }
    }
    this.activeTorrent = null
    this.bufferReady = false
    this.playerLaunched = false
    // Cleanup temp files if stream-only
    if (shouldCleanup) this._cleanupTemp()
  }

  /** Find cover art file in torrent (returns the WebTorrent file object) */
  _findCoverFile(torrent) {
    if (!torrent || !torrent.files) return null
    // Priority: files named cover/folder/front etc.
    for (const f of torrent.files) {
      const ext = path.extname(f.name).toLowerCase()
      if (!IMAGE_EXTENSIONS.includes(ext)) continue
      const baseName = path.basename(f.name, ext).toLowerCase()
      if (COVER_NAMES.some(cn => baseName.includes(cn))) {
        return f
      }
    }
    // Fallback: any image file
    for (const f of torrent.files) {
      const ext = path.extname(f.name).toLowerCase()
      if (IMAGE_EXTENSIONS.includes(ext)) {
        return f
      }
    }
    return null
  }

  /** Download cover art via WebTorrent streaming and emit as data URL */
  _loadCoverArt(torrent) {
    const coverFile = this._findCoverFile(torrent)
    if (!coverFile) return

    console.log(`[Engine] Loading cover art: ${coverFile.name} (${coverFile.length} bytes)`)

    // Prioritize the cover file for download
    coverFile.select()

    const chunks = []
    const stream = coverFile.createReadStream()
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks)
        const ext = path.extname(coverFile.name).toLowerCase()
        const mimeTypes = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp'
        }
        const mime = mimeTypes[ext] || 'image/jpeg'
        const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`
        console.log(`[Engine] Cover art loaded! (${buffer.length} bytes)`)
        if (this._onCover) this._onCover(dataUrl)
      } catch (e) {
        console.error('[Engine] Cover art encode error:', e.message)
      }
    })
    stream.on('error', (e) => {
      console.error('[Engine] Cover art stream error:', e.message)
    })
  }

  /** Delete temp files after stream-only session */
  _cleanupTemp() {
    if (!this.tempPath) return
    try {
      fs.rmSync(this.tempPath, { recursive: true, force: true })
      console.log('[Engine] Temp files cleaned:', this.tempPath)
    } catch (e) {
      console.error('[Engine] Cleanup error:', e.message)
    }
    this.tempPath = null
    this.streamOnly = false
  }

  /** Get current active torrent info */
  getActiveInfo() {
    if (!this.activeTorrent || this.activeTorrent.destroyed) return null
    const t = this.activeTorrent
    return {
      name: t.name || 'Загрузка метаданных...',
      infoHash: t.infoHash,
      size: t.length || 0,
      progress: Math.round(t.progress * 1000) / 10,
      downloadSpeed: t.downloadSpeed,
      uploadSpeed: t.uploadSpeed,
      numPeers: t.numPeers,
      done: t.progress >= 1
    }
  }

  /** Register event callbacks */
  on(event, callback) {
    switch (event) {
      case 'progress': this._onProgress = callback; break
      case 'bufferReady': this._onBufferReady = callback; break
      case 'streamReady': this._onStreamReady = callback; break
      case 'done': this._onDone = callback; break
      case 'error': this._onError = callback; break
      case 'files': this._onFiles = callback; break
      case 'cover': this._onCover = callback; break
    }
  }

  /** Graceful shutdown */
  async shutdown() {
    this._stopProgressMonitor()
    // Close HTTP streaming server
    if (this.streamServer) {
      try {
        this.streamServer.close()
        console.log('[Engine] Stream server closed')
      } catch {}
      this.streamServer = null
    }
    // Cleanup temp files
    if (this.streamOnly && this.tempPath) {
      this._cleanupTemp()
    }
    // Destroy WebTorrent client
    if (!this.client) return
    return new Promise((resolve) => {
      this.client.destroy((err) => {
        if (err) console.error('[Engine] Shutdown error:', err.message)
        console.log('[Engine] Shutdown complete')
        resolve()
      })
    })
  }
}

module.exports = { TorrentEngine }
