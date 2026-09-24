// Web Audio metronome engine: schedules clicks ahead of time on the audio
// clock, and reports each beat back to the UI as it is actually heard.

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD = 0.12

// A section is { bpm, beats, measures, countIn }. `beats` is beats per measure
// and one beat is always the note value of the time signature denominator, so
// 120bpm in 3/4 and 120bpm in 4/4 click at the same rate.
export class Metronome {
  constructor({ onBeat, onEnd } = {}) {
    this.onBeat = onBeat
    this.onEnd = onEnd
    this.ctx = null
    this.gain = null
    this.sections = []
    this.queue = []
    this.pos = { section: 0, measure: 0, beat: 0 }
    this.nextTime = 0
    this.endTime = 0
    this.done = false
    this.playing = false
    this.loop = false
    this.volume = 0.8
    this.timer = null
  }

  async start(sections, { loop = false, volume = 0.8 } = {}) {
    this.stop({ silent: true })
    if (!sections.length) return

    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)()
      this.gain = this.ctx.createGain()
      this.gain.connect(this.ctx.destination)
    }
    await this.ctx.resume()

    this.sections = sections
    this.loop = loop
    this.setVolume(volume)
    this.queue = []
    this.pos = { section: 0, measure: 0, beat: 0 }
    this.nextTime = this.ctx.currentTime + 0.1
    this.done = false
    this.playing = true

    this.tick()
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS)
  }

  stop({ silent = false } = {}) {
    const wasPlaying = this.playing
    this.playing = false
    clearInterval(this.timer)
    this.timer = null
    this.queue = []
    if (wasPlaying && !silent && this.onEnd) this.onEnd()
  }

  setVolume(value) {
    this.volume = value
    if (this.gain) this.gain.gain.value = value
  }

  tick() {
    this.schedule()
    this.drain()
  }

  schedule() {
    if (!this.playing) return
    const now = this.ctx.currentTime

    while (!this.done && this.nextTime < now + SCHEDULE_AHEAD) {
      const section = this.sections[this.pos.section]
      const event = {
        section: this.pos.section,
        measure: this.pos.measure,
        beat: this.pos.beat,
        beats: section.beats,
        measures: section.measures,
        bpm: section.bpm,
        countIn: !!section.countIn,
        time: this.nextTime
      }
      this.click(event)
      this.queue.push(event)
      this.nextTime += 60 / section.bpm
      this.advance()
    }

    if (this.done && now > this.endTime) this.stop()
  }

  advance() {
    const section = this.sections[this.pos.section]
    this.pos.beat++
    if (this.pos.beat < section.beats) return

    this.pos.beat = 0
    this.pos.measure++
    if (this.pos.measure < section.measures) return

    this.pos.measure = 0
    this.pos.section++
    if (this.pos.section < this.sections.length) return

    if (this.loop) {
      // A count-in belongs to the first pass only.
      this.pos.section = this.sections.findIndex((s) => !s.countIn)
      if (this.pos.section === -1) this.pos.section = 0
      return
    }

    this.done = true
    this.endTime = this.nextTime
  }

  // Three voices: section start, measure downbeat, and plain beat.
  click({ beat, measure, section, countIn, time }) {
    const isDownbeat = beat === 0
    const isSectionStart = isDownbeat && measure === 0

    let freq = 880
    let level = 0.45
    if (isDownbeat) {
      freq = 1320
      level = 0.7
    }
    if (isSectionStart && section > 0) freq = 1760
    if (countIn) {
      freq = isDownbeat ? 1180 : 780
      level *= 0.8
    }

    const osc = this.ctx.createOscillator()
    const env = this.ctx.createGain()
    osc.type = isDownbeat ? 'triangle' : 'sine'
    osc.frequency.value = freq
    env.gain.setValueAtTime(0, time)
    env.gain.linearRampToValueAtTime(level, time + 0.002)
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.06)
    osc.connect(env)
    env.connect(this.gain)
    osc.start(time)
    osc.stop(time + 0.08)
  }

  // Fire UI callbacks when the audio clock actually reaches each click. This
  // rides the scheduler's timer instead of requestAnimationFrame, which is
  // suspended whenever the tab is hidden.
  drain() {
    if (!this.playing) return
    const now = this.ctx.currentTime
    while (this.queue.length && this.queue[0].time <= now) {
      const event = this.queue.shift()
      if (this.onBeat) this.onBeat(event)
    }
  }
}
