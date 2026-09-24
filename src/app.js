import { Metronome } from './metronome.js'

const STORE_KEY = 'multimetro.library'
const LEGACY_KEY = 'multimetro.song'

const DEFAULT_SONG = {
  name: 'Untitled song',
  sections: [
    { id: uid(), name: 'Verse', bpm: 120, num: 4, den: 4, measures: 4 },
    { id: uid(), name: 'Bridge', bpm: 120, num: 3, den: 4, measures: 4 },
    { id: uid(), name: 'Outro', bpm: 80, num: 4, den: 4, measures: 2 }
  ]
}

const $ = (sel) => document.querySelector(sel)
const list = $('#sections')
const taps = new Map()

let library = loadLibrary()
let song = currentSong()
let offset = 0 // play-list index of song.sections[0] (1 when counting in)

const metro = new Metronome({ onBeat, onEnd: onStop })

function uid() {
  return Math.random().toString(36).slice(2, 9)
}

function clamp(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function time(seconds) {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function sectionSeconds(section) {
  return (section.num * section.measures * 60) / section.bpm
}

function songSeconds() {
  return song.sections.reduce((total, s) => total + sectionSeconds(s), 0)
}

function secondsBefore(index) {
  return song.sections.slice(0, index).reduce((total, s) => total + sectionSeconds(s), 0)
}

// --- storage & sharing ---------------------------------------------------

function normalizeSong(data, keepId = false) {
  const sections = (data && Array.isArray(data.sections) ? data.sections : []).map((s) => ({
    id: uid(),
    name: String(s.name || 'Section').slice(0, 40),
    bpm: clamp(s.bpm, 20, 400, 120),
    num: clamp(s.num, 1, 32, 4),
    den: [1, 2, 4, 8, 16].includes(Number(s.den)) ? Number(s.den) : 4,
    measures: clamp(s.measures, 1, 999, 4)
  }))
  if (!sections.length) return null
  return {
    id: keepId && data && typeof data.id === 'string' ? data.id : uid(),
    name: String((data && data.name) || 'Untitled song').slice(0, 60),
    updated: Number(data && data.updated) || Date.now(),
    sections
  }
}

function normalizeLibrary(data) {
  const seen = new Set()
  const songs = (data && Array.isArray(data.songs) ? data.songs : [])
    .map((s) => normalizeSong(s, true))
    .filter(Boolean)
    .map((s) => {
      if (seen.has(s.id)) s.id = uid()
      seen.add(s.id)
      return s
    })
  if (!songs.length) return null
  const wanted = songs.find((s) => s.id === (data.currentId || ''))
  return { songs, currentId: (wanted || songs[0]).id }
}

function defaultSong(name = 'Untitled song') {
  const fresh = normalizeSong(DEFAULT_SONG)
  fresh.name = name
  return fresh
}

// Two songs are "the same" when their structure and name match, so opening the
// same share link twice does not pile up copies.
function fingerprint(song) {
  return JSON.stringify([song.name, song.sections.map((s) => [s.name, s.bpm, s.num, s.den, s.measures])])
}

function loadLibrary() {
  let lib = null

  try {
    lib = normalizeLibrary(JSON.parse(localStorage.getItem(STORE_KEY)))
  } catch (err) {
    console.warn('bad saved library', err)
  }

  if (!lib) {
    // Single-song format from an earlier version.
    try {
      const legacy = normalizeSong(JSON.parse(localStorage.getItem(LEGACY_KEY)))
      if (legacy) lib = { songs: [legacy], currentId: legacy.id }
    } catch (err) {
      console.warn('bad legacy song', err)
    }
  }

  if (!lib) {
    const first = defaultSong('My song')
    lib = { songs: [first], currentId: first.id }
  }

  const shared = decodeShared()
  if (shared) {
    const match = lib.songs.find((s) => fingerprint(s) === fingerprint(shared))
    if (match) {
      lib.currentId = match.id
    } else {
      lib.songs.push(shared)
      lib.currentId = shared.id
    }
  }

  return lib
}

function decodeShared() {
  try {
    const hash = new URLSearchParams(location.hash.slice(1)).get('s')
    if (!hash) return null
    return normalizeSong(JSON.parse(decodeURIComponent(escape(atob(hash.replace(/-/g, '+').replace(/_/g, '/'))))))
  } catch (err) {
    console.warn('bad share link', err)
    return null
  }
}

function currentSong() {
  return library.songs.find((s) => s.id === library.currentId) || library.songs[0]
}

function save() {
  song.updated = Date.now()
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ currentId: song.id, songs: library.songs }))
    localStorage.removeItem(LEGACY_KEY)
  } catch (err) {
    console.warn('could not save', err)
    toast('Could not save — browser storage is full or blocked')
  }
}

