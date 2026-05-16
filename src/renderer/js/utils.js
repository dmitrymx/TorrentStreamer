/* ══════════════════════════════════════════════════════════════
   TorrentStreamer — Utilities
   ══════════════════════════════════════════════════════════════ */

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'КБ', 'МБ', 'ГБ', 'ТБ']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec === 0) return '0 B/s'
  return formatBytes(bytesPerSec) + '/s'
}

function formatETA(seconds) {
  if (!seconds || seconds <= 0 || seconds === Infinity) return '--:--'
  if (seconds > 86400) return '> 1д'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}ч ${m}м`
  if (m > 0) return `${m}м ${s}с`
  return `${s}с`
}

function isAudioFile(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  return ['mp3','flac','wav','ogg','m4a','aac','ape','wv','wma','opus','alac','aiff','dsf','dff'].includes(ext)
}

function getFileIcon(filename) {
  if (isAudioFile(filename)) return '🎵'
  const ext = filename.split('.').pop().toLowerCase()
  if (['jpg','jpeg','png','gif','bmp','webp'].includes(ext)) return '🖼️'
  if (['txt','nfo','log','md'].includes(ext)) return '📄'
  if (['cue'].includes(ext)) return '📋'
  return '📁'
}
