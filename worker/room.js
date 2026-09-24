// One Durable Object per room code. It is the room's clock and its message
// bus: every timestamp on the wire is this object's Date.now(), so the clients
// only ever have to measure their offset from it.

const MAX_MEMBERS = 16

export class Room {
  constructor(state) {
    this.state = state
    this.song = null // arrangement last played in the room
    this.playing = null // { startAt, loop } while a run is in flight
    this.loaded = this.state.blockConcurrencyWhile(async () => {
      this.song = (await this.state.storage.get('song')) || null
      this.playing = (await this.state.storage.get('playing')) || null
    })
  }

  async fetch(request) {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 })
    }
    await this.loaded

    if (this.state.getWebSockets().length >= MAX_MEMBERS) {
      return new Response('room is full', { status: 503 })
    }

    const pair = new WebSocketPair()
    this.state.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ name: 'Someone', joined: Date.now() })

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(ws, raw) {
    let message
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }

    switch (message.type) {
      // Clock probe: echo the client's stamp alongside ours so it can work out
      // its offset from round-trip time.
      case 'ping':
        return ws.send(JSON.stringify({ type: 'pong', t0: message.t0, server: Date.now() }))

      case 'hello': {
        ws.serializeAttachment({ ...ws.deserializeAttachment(), name: String(message.name || 'Someone').slice(0, 24) })
        ws.send(JSON.stringify({ type: 'welcome', server: Date.now(), song: this.song, playing: this.playing }))
        return this.broadcast({ type: 'members', members: this.members() })
      }

      case 'play': {
        const startAt = Number(message.startAt)
        if (!Number.isFinite(startAt)) return
        if (message.song) {
          this.song = message.song
          await this.state.storage.put('song', this.song)
        }
        this.playing = { startAt, loop: !!message.loop, countIn: !!message.countIn, by: this.nameOf(ws) }
        await this.state.storage.put('playing', this.playing)
        return this.broadcast({ type: 'play', ...this.playing, song: this.song })
      }

      case 'stop':
        this.playing = null
        await this.state.storage.delete('playing')
        return this.broadcast({ type: 'stop', by: this.nameOf(ws) })

      case 'song':
        if (!message.song) return
        this.song = message.song
        await this.state.storage.put('song', this.song)
        return this.broadcast({ type: 'song', song: this.song, by: this.nameOf(ws) }, ws)
    }
  }

  webSocketClose() {
    this.broadcast({ type: 'members', members: this.members() })
  }

  webSocketError() {
    this.broadcast({ type: 'members', members: this.members() })
  }

  nameOf(ws) {
    return (ws.deserializeAttachment() || {}).name || 'Someone'
  }

  members() {
    return this.state
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN)
      .map((ws) => this.nameOf(ws))
  }

  broadcast(message, except) {
    const payload = JSON.stringify(message)
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue
      try {
        ws.send(payload)
      } catch {
        // socket is on its way out; the close handler will tidy up
      }
    }
  }
}
