# MultiMetro

A metronome that follows a song instead of a single tempo. Build a structure —
`4/4 at 120 for 4 measures`, then `3/4 at 120 for 4`, then `4/4 at 80 for 2` —
hit play, and it clicks through the whole thing. A whole band can click
together, in time, from their own phones.

- Per-section tempo, time signature and measure count
- Reorder, duplicate, tap tempo
- Count-in, loop, volume, visual beat dots and progress
- Distinct clicks for section start, downbeat and off-beats
- Keep as many songs as you like — every edit saves to localStorage
- Band sync: one room code, one press of play, everyone starts together
- Share links and JSON import/export for moving songs between devices
- Tailwind + daisyUI, follows your system light/dark setting

Tempo is beats of the _lower_ number of the time signature: 120 in 6/8 means
120 eighth notes.

## Songs

The picker in the top bar switches songs; the ⋯ menu creates, duplicates and
deletes them. Rename by editing the title above the section list. Everything
lives in this browser's localStorage, so use **Copy share link** or **Export
JSON** to move a song somewhere else.

## Band sync

Everyone opens the app, types the same room code and taps **Join** (🎲 makes up
a code, and **Copy room link** gives the rest of the band a link that fills the
code in for them). After that, whoever presses play starts the click on every
device at once, and whoever presses stop stops it everywhere.

How it holds together:

- The room is a Durable Object, and it is the clock everyone trusts. Each
  device measures its offset from that clock with repeated round trips and
  keeps the least distorted sample — mini NTP over the same socket.
- Pressing play does not start anything locally. It asks the room to start
  1.2 s from now, on the room's clock; the room tells everyone, and each device
  converts that instant into its own audio clock. The network is never in the
  audio path after that, so jitter afterwards cannot smear the beat.
- Device clocks drift a millisecond or two a minute, so every clock probe
  nudges the running grid back into place, capped at 20 ms a time so a bad
  sample can never lurch the beat.
- Join mid-song and the grid winds forward to wherever the room already is —
  you land in the right bar. Same if you tap play while the room is already
  going: you catch up instead of restarting everyone.
- Whoever presses play sends their arrangement with it. It loads on everyone
  else marked _(room)_ and is **not** saved into their library unless they tap
  **Save this arrangement to my songs**.

Expect the starts to land within roughly 5–15 ms of each other. That is tight
for a click in in-ears; it says nothing about four phone speakers in a room,
which flam from the speed of sound alone (~3 ms per metre) no matter how good
the sync is. Use headphones.

Tapping **Join** is also what lets a phone make sound later — browsers only
allow audio after a tap, so a device that never tapped anything cannot be
started remotely.

## Run locally

```sh
npm run dev
```

Wrangler serves `public/` and the Worker together at http://localhost:8787,
Durable Object and all.

## Deploy

One Worker serves the static app _and_ the sync API:

```sh
npm run deploy
```

The first run asks you to log into Cloudflare. Durable Objects are SQLite-backed
(`wrangler.jsonc`), which the free plan covers.

## Layout

```
public/          the app — plain ES modules, no build step
  index.html
  js/app.js        UI, song library, room wiring
  js/metronome.js  Web Audio scheduler
  js/sync.js       room socket + clock offset
worker/
  index.js         static assets + /api routes
  room.js          Room durable object: the band's clock and message bus
wrangler.jsonc
```