function selectSong(id) {
  metro.stop()
  library.currentId = id
  song = currentSong()
  render()
}

function plainSong(source = song) {
  return { name: source.name, sections: source.sections.map(({ id, ...rest }) => rest) }
}

function encodeSong() {
  return btoa(unescape(encodeURIComponent(JSON.stringify(plainSong()))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function toast(message) {
  const box = $('#toast')
  $('#toastText').textContent = message
  box.classList.remove('hidden')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => box.classList.add('hidden'), 2200)
}

// --- rendering -----------------------------------------------------------

function render() {
  renderSongList()
  list.innerHTML = song.sections.map(card).join('')
  updateSummaries()
  showIdle()
  save()
}

function renderSongList() {
  const select = $('#songSelect')
  select.innerHTML = library.songs.map((s) => `<option value="${s.id}" ${s.id === song.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
  select.disabled = library.songs.length < 2
  if ($('#songName').value !== song.name) $('#songName').value = song.name
}

function card(section, index) {
  return `
    <div class="card bg-base-100 shadow" data-id="${section.id}">
      <div class="card-body gap-3 p-4">
        <div class="flex items-center gap-2">
          <span class="badge badge-neutral badge-sm tabular-nums">${index + 1}</span>
          <input data-field="name" class="input input-sm input-ghost min-w-0 flex-1 px-2 font-semibold" value="${esc(section.name)}" maxlength="40" aria-label="Section name" />
          <div class="join">
            <button data-act="up" class="btn btn-ghost btn-xs join-item" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button data-act="down" class="btn btn-ghost btn-xs join-item" title="Move down" ${index === song.sections.length - 1 ? 'disabled' : ''}>↓</button>
            <button data-act="dup" class="btn btn-ghost btn-xs join-item" title="Duplicate">⧉</button>
            <button data-act="del" class="btn btn-ghost btn-xs join-item text-error" title="Delete">✕</button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label class="form-control col-span-2 sm:col-span-2">
            <span class="label-text text-xs opacity-60">Tempo</span>
            <div class="flex items-center gap-2">
              <input data-field="bpm" type="number" min="20" max="400" value="${section.bpm}" class="input input-sm input-bordered w-20 tabular-nums" />
              <input data-field="bpmRange" type="range" min="20" max="400" value="${section.bpm}" class="range range-xs range-primary flex-1" aria-label="Tempo" />
            </div>
          </label>

          <label class="form-control">
            <span class="label-text text-xs opacity-60">Time signature</span>
            <div class="flex items-center gap-1">
              <input data-field="num" type="number" min="1" max="32" value="${section.num}" class="input input-sm input-bordered w-16 tabular-nums" />
              <span class="opacity-50">/</span>
              <select data-field="den" class="select select-sm select-bordered w-18">
                ${[1, 2, 4, 8, 16].map((d) => `<option value="${d}" ${d === section.den ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
            </div>
          </label>

          <label class="form-control">
            <span class="label-text text-xs opacity-60">Measures</span>
            <input data-field="measures" type="number" min="1" max="999" value="${section.measures}" class="input input-sm input-bordered w-full tabular-nums" />
          </label>
        </div>

        <div class="flex items-center justify-between gap-2">
          <span data-role="len" class="text-xs tabular-nums opacity-60">${sectionLabel(section)}</span>
          <button data-act="tap" class="btn btn-ghost btn-xs">Tap tempo</button>
        </div>
      </div>
    </div>`
}

function sectionLabel(section) {
  return `${section.num * section.measures} beats · ${time(sectionSeconds(section))}`
}

function updateSummaries() {
  const beats = song.sections.reduce((total, s) => total + s.num * s.measures, 0)
  const measures = song.sections.reduce((total, s) => total + s.measures, 0)
  $('#songSummary').textContent = `${song.sections.length} sections · ${measures} measures · ${beats} beats · ${time(songSeconds())}`
  $('#total').textContent = time(songSeconds())
}

function cardOf(id) {
  return list.querySelector(`[data-id="${id}"]`)
}

function findSection(node) {
  const holder = node.closest('[data-id]')
  return holder && song.sections.find((s) => s.id === holder.dataset.id)
}

// --- editing -------------------------------------------------------------

list.addEventListener('input', (event) => {
  const field = event.target.dataset.field
  const section = findSection(event.target)
  if (!field || !section) return

  if (field === 'name') section.name = event.target.value
  if (field === 'num') section.num = clamp(event.target.value, 1, 32, section.num)
  if (field === 'den') section.den = Number(event.target.value)
  if (field === 'measures') section.measures = clamp(event.target.value, 1, 999, section.measures)
  if (field === 'bpm' || field === 'bpmRange') {
    section.bpm = clamp(event.target.value, 20, 400, section.bpm)
    const holder = cardOf(section.id)
    const other = field === 'bpm' ? 'bpmRange' : 'bpm'
    holder.querySelector(`[data-field="${other}"]`).value = section.bpm
  }

  cardOf(section.id).querySelector('[data-role="len"]').textContent = sectionLabel(section)
  updateSummaries()
  showIdle()
  save()
})

list.addEventListener('change', (event) => {
  // Snap out-of-range typing back to the stored value on blur/commit.
  const field = event.target.dataset.field
  const section = findSection(event.target)
  if (!section || !['bpm', 'num', 'measures'].includes(field)) return
  event.target.value = section[field]
})

list.addEventListener('click', (event) => {
  const button = event.target.closest('[data-act]')
  if (!button) return
  const section = findSection(button)
  const index = song.sections.indexOf(section)

  switch (button.dataset.act) {
    case 'up':
      song.sections.splice(index - 1, 0, song.sections.splice(index, 1)[0])
      break
    case 'down':
      song.sections.splice(index + 1, 0, song.sections.splice(index, 1)[0])
      break
    case 'dup':
      song.sections.splice(index + 1, 0, { ...section, id: uid() })
      break
    case 'del':
      if (song.sections.length === 1) return toast('Keep at least one section')
      song.sections.splice(index, 1)
      break
    case 'tap':
      return tap(section)
  }
  render()
})

function tap(section) {
  const now = performance.now()
  const hits = (taps.get(section.id) || []).filter((t) => now - t < 2500)
  hits.push(now)
  taps.set(section.id, hits.slice(-5))

  if (hits.length < 2) return toast('Keep tapping…')
  const spans = hits.slice(1).map((t, i) => t - hits[i])
  const average = spans.reduce((a, b) => a + b, 0) / spans.length
  section.bpm = clamp(60000 / average, 20, 400, section.bpm)

  const holder = cardOf(section.id)
  holder.querySelector('[data-field="bpm"]').value = section.bpm
  holder.querySelector('[data-field="bpmRange"]').value = section.bpm
  holder.querySelector('[data-role="len"]').textContent = sectionLabel(section)
  updateSummaries()
  showIdle()
  save()
}

$('#addBtn').addEventListener('click', () => {
  const last = song.sections[song.sections.length - 1] || DEFAULT_SONG.sections[0]
  song.sections.push({ ...last, id: uid(), name: `Section ${song.sections.length + 1}` })
  render()
  cardOf(song.sections[song.sections.length - 1].id).scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})

$('#clearBtn').addEventListener('click', () => {
  metro.stop()
  song.sections = defaultSong().sections
  render()
  toast('Sections reset')
})

// --- song library --------------------------------------------------------

$('#songSelect').addEventListener('change', (event) => selectSong(event.target.value))

$('#songName').addEventListener('input', (event) => {
  song.name = event.target.value.slice(0, 60)
  renderSongList()
  save()
})

$('#newBtn').addEventListener('click', () => {
  const fresh = defaultSong(uniqueName('New song'))
  library.songs.push(fresh)
  selectSong(fresh.id)
  $('#songName').select()
  toast('Song created')
})

$('#dupSongBtn').addEventListener('click', () => {
  const copy = normalizeSong(plainSong())
  copy.name = uniqueName(`${song.name} copy`)
  library.songs.splice(library.songs.indexOf(song) + 1, 0, copy)
  selectSong(copy.id)
  toast('Song duplicated')
})

$('#delSongBtn').addEventListener('click', async () => {
  if (library.songs.length === 1) return toast('That is your only song')
  if (!(await confirmAction(`Delete “${song.name}”? This cannot be undone.`))) return
  const index = library.songs.indexOf(song)
  library.songs.splice(index, 1)
  selectSong(library.songs[Math.min(index, library.songs.length - 1)].id)
  toast('Song deleted')
})

function uniqueName(base) {
  let name = base
  let n = 2
  while (library.songs.some((s) => s.name === name)) name = `${base} ${n++}`
  return name
}

function confirmAction(message) {
  return new Promise((resolve) => {
    const dialog = $('#confirmDialog')
    $('#confirmText').textContent = message
    $('#confirmYes').onclick = () => {
      dialog.dataset.ok = 'yes'
      dialog.close()
    }
    dialog.onclose = () => {
      const ok = dialog.dataset.ok === 'yes'
      delete dialog.dataset.ok
      resolve(ok)
    }
    dialog.showModal()
  })
}

// --- playback ------------------------------------------------------------

function playList() {
  const sections = song.sections.map((s) => ({ bpm: s.bpm, beats: s.num, measures: s.measures }))
  if ($('#countIn').checked) {
    const first = song.sections[0]
    sections.unshift({ bpm: first.bpm, beats: first.num, measures: 1, countIn: true })
    offset = 1
  } else {
    offset = 0
  }
  return sections
}

async function play() {
  await metro.start(playList(), { loop: $('#loop').checked, volume: Number($('#volume').value) / 100 })
  $('#playBtn').textContent = '■ Stop'
  $('#playBtn').classList.replace('btn-primary', 'btn-error')
}

function onStop() {
  $('#playBtn').textContent = '▶ Play'
  $('#playBtn').classList.replace('btn-error', 'btn-primary')
  $('#progress').value = 0
  $('#elapsed').textContent = '0:00'
  list.querySelectorAll('[data-id]').forEach((node) => node.classList.remove('ring', 'ring-primary'))
  showIdle()
}

// Stopped display: preview whatever the song starts on.
function showIdle() {
  if (metro.playing) return
  const first = song.sections[0]
  $('#nowName').textContent = `Ready · ${song.sections.length} section${song.sections.length === 1 ? '' : 's'}`
  $('#nowBpm').textContent = first.bpm
  $('#nowSig').textContent = `${first.num}/${first.den}`
  $('#nowMeasure').textContent = `measure 1 / ${first.measures}`
  renderDots(first.num, -1)
}

function onBeat(event) {
  const index = event.section - offset
  const section = song.sections[index]

  if (event.countIn || !section) {
    $('#nowName').textContent = 'Count in'
    $('#nowBpm').textContent = event.bpm
    $('#nowMeasure').textContent = `${event.beat + 1} / ${event.beats}`
    renderDots(event.beats, event.beat, true)
    return
  }

  $('#nowName').textContent = `${index + 1}. ${section.name}`
  $('#nowBpm').textContent = section.bpm
  $('#nowSig').textContent = `${section.num}/${section.den}`
  $('#nowMeasure').textContent = `measure ${event.measure + 1} / ${section.measures}`
  renderDots(event.beats, event.beat)

  list.querySelectorAll('[data-id]').forEach((node) => node.classList.remove('ring', 'ring-primary'))
  const holder = cardOf(section.id)
  if (holder) holder.classList.add('ring', 'ring-primary')

  const elapsed = secondsBefore(index) + ((event.measure * section.num + event.beat) * 60) / section.bpm
  const total = songSeconds()
  $('#elapsed').textContent = time(elapsed)
  $('#progress').value = total ? (elapsed / total) * 100 : 0
}

function renderDots(count, active, countIn = false) {
  const dots = $('#beatDots')
  if (dots.childElementCount !== count) {
    dots.innerHTML = Array.from({ length: count }, () => '<span class="size-4 rounded-full"></span>').join('')
  }
  ;[...dots.children].forEach((dot, i) => {
    const on = i === active
    const lit = countIn ? 'bg-warning' : i === 0 ? 'bg-accent' : 'bg-primary'
    dot.className = `size-4 rounded-full transition-transform ${on ? `${lit} scale-125` : 'bg-base-content/20'}`
  })
}

$('#playBtn').addEventListener('click', () => (metro.playing ? metro.stop() : play()))
$('#volume').addEventListener('input', (event) => metro.setVolume(Number(event.target.value) / 100))
$('#loop').addEventListener('change', (event) => (metro.loop = event.target.checked))

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.target.matches('input, textarea, select, button')) return
  event.preventDefault()
  metro.playing ? metro.stop() : play()
})

// --- share / import / export --------------------------------------------

$('#shareBtn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#s=${encodeSong()}`
  history.replaceState(null, '', `#s=${encodeSong()}`)
  try {
    await navigator.clipboard.writeText(url)
    toast('Share link copied')
  } catch (err) {
    console.warn('clipboard blocked', err)
    openDialog('Share link', url, false)
  }
})

$('#exportBtn').addEventListener('click', () => {
  openDialog('Export song', JSON.stringify(plainSong(), null, 2), false)
})

$('#importBtn').addEventListener('click', () => openDialog('Paste song JSON — it is added as a new song', '', true))

function openDialog(title, text, canApply) {
  $('#ioTitle').textContent = title
  $('#ioText').value = text
  $('#ioApply').classList.toggle('hidden', !canApply)
  $('#ioDialog').showModal()
}

$('#ioApply').addEventListener('click', () => {
  try {
    const parsed = normalizeSong(JSON.parse($('#ioText').value))
    if (!parsed) throw new Error('no sections')
    parsed.name = uniqueName(parsed.name)
    library.songs.push(parsed)
    selectSong(parsed.id)
    $('#ioDialog').close()
    toast('Song imported')
  } catch (err) {
    toast(`Could not read that JSON: ${err.message}`)
  }
})

render()
