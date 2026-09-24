# MultiMetro

A metronome that follows a song instead of a single tempo. Build a structure —
`4/4 at 120 for 4 measures`, then `3/4 at 120 for 4`, then `4/4 at 80 for 2` —
hit play, and it clicks through the whole thing.

- Per-section tempo, time signature and measure count
- Reorder, duplicate, tap tempo
- Count-in, loop, volume, visual beat dots and progress
- Distinct clicks for section start, downbeat and off-beats
- Keep as many songs as you like — every edit saves to localStorage
- Share links and JSON import/export for moving songs between devices
- Tailwind + daisyUI, follows your system light/dark setting

## Songs

The picker in the top bar switches songs; the ⋯ menu creates, duplicates and
deletes them. Rename by editing the title above the section list. Everything
lives in this browser's localStorage, so use **Copy share link** or **Export
JSON** to move a song somewhere else.

Tempo is beats of the _lower_ number of the time signature: 120 in 6/8 means
120 eighth notes.

## Run locally

```sh
npm start
```

(Any static server works — the app is plain ES modules, no build step.)

## Deploy to GitHub Pages

No build required. Push the repo, then **Settings → Pages → Source: Deploy from
a branch → `main` / `(root)`**. The included `.nojekyll` keeps Pages from
touching the files.
