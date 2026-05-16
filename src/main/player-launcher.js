/**
 * TorrentStreamer — Player Launcher
 * Detects and launches external audio players with proper CLI arguments
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const KNOWN_PLAYERS = [
  {
    name: 'foobar2000',
    id: 'foobar2000',
    paths: [
      'C:\\Program Files\\foobar2000\\foobar2000.exe',
      'C:\\Program Files (x86)\\foobar2000\\foobar2000.exe',
      path.join(process.env.LOCALAPPDATA || '', 'foobar2000\\foobar2000.exe')
    ],
    // foobar2000: /add adds to playlist, /play starts playback
    buildArgs: (files) => ['/add', ...files, '/play']
  },
  {
    name: 'foobar2000 v2',
    id: 'foobar2000v2',
    paths: [
      'C:\\Program Files\\foobar2000 v2\\foobar2000.exe',
      path.join(process.env.LOCALAPPDATA || '', 'foobar2000 v2\\foobar2000.exe')
    ],
    // /replace clears old playlist (prevents stale HTTP URLs on restart)
    buildArgs: (files) => ['/replace', ...files, '/play']
  },
  {
    name: 'AIMP',
    id: 'aimp',
    paths: [
      'C:\\Program Files\\AIMP\\AIMP.exe',
      'C:\\Program Files (x86)\\AIMP\\AIMP.exe'
    ],
    // AIMP: /ADD_PLAY adds and starts playback
    buildArgs: (files) => ['/ADD_PLAY', ...files]
  },
  {
    name: 'VLC',
    id: 'vlc',
    paths: [
      'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
      'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'
    ],
    // VLC: --one-instance so it adds to running instance, --playlist-enqueue to add
    buildArgs: (files) => ['--one-instance', ...files]
  },
  {
    name: 'Winamp',
    id: 'winamp',
    paths: [
      'C:\\Program Files\\Winamp\\winamp.exe',
      'C:\\Program Files (x86)\\Winamp\\winamp.exe'
    ],
    // Winamp: /ADD enqueues files
    buildArgs: (files) => ['/ADD', ...files]
  },
  {
    name: 'MPC-HC',
    id: 'mpc-hc',
    paths: [
      'C:\\Program Files\\MPC-HC\\mpc-hc64.exe',
      'C:\\Program Files (x86)\\MPC-HC\\mpc-hc.exe'
    ],
    // MPC-HC: just pass files
    buildArgs: (files) => files
  },
  {
    name: 'KMPlayer',
    id: 'kmplayer',
    paths: [
      'C:\\Program Files\\KMPlayer\\KMPlayer.exe',
      'C:\\Program Files (x86)\\KMPlayer\\KMPlayer.exe'
    ],
    buildArgs: (files) => files
  }
]

/**
 * Detect installed audio players
 * @returns {{ name: string, path: string }[]}
 */
function detectPlayers() {
  const found = []
  for (const player of KNOWN_PLAYERS) {
    for (const p of player.paths) {
      try {
        if (fs.existsSync(p)) {
          found.push({ name: player.name, path: p })
          break
        }
      } catch {}
    }
  }
  return found
}

/**
 * Identify which known player is being used by its path
 * @param {string} playerPath
 * @returns {object|null}
 */
function identifyPlayer(playerPath) {
  const baseName = path.basename(playerPath).toLowerCase()
  for (const player of KNOWN_PLAYERS) {
    for (const knownPath of player.paths) {
      if (playerPath.toLowerCase() === knownPath.toLowerCase()) {
        return player
      }
    }
  }
  // Fallback: match by executable name
  if (baseName.includes('foobar')) {
    return KNOWN_PLAYERS.find(p => p.id === 'foobar2000')
  }
  if (baseName.includes('aimp')) {
    return KNOWN_PLAYERS.find(p => p.id === 'aimp')
  }
  if (baseName.includes('vlc')) {
    return KNOWN_PLAYERS.find(p => p.id === 'vlc')
  }
  if (baseName.includes('winamp')) {
    return KNOWN_PLAYERS.find(p => p.id === 'winamp')
  }
  return null
}

/**
 * Launch an audio player with given file paths
 * @param {string} playerPath - Path to player executable
 * @param {string[]} filePaths - Audio file paths to open
 * @param {string} [extraArgs=''] - Extra CLI arguments (user override)
 * @returns {{ success: boolean, error?: string }}
 */
function launchPlayer(playerPath, filePaths, extraArgs = '') {
  if (!playerPath) {
    return { success: false, error: 'Путь к плееру не указан' }
  }

  if (!fs.existsSync(playerPath)) {
    return { success: false, error: `Плеер не найден: ${playerPath}` }
  }

  if (!filePaths || filePaths.length === 0) {
    return { success: false, error: 'Нет файлов для воспроизведения' }
  }

  // Separate HTTP URLs from local file paths
  const httpUrls = filePaths.filter(f => f.startsWith('http://') || f.startsWith('https://'))
  const localFiles = filePaths.filter(f => !f.startsWith('http://') && !f.startsWith('https://'))
  
  // For local files, check they exist on disk
  const existingLocal = localFiles.filter(f => {
    try { return fs.existsSync(f) } catch { return false }
  })

  // Combine: HTTP URLs + existing local files
  const validFiles = [...httpUrls, ...existingLocal]

  if (validFiles.length === 0) {
    return { success: false, error: 'Нет доступных файлов для воспроизведения' }
  }

  try {
    let args = []

    // If user specified custom args, use them directly
    if (extraArgs && extraArgs.trim()) {
      args.push(...extraArgs.split(' ').filter(Boolean))
      args.push(...validFiles)
    } else {
      // Auto-detect player and use optimal arguments
      const knownPlayer = identifyPlayer(playerPath)
      if (knownPlayer && knownPlayer.buildArgs) {
        args = knownPlayer.buildArgs(validFiles)
        console.log(`[Player] Detected ${knownPlayer.name} — using optimized CLI args`)
      } else {
        // Unknown player: just pass files
        args.push(...validFiles)
        console.log('[Player] Unknown player — passing files directly')
      }
    }

    const isStreaming = httpUrls.length > 0
    console.log(`[Player] Launching: ${path.basename(playerPath)} (${isStreaming ? 'HTTP streaming' : 'local files'})`)
    console.log(`[Player] Args: ${args.slice(0, 3).join(' ')}${args.length > 3 ? ` ... (${args.length} total)` : ''}`)

    const child = spawn(playerPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    child.unref()

    console.log(`[Player] Launched: ${path.basename(playerPath)} with ${validFiles.length} item(s)`)
    return { success: true }
  } catch (e) {
    console.error('[Player] Launch error:', e.message)
    return { success: false, error: e.message }
  }
}

module.exports = { detectPlayers, launchPlayer }
