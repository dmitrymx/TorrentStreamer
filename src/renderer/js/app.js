/* ══════════════════════════════════════════════════════════════
   TorrentStreamer — App Logic
   Main renderer-side application controller
   ══════════════════════════════════════════════════════════════ */

;(async function () {
  'use strict'

  const api = window.api

  /* ── State ──────────────────────────────────────────────── */
  let currentView = 'home'
  let isDownloading = false
  let activeTorrentInfo = null
  let currentAudioPaths = []
  let settings = {}

  // Built-in player state
  let bpPlaylist = []  // Array of { name, url, path }
  let bpIndex = 0
  let bpPlaying = false
  let streamUrls = []  // HTTP stream URLs from engine

  /* ── DOM refs ───────────────────────────────────────────── */
  const $ = (sel) => document.querySelector(sel)
  const $$ = (sel) => document.querySelectorAll(sel)

  const els = {
    // Nav
    navBtns: $$('.nav-btn'),
    navDownload: $('#nav-download'),
    // Home
    inputMagnet: $('#input-magnet'),
    inputPath: $('#input-path'),
    inputStreamOnly: $('#input-stream-only'),
    btnClearMagnet: $('#btn-clear-magnet'),
    btnTorrentFile: $('#btn-torrent-file'),
    btnPaste: $('#btn-paste'),
    btnBrowse: $('#btn-browse'),
    btnStream: $('#btn-stream'),
    // Download
    dlName: $('#dl-name'),
    dlStatus: $('#dl-status'),
    dlIcon: $('#dl-icon'),
    dlProgressFill: $('#dl-progress-fill'),
    dlProgressText: $('#dl-progress-text'),
    dlSpeedDown: $('#dl-speed-down'),
    dlSpeedUp: $('#dl-speed-up'),
    dlPeers: $('#dl-peers'),
    dlSize: $('#dl-size'),
    dlEta: $('#dl-eta'),
    dlFileList: $('#dl-file-list'),
    dlFileCount: $('#dl-file-count'),
    dlCover: $('#dl-cover'),
    btnCancel: $('#btn-cancel'),
    btnOpenPlayer: $('#btn-open-player'),
    btnOpenFolder: $('#btn-open-folder'),
    // Built-in player
    builtinPlayer: $('#builtin-player'),
    bpAudio: $('#bp-audio'),
    bpTrackName: $('#bp-track-name'),
    bpPlay: $('#bp-play'),
    bpPlayIcon: $('#bp-play-icon'),
    bpPrev: $('#bp-prev'),
    bpNext: $('#bp-next'),
    bpSeek: $('#bp-seek'),
    bpVolume: $('#bp-volume'),
    bpCurrent: $('#bp-current'),
    bpDuration: $('#bp-duration'),
    // Settings
    settingsPlayerPath: $('#settings-player-path'),
    settingsPlayerArgs: $('#settings-player-args'),
    settingsDelay: $('#settings-delay'),
    settingsAutoLaunch: $('#settings-auto-launch'),
    settingsDownloadPath: $('#settings-download-path'),
    settingsBuffer: $('#settings-buffer'),
    detectedPlayers: $('#detected-players'),
    btnBrowsePlayer: $('#btn-browse-player'),
    btnClearPlayer: $('#btn-clear-player'),
    btnBrowseDownload: $('#btn-browse-download'),
    btnSaveSettings: $('#btn-save-settings'),
    // Theme & Tray
    themeDark: $('#theme-dark'),
    themeLight: $('#theme-light'),
    settingsMinTray: $('#settings-minimize-tray'),
    // Window
    btnMinimize: $('#btn-minimize'),
    btnMaximize: $('#btn-maximize'),
    btnClose: $('#btn-close'),
    // Toast
    toastContainer: $('#toast-container')
  }

  /* ── Init ────────────────────────────────────────────────── */
  async function init() {
    await loadSettings()
    applyTheme(settings.theme || 'dark')
    bindEvents()
    bindTorrentEvents()
    bindBuiltinPlayer()
    detectPlayers()
  }

  /* ── Settings ───────────────────────────────────────────── */
  async function loadSettings() {
    settings = await api.settings.get()
    els.inputPath.value = settings.downloadPath || ''
    els.settingsPlayerPath.value = settings.playerPath || ''
    els.settingsPlayerArgs.value = settings.playerArgs || ''
    els.settingsDelay.value = settings.launchDelay ?? 10
    els.settingsAutoLaunch.checked = settings.autoLaunch !== false
    els.settingsDownloadPath.value = settings.downloadPath || ''
    els.settingsBuffer.value = settings.bufferThresholdMB ?? 1
    els.inputStreamOnly.checked = settings.streamOnly === true
    els.settingsMinTray.checked = settings.minimizeToTray === true
    updateThemeButtons(settings.theme || 'dark')
  }

  async function saveSettings() {
    const data = {
      playerPath: els.settingsPlayerPath.value,
      playerArgs: els.settingsPlayerArgs.value,
      launchDelay: parseInt(els.settingsDelay.value) || 10,
      autoLaunch: els.settingsAutoLaunch.checked,
      downloadPath: els.settingsDownloadPath.value,
      bufferThresholdMB: parseFloat(els.settingsBuffer.value) || 1,
      streamOnly: els.inputStreamOnly.checked,
      theme: document.documentElement.dataset.theme || 'dark',
      minimizeToTray: els.settingsMinTray.checked
    }
    await api.settings.set(data)
    settings = { ...settings, ...data }
    els.inputPath.value = data.downloadPath

    // Manage tray
    if (data.minimizeToTray) {
      api.window.enableTray()
    } else {
      api.window.disableTray()
    }

    toast('Настройки сохранены', 'success')
  }

  async function detectPlayers() {
    const players = await api.player.detect()
    els.detectedPlayers.innerHTML = ''
    if (players.length === 0) {
      els.detectedPlayers.innerHTML = '<span style="font-size:11px;color:var(--text-muted)">Установленные плееры не найдены — будет использован встроенный</span>'
      return
    }
    players.forEach(p => {
      const chip = document.createElement('div')
      chip.className = 'player-chip'
      chip.textContent = p.name
      chip.title = p.path
      chip.addEventListener('click', () => {
        els.settingsPlayerPath.value = p.path
        toast(`Выбран: ${p.name}`, 'info')
      })
      els.detectedPlayers.appendChild(chip)
    })
  }

  /** Check if we should use built-in player */
  function useBuiltinPlayer() {
    return !settings.playerPath
  }

  /* ── Theme ──────────────────────────────────────────────── */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme
    updateThemeButtons(theme)
  }

  function updateThemeButtons(theme) {
    els.themeDark.classList.toggle('active', theme === 'dark')
    els.themeLight.classList.toggle('active', theme === 'light')
  }

  /* ── Navigation ─────────────────────────────────────────── */
  function switchView(view) {
    currentView = view
    $$('.view').forEach(v => v.classList.remove('active'))
    $(`#view-${view}`).classList.add('active')

    els.navBtns.forEach(b => b.classList.remove('active'))
    const activeBtn = $(`[data-view="${view}"]`)
    if (activeBtn) activeBtn.classList.add('active')
  }

  /* ── Stream Action ──────────────────────────────────────── */
  let isConnecting = false

  async function startStream() {
    // If already connecting, cancel
    if (isConnecting) {
      cancelConnection()
      return
    }

    const magnet = els.inputMagnet.value.trim().replace(/[\r\n]+/g, '')
    els.inputMagnet.value = magnet  // update cleaned value in input
    const dlPath = els.inputPath.value.trim()

    if (!magnet) {
      toast('Вставьте магнет-ссылку или выберите .torrent файл', 'warning')
      els.inputMagnet.focus()
      return
    }
    if (!magnet.startsWith('magnet:') && !magnet.endsWith('.torrent')) {
      toast('Неверный формат. Используйте magnet: ссылку или .torrent файл', 'error')
      return
    }
    if (!dlPath) {
      toast('Укажите путь загрузки', 'warning')
      return
    }

    setStreamLoading(true)
    isConnecting = true

    const streamOnly = els.inputStreamOnly.checked
    const result = await api.torrent.add(magnet, dlPath, streamOnly)

    isConnecting = false

    if (!result.success) {
      toast(result.error || 'Ошибка добавления', 'error')
      setStreamLoading(false)
      return
    }

    activeTorrentInfo = result.data
    isDownloading = true
    currentAudioPaths = []
    bpPlaylist = []
    bpIndex = 0

    // Update download view
    els.dlName.textContent = result.data.name
    const badgeHtml = streamOnly ? ' <span class="stream-badge">ТОЛЬКО ПРОСЛУШИВАНИЕ</span>' : ''
    els.dlStatus.innerHTML = `${result.data.fileCount} файлов · ${result.data.audioFileCount} аудио${badgeHtml}`
    els.dlProgressFill.style.width = '0%'
    els.dlProgressText.textContent = '0%'
    els.dlFileList.innerHTML = '<div class="file-list-empty">Загрузка файлов...</div>'
    els.dlIcon.className = 'dl-icon pulse-anim'
    els.dlFileCount.textContent = ''
    els.dlCover.style.display = 'none'
    els.dlCover.src = ''
    els.builtinPlayer.style.display = 'none'

    // Show download nav and switch
    els.navDownload.style.display = ''
    switchView('download')
    setStreamLoading(false)
  }

  function setStreamLoading(loading) {
    els.btnStream.disabled = false  // always clickable (for cancel)
    els.btnStream.classList.toggle('loading', loading)
    const span = els.btnStream.querySelector('span')
    if (span) span.textContent = loading ? 'ОТМЕНИТЬ ✕' : 'СТРИМИТЬ'
  }

  /* ── Cancel Connection ─────────────────────────────────── */
  async function cancelConnection() {
    isConnecting = false
    await api.torrent.cancel()
    setStreamLoading(false)
    toast('Подключение отменено', 'info')
  }

  /* ── Cancel ─────────────────────────────────────────────── */
  async function cancelDownload() {
    await api.torrent.cancel()
    isDownloading = false
    activeTorrentInfo = null
    currentAudioPaths = []
    streamUrls = []
    bpStop()
    els.builtinPlayer.style.display = 'none'
    els.dlCover.style.display = 'none'
    els.dlCover.src = ''
    els.navDownload.style.display = 'none'
    switchView('home')
    toast('Загрузка отменена', 'info')
  }

  /* ── Progress Updates ───────────────────────────────────── */
  function onProgress(data) {
    if (!isDownloading) return

    els.dlProgressFill.style.width = data.percent + '%'
    els.dlProgressText.textContent = data.percent + '%'
    els.dlSpeedDown.textContent = formatSpeed(data.downloadSpeed)
    els.dlSpeedUp.textContent = formatSpeed(data.uploadSpeed)
    els.dlPeers.textContent = data.numPeers + ' пир' + pluralPeers(data.numPeers)
    els.dlSize.textContent = formatBytes(data.downloaded) + ' / ' + formatBytes(data.total)
    els.dlEta.textContent = formatETA(data.eta)

    if (data.done) {
      els.dlStatus.textContent = 'Загрузка завершена!'
    } else if (data.numPeers === 0) {
      els.dlStatus.textContent = 'Поиск пиров...'
    } else {
      els.dlStatus.textContent = `Скачивание · ${data.numPeers} пир${pluralPeers(data.numPeers)}`
    }

    if (data.files && data.files.length > 0) {
      renderFileList(data.files)
    }
  }

  function renderFileList(files) {
    const audioFiles = files.filter(f => f.isAudio)
    const otherFiles = files.filter(f => !f.isAudio)
    const sorted = [...audioFiles, ...otherFiles]

    els.dlFileCount.textContent = `${audioFiles.length} аудио · ${files.length} всего`

    let html = ''
    for (const f of sorted) {
      const icon = getFileIcon(f.name)
      const progressClass = f.progress >= 100 ? 'done' : (f.progress > 0 ? 'active' : '')
      const progressText = f.progress >= 100 ? '✓' : f.progress + '%'
      const audioClass = f.isAudio ? ' is-audio' : ''
      const clickable = f.isAudio ? ' clickable' : ''
      // Find stream URL for this file
      const streamInfo = streamUrls.find(s => s.path === f.path)
      const dataUrl = streamInfo ? ` data-stream-url="${streamInfo.url}"` : ''
      const dataName = f.isAudio ? ` data-filename="${f.name.replace(/"/g, '&quot;')}"` : ''

      html += `<div class="file-item${audioClass}${clickable}"${dataUrl}${dataName}>
        <span class="file-item-icon">${icon}</span>
        <span class="file-item-name" title="${f.path}">${f.name}</span>
        <span class="file-item-size">${formatBytes(f.size)}</span>
        <span class="file-item-progress ${progressClass}">${progressText}</span>
      </div>`
    }
    els.dlFileList.innerHTML = html

    // Bind click to stream audio files via HTTP (works while downloading!)
    els.dlFileList.querySelectorAll('.file-item.clickable').forEach(item => {
      item.addEventListener('dblclick', async () => {
        const url = item.dataset.streamUrl
        const name = item.dataset.filename
        if (!url) {
          toast('Стрим ещё не готов', 'warning')
          return
        }
        if (useBuiltinPlayer()) {
          // Built-in player: add to playlist and play
          const idx = bpPlaylist.findIndex(t => t.url === url)
          if (idx >= 0) {
            bpPlayTrack(idx)
          } else {
            bpPlaylist.push({ name, url })
            els.builtinPlayer.style.display = ''
            bpPlayTrack(bpPlaylist.length - 1)
          }
        } else {
          // External player: launch with this track's HTTP stream URL
          const result = await api.player.launch([url])
          if (!result.success) {
            toast(result.error || 'Ошибка запуска', 'error')
            return
          }
        }
        toast(`▶ ${name}`, 'info')
      })
    })
  }

  /* ══ BUILT-IN PLAYER ══════════════════════════════════════ */

  function bindBuiltinPlayer() {
    const audio = els.bpAudio

    // Play/Pause
    els.bpPlay.addEventListener('click', () => {
      if (bpPlaylist.length === 0) return
      if (bpPlaying) { audio.pause() } else { audio.play() }
    })

    // Prev / Next
    els.bpPrev.addEventListener('click', () => bpPlayTrack(bpIndex - 1))
    els.bpNext.addEventListener('click', () => bpPlayTrack(bpIndex + 1))

    // Seek
    els.bpSeek.addEventListener('input', () => {
      if (audio.duration) {
        audio.currentTime = (els.bpSeek.value / 100) * audio.duration
      }
    })

    // Volume
    els.bpVolume.addEventListener('input', () => {
      audio.volume = els.bpVolume.value / 100
    })
    audio.volume = 0.8

    // Audio events
    audio.addEventListener('play', () => {
      bpPlaying = true
      els.bpPlayIcon.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'
    })
    audio.addEventListener('pause', () => {
      bpPlaying = false
      els.bpPlayIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>'
    })
    audio.addEventListener('timeupdate', () => {
      if (audio.duration) {
        els.bpSeek.value = (audio.currentTime / audio.duration) * 100
        els.bpCurrent.textContent = fmtTime(audio.currentTime)
        els.bpDuration.textContent = fmtTime(audio.duration)
      }
    })
    audio.addEventListener('ended', () => {
      // Auto-next track
      if (bpIndex < bpPlaylist.length - 1) {
        bpPlayTrack(bpIndex + 1)
      }
    })
    audio.addEventListener('error', (e) => {
      console.log(`[Player] Playback error:`, bpPlaylist[bpIndex]?.name, e)
      // Auto-skip to next if available
      if (bpIndex < bpPlaylist.length - 1) {
        toast('Ошибка — переключаю на следующий', 'warning')
        setTimeout(() => bpPlayTrack(bpIndex + 1), 1000)
      }
    })
  }

  function bpLoadPlaylist(tracks) {
    // tracks = [{ name, url }, ...]
    bpPlaylist = tracks
    bpIndex = 0
    els.builtinPlayer.style.display = ''
    bpPlayTrack(0)
  }

  function bpPlayTrack(index) {
    if (index < 0 || index >= bpPlaylist.length) return
    bpIndex = index
    const track = bpPlaylist[bpIndex]
    els.bpTrackName.textContent = track.name
    els.bpAudio.src = track.url
    els.bpAudio.play().catch(() => {
      console.log('[Player] play() rejected for', track.name)
    })
  }

  function bpStop() {
    try { els.bpAudio.pause() } catch {}
    els.bpAudio.src = ''
    bpPlaylist = []
    bpPlaying = false
  }

  function fmtTime(sec) {
    if (!sec || isNaN(sec)) return '0:00'
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return m + ':' + s.toString().padStart(2, '0')
  }

  /* ── Torrent Events ─────────────────────────────────────── */
  function bindTorrentEvents() {
    api.torrent.onProgress(onProgress)

    api.torrent.onFiles((files, audioCount) => {
      if (files.length > 0) renderFileList(files)
    })

    api.torrent.onCover((coverDataUrl) => {
      if (coverDataUrl) {
        els.dlCover.src = coverDataUrl
        els.dlCover.style.display = ''
        els.dlIcon.style.display = 'none'
      }
    })

    // Stream URLs ready — can play ANY track immediately via HTTP
    api.torrent.onStreamReady((urls) => {
      streamUrls = urls
      currentAudioPaths = urls.map(u => u.path)
      console.log(`[App] Stream ready: ${urls.length} audio track(s)`)

      if (useBuiltinPlayer()) {
        // Build playlist from stream URLs and start playing first track
        const playlist = urls.map(u => ({ name: u.name, url: u.url }))
        toast(`🎵 ${urls.length} трек(ов) — начинаю воспроизведение!`, 'success')
        bpLoadPlaylist(playlist)
      } else {
        toast('Стрим готов! Ожидаю загрузку для плеера...', 'success')
      }
    })

    api.torrent.onPlayerLaunched(() => {
      toast('Внешний плеер запущен! 🎵', 'success')
    })

    api.torrent.onDone((localPaths) => {
      isDownloading = false
      els.dlIcon.className = 'dl-icon done-icon'
      els.dlStatus.textContent = 'Загрузка завершена! ✓'
      toast('Загрузка завершена!', 'success')

      // Keep streamUrls as HTTP URLs — they stay valid while the stream server is running.
      // External players should always use HTTP URLs to avoid "file in use" errors.
      if (localPaths && localPaths.length > 0) {
        currentAudioPaths = localPaths.map(f => f.filePath)

        // Only switch built-in player to local files (more stable for offline playback)
        if (useBuiltinPlayer() && bpPlaylist.length > 0) {
          const currentTime = els.bpAudio.currentTime
          const wasPlaying = bpPlaying
          const currentIdx = bpIndex

          bpPlaylist = localPaths.map(f => ({
            name: f.name,
            url: 'file:///' + f.filePath.replace(/\\/g, '/')
          }))

          // Restore playback position (seamless switch)
          if (currentIdx < bpPlaylist.length) {
            bpIndex = currentIdx
            els.bpAudio.src = bpPlaylist[bpIndex].url
            els.bpAudio.currentTime = currentTime
            if (wasPlaying) els.bpAudio.play().catch(() => {})
          }
          console.log('[App] Switched built-in player to local files')
        }
      }
    })

    api.torrent.onError((msg) => {
      toast(msg, 'error')
    })
  }

  /* ── Event Binding ──────────────────────────────────────── */
  function bindEvents() {
    // Window controls
    els.btnMinimize.addEventListener('click', () => api.window.minimize())
    els.btnMaximize.addEventListener('click', () => api.window.maximize())
    els.btnClose.addEventListener('click', () => api.window.close())

    // Navigation
    els.navBtns.forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view))
    })

    // Home - Paste
    els.btnPaste.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (text) {
          els.inputMagnet.value = text.replace(/[\r\n]+/g, '')
          if (text.startsWith('magnet:')) {
            toast('Ссылка вставлена', 'info')
          }
        }
      } catch {
        toast('Не удалось прочитать буфер обмена', 'warning')
      }
    })

    // Home - Clear magnet
    els.btnClearMagnet.addEventListener('click', () => {
      els.inputMagnet.value = ''
      els.inputMagnet.focus()
    })

    // Home - Browse .torrent file
    els.btnTorrentFile.addEventListener('click', async () => {
      const file = await api.dialog.selectTorrent()
      if (file) {
        els.inputMagnet.value = file
        toast('.torrent файл выбран', 'info')
      }
    })

    // Home - Browse folder
    els.btnBrowse.addEventListener('click', async () => {
      const dir = await api.dialog.selectDir()
      if (dir) els.inputPath.value = dir
    })

    // Home - Stream
    els.btnStream.addEventListener('click', startStream)

    // Enter key on magnet input
    els.inputMagnet.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startStream()
    })

    // Download - Cancel
    els.btnCancel.addEventListener('click', cancelDownload)

    // Download - Open Player (manual) — always use HTTP stream URLs
    els.btnOpenPlayer.addEventListener('click', async () => {
      if (streamUrls.length === 0) {
        toast('Нет готовых аудио-файлов', 'warning')
        return
      }
      if (useBuiltinPlayer()) {
        const playlist = streamUrls.map(u => ({ name: u.name, url: u.url }))
        bpLoadPlaylist(playlist)
        toast('Встроенный плеер запущен', 'success')
      } else {
        // Send HTTP streaming URLs to external player (not local paths!)
        // Local files may be locked by WebTorrent causing "file in use" errors
        const httpUrls = streamUrls.map(u => u.url)
        const result = await api.player.launch(httpUrls)
        if (result.success) {
          toast('Плеер запущен', 'success')
        } else {
          toast(result.error || 'Ошибка запуска', 'error')
        }
      }
    })

    // Download - Open Folder (open actual torrent folder, not root download dir)
    els.btnOpenFolder.addEventListener('click', () => {
      if (activeTorrentInfo && activeTorrentInfo.torrentFolder) {
        api.shell.openPath(activeTorrentInfo.torrentFolder)
      } else if (activeTorrentInfo) {
        // Fallback: open download dir from settings
        api.shell.openPath(els.inputPath.value)
      }
    })

    // Settings - Browse player
    els.btnBrowsePlayer.addEventListener('click', async () => {
      const file = await api.dialog.selectFile()
      if (file) els.settingsPlayerPath.value = file
    })

    // Settings - Clear player (use built-in)
    els.btnClearPlayer.addEventListener('click', () => {
      els.settingsPlayerPath.value = ''
      toast('Плеер сброшен на встроенный', 'info')
    })

    // Settings - Browse download dir
    els.btnBrowseDownload.addEventListener('click', async () => {
      const dir = await api.dialog.selectDir()
      if (dir) els.settingsDownloadPath.value = dir
    })

    // Settings - Save
    els.btnSaveSettings.addEventListener('click', saveSettings)

    // Settings - Export logs
    const btnExportLogs = document.getElementById('btn-export-logs')
    if (btnExportLogs) {
      btnExportLogs.addEventListener('click', async () => {
        const result = await api.logs.export()
        if (result.success) {
          toast(`Логи сохранены: ${result.path}`, 'success')
        } else if (result.error) {
          toast(`Ошибка: ${result.error}`, 'error')
        }
      })
    }

    // Theme switcher
    els.themeDark.addEventListener('click', () => applyTheme('dark'))
    els.themeLight.addEventListener('click', () => applyTheme('light'))
  }

  /* ── Toasts ─────────────────────────────────────────────── */
  function toast(message, type = 'info') {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' }
    const el = document.createElement('div')
    el.className = `toast ${type}`
    el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${message}</span>`
    els.toastContainer.appendChild(el)

    setTimeout(() => {
      el.classList.add('removing')
      setTimeout(() => el.remove(), 250)
    }, 3500)
  }

  /* ── Helpers ────────────────────────────────────────────── */
  function pluralPeers(n) {
    if (n % 10 === 1 && n % 100 !== 11) return ''
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'а'
    return 'ов'
  }

  /* ── Start ──────────────────────────────────────────────── */
  init()
})()
