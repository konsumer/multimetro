// Serves the static app and the band-sync API from one Worker.
// Anything that is not a file in public/ lands here.

export { Room } from './room.js'

const ROOM_CODE = /^[A-Z0-9]{4,8}$/

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Clock reference for devices that cannot hold a socket open.
    if (url.pathname === '/api/time') {
      return Response.json({ now: Date.now() }, { headers: { 'cache-control': 'no-store' } })
    }

    const match = url.pathname.match(/^\/api\/room\/([^/]+)$/)
    if (match) {
      const code = decodeURIComponent(match[1]).toUpperCase()
      if (!ROOM_CODE.test(code)) return new Response('bad room code', { status: 400 })
      const room = env.ROOM.get(env.ROOM.idFromName(code))
      return room.fetch(request)
    }

    if (url.pathname.startsWith('/api/')) return new Response('not found', { status: 404 })

    return env.ASSETS.fetch(request)
  }
}
