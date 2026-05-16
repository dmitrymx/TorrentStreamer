/**
 * TorrentStreamer — Logger
 * File-based logging with console interception and export
 */
const fs = require('fs')
const path = require('path')

class Logger {
  constructor(dataDir) {
    this.logDir = path.join(dataDir, 'logs')
    fs.mkdirSync(this.logDir, { recursive: true })
    this.logFile = path.join(this.logDir, 'app.log')

    // Rotate if > 2MB
    try {
      if (fs.existsSync(this.logFile)) {
        const stat = fs.statSync(this.logFile)
        if (stat.size > 2 * 1024 * 1024) {
          const old = this.logFile + '.old'
          if (fs.existsSync(old)) fs.unlinkSync(old)
          fs.renameSync(this.logFile, old)
        }
      }
    } catch {}

    // Write session header
    this._appendLine(`\n${'='.repeat(60)}`)
    this._appendLine(`SESSION START — ${new Date().toISOString()}`)
    this._appendLine(`Platform: ${process.platform} | Arch: ${process.arch} | Electron: ${process.versions.electron}`)
    this._appendLine(`Node: ${process.versions.node} | Chrome: ${process.versions.chrome}`)
    this._appendLine(`${'='.repeat(60)}\n`)

    // Intercept console methods
    const origLog = console.log.bind(console)
    const origError = console.error.bind(console)
    const origWarn = console.warn.bind(console)

    console.log = (...args) => {
      origLog(...args)
      this._write('INFO', args)
    }
    console.error = (...args) => {
      origError(...args)
      this._write('ERROR', args)
    }
    console.warn = (...args) => {
      origWarn(...args)
      this._write('WARN', args)
    }

    // Catch uncaught exceptions
    process.on('uncaughtException', (err) => {
      this._write('FATAL', [`Uncaught Exception: ${err.message}`, err.stack])
      origError('FATAL:', err)
    })
    process.on('unhandledRejection', (reason) => {
      this._write('FATAL', [`Unhandled Rejection: ${reason}`])
      origError('FATAL Rejection:', reason)
    })
  }

  _write(level, args) {
    const ts = new Date().toISOString().replace('T', ' ').replace('Z', '')
    const msg = args.map(a => {
      if (a instanceof Error) return `${a.message}\n${a.stack}`
      if (typeof a === 'object') {
        try { return JSON.stringify(a) } catch { return String(a) }
      }
      return String(a)
    }).join(' ')
    this._appendLine(`[${ts}] [${level}] ${msg}`)
  }

  _appendLine(line) {
    try {
      fs.appendFileSync(this.logFile, line + '\n', 'utf-8')
    } catch {}
  }

  getLogPath() { return this.logFile }

  getLogContent() {
    try {
      if (fs.existsSync(this.logFile)) {
        return fs.readFileSync(this.logFile, 'utf-8')
      }
    } catch {}
    return 'Логи отсутствуют'
  }
}

module.exports = { Logger }
