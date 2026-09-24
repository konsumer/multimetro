// Talks to the room Durable Object: one socket, a clock offset measured from
// it, and the start/stop messages the band shares.
//
// Every timestamp on the wire is the room's own Date.now(). `now()` converts
// this device's clock into that shared one, so "start at T" means the same
// instant on four different phones.

const PING_MS = 4000
const FAST_PINGS = 5
const SAMPLE_WINDOW = 8

export class Sync {
  constructor(handlers = {}) {
    this.handlers = handlers
    this.ws = null
    this.room = null
    this.name = 'Someone'
    this.samples = []
    this.offset = 0
    this.rtt = 0
    this.pinger = null
    this.retry = null
    this.attempts = 0
    this.wanted = false
  }

  get connected() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  // This device's clock, expressed in the room's clock.
  now() {
    return Date.now() + this.offset
  }

  join(room, name) {
    this.room = room.toUpperCase()
    this.name = name || this.name
    this.wanted = true
    this.attempts = 0
    this.open()
  }

  leave() {
    this.wanted = false
    clearTimeout(this.retry)
    clearInterval(this.pinger)
    this.samples = []
    this.offset = 0
    if (this.ws) this.ws.close()
    this.ws = null
    this.room = null
    this.status('Solo — not in a room')
    if (this.handlers.onMembers) this.handlers.onMembers([])
  }

  open() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    this.status(this.attempts ? 'Reconnecting…' : 'Connecting…')

    try {
      this.ws = new WebSocket(`${protocol}//${location.host}/api/room/${encodeURIComponent(this.room)}`)
    } catch (err) {
      console.warn('socket failed', err)
      return this.scheduleRetry()
    }

    this.ws.addEventListener('open', () => {
      this.attempts = 0
      this.send({ type: 'hello', name: this.name })
      this.startPinging()
    })

    this.ws.addEventListener('message', (event) => this.receive(event.data))

    this.ws.addEventListener('close', () => {
      clearInterval(this.pinger)
      if (this.handlers.onMembers) this.handlers.onMembers([])
      if (this.wanted) this.scheduleRetry()
    })

    this.ws.addEventListener('error', () => this.ws.close())
  }

  scheduleRetry() {
    clearTimeout(this.retry)
    const wait = Math.min(8000, 500 * 2 ** this.attempts++)
    this.status(`Disconnected — retrying in ${Math.round(wait / 1000)}s`)
    this.retry = setTimeout(() => this.wanted && this.open(), wait)
  }

  startPinging() {
    clearInterval(this.pinger)
    let fast = FAST_PINGS
    const beat = () => {
      this.send({ type: 'ping', t0: Date.now() })
      if (fast-- > 0) setTimeout(beat, 250)
    }
    beat()
    this.pinger = setInterval(() => this.send({ type: 'ping', t0: Date.now() }), PING_MS)
  }

  receive(raw) {
    let message
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }

    switch (message.type) {
      case 'pong':
        return this.measure(message)
      case 'welcome':
        this.status(`In room ${this.room}`)
        if (this.handlers.onWelcome) this.handlers.onWelcome(message)
        return
      case 'members':
        if (this.handlers.onMembers) this.handlers.onMembers(message.members || [])
        return
      case 'play':
        if (this.handlers.onPlay) this.handlers.onPlay(message)
        return
      case 'stop':
        if (this.handlers.onStop) this.handlers.onStop(message)
        return
      case 'song':
        if (this.handlers.onSong) this.handlers.onSong(message)
    }
  }

  // Mini NTP: the sample with the shortest round trip is the least distorted,
  // so trust that one and keep a small window so drift gets re-measured.
  measure({ t0, server }) {
    const t3 = Date.now()
    const rtt = t3 - t0
    this.samples.push({ rtt, offset: server - (t0 + t3) / 2 })
    if (this.samples.length > SAMPLE_WINDOW) this.samples.shift()

    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a))
    this.offset = best.offset
    this.rtt = best.rtt
    if (this.handlers.onClock) this.handlers.onClock({ offset: this.offset, rtt: this.rtt })
  }

  send(message) {
    if (this.connected) this.ws.send(JSON.stringify(message))
  }

  play({ startAt, loop, countIn, song }) {
    this.send({ type: 'play', startAt, loop, countIn, song })
  }

  stop() {
    this.send({ type: 'stop' })
  }

  pushSong(song) {
    this.send({ type: 'song', song })
  }

  status(text) {
    if (this.handlers.onStatus) this.handlers.onStatus(text)
  }
}

export function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}
