export class Deck {
  constructor(ctx) {
    this.ctx = ctx;
    this.high = ctx.createBiquadFilter();
    this.mid = ctx.createBiquadFilter();
    this.low = ctx.createBiquadFilter();
    this.high.type = "highshelf";
    this.high.frequency.value = 3200;
    this.mid.type = "peaking";
    this.mid.frequency.value = 1000;
    this.mid.Q.value = 0.8;
    this.low.type = "lowshelf";
    this.low.frequency.value = 200;
    this.fader = ctx.createGain();
    this.high.connect(this.mid);
    this.mid.connect(this.low);
    this.low.connect(this.fader);
    this.output = this.fader;

    this.buffer = null;
    this.source = null;
    this.playing = false;
    this.rate = 1;
    this.nudge = 0;
    this.anchorPos = 0;
    this.anchorTime = 0;
    this.bpm = null;
    this.gridOrigin = 0;
    this.name = "";
    this.peaks = null;
  }

  load(buffer, info) {
    this.unload();
    this.buffer = buffer;
    this.bpm = info.bpm;
    this.name = info.name;
    this.gridOrigin = info.gridOrigin || 0;
    this.anchorPos = this.gridOrigin;
    this.peaks = buildPeaks(buffer, 900);
  }

  unload() {
    this.stopSource();
    this.buffer = null;
    this.bpm = null;
    this.name = "";
    this.peaks = null;
    this.anchorPos = 0;
    this.gridOrigin = 0;
    this.rate = 1;
    this.nudge = 0;
  }

  /** Buffer seconds, including time already looped. */
  position() {
    if (!this.playing) return this.anchorPos;
    const elapsed = this.ctx.currentTime - this.anchorTime;
    return this.anchorPos + elapsed * this.soundRate();
  }

  wrapped() {
    if (!this.buffer) return 0;
    const dur = this.buffer.duration;
    let pos = this.position() % dur;
    if (pos < 0) pos += dur;
    return pos;
  }

  /** 0 at this deck's grid, just after a beat. */
  phase() {
    if (!this.buffer || !this.bpm) return null;
    const beat = 60 / this.bpm;
    let rel = this.wrapped() - this.gridOrigin;
    rel = ((rel % beat) + beat) % beat;
    return rel / beat;
  }

  outputBpm() {
    if (!this.bpm) return null;
    return this.bpm * this.rate;
  }

  soundRate() {
    return this.rate * (1 + this.nudge * 0.08);
  }

  setRate(rate) {
    this.rebase();
    this.rate = rate;
    this.applySoundRate();
  }

  setNudge(direction) {
    if (this.nudge === direction) return;
    this.rebase();
    this.nudge = direction;
    this.applySoundRate();
  }

  setEq(band, db) {
    this[band].gain.setTargetAtTime(db, this.ctx.currentTime, 0.015);
  }

  play() {
    if (!this.buffer || this.playing) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.playbackRate.value = this.soundRate();
    src.connect(this.high);
    const dur = this.buffer.duration;
    let offset = this.anchorPos % dur;
    if (offset < 0) offset += dur;
    if (offset > dur - 0.001) offset = 0;
    const startedAt = this.ctx.currentTime;
    this.anchorPos = offset;
    this.anchorTime = startedAt;
    src.start(startedAt, offset);
    this.source = src;
    this.playing = true;
    return startedAt;
  }

  pause() {
    if (!this.playing) return;
    this.anchorPos = this.position();
    this.stopSource();
  }

  toggle() {
    if (this.playing) {
      this.pause();
      return "pause";
    }
    this.play();
    return "play";
  }

  cue() {
    this.pause();
    this.anchorPos = this.gridOrigin || 0;
  }

  seek(bufferSeconds) {
    if (!this.buffer) return;
    const dur = this.buffer.duration;
    let pos = bufferSeconds % dur;
    if (pos < 0) pos += dur;
    const wasPlaying = this.playing;
    this.stopSource();
    this.anchorPos = pos;
    if (wasPlaying) this.play();
  }

  rebase() {
    this.anchorPos = this.position();
    this.anchorTime = this.ctx.currentTime;
  }

  applySoundRate() {
    if (this.source) this.source.playbackRate.value = this.soundRate();
  }

  stopSource() {
    if (!this.source) {
      this.playing = false;
      return;
    }
    try {
      this.source.stop();
    } catch {
      /* start() never ran */
    }
    this.source.disconnect();
    this.source = null;
    this.playing = false;
  }
}

export class Mixer {
  constructor(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.a = new Deck(ctx);
    this.b = new Deck(ctx);
    this.a.output.connect(this.master);
    this.b.output.connect(this.master);
    this.cross = 0;
    this.setCross(0);
  }

  setCross(value) {
    this.cross = Math.min(1, Math.max(0, value));
    const now = this.ctx.currentTime;
    const left = Math.cos(this.cross * Math.PI / 2);
    const right = Math.sin(this.cross * Math.PI / 2);
    this.a.fader.gain.setTargetAtTime(left, now, 0.015);
    this.b.fader.gain.setTargetAtTime(right, now, 0.015);
  }
}

export class Metronome {
  constructor(ctx) {
    this.ctx = ctx;
    this.bpm = 100;
    this.running = false;
    this.next = 0;
    this.timer = 0;
    this.beatTimes = [];
    this.generation = 0;
    this.onBeat = null;
  }

  start(bpm) {
    this.stop();
    this.bpm = bpm;
    this.running = true;
    this.generation += 1;
    this.beatTimes = [];
    this.next = this.ctx.currentTime + 0.15;
    this.schedule();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  schedule() {
    if (!this.running) return;
    const horizon = this.ctx.currentTime + 0.25;
    const period = 60 / this.bpm;
    const generation = this.generation;
    while (this.next < horizon) {
      this.clickAt(this.next);
      this.beatTimes.push(this.next);
      if (this.onBeat) this.onBeat(this.next, generation);
      this.next += period;
    }
    const cutoff = this.ctx.currentTime - 3;
    while (this.beatTimes.length && this.beatTimes[0] < cutoff) this.beatTimes.shift();
    this.timer = setTimeout(() => this.schedule(), 25);
  }

  nearest(time) {
    let best = null;
    let bestAbs = Infinity;
    for (const beat of this.beatTimes) {
      const distance = Math.abs(time - beat);
      if (distance < bestAbs) {
        bestAbs = distance;
        best = beat;
      }
    }
    if (best == null) return null;
    return { at: best, deltaMs: (time - best) * 1000 };
  }

  clickAt(time) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.12, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  }
}

function buildPeaks(buffer, buckets) {
  const data = buffer.getChannelData(0);
  const peaks = new Float32Array(buckets);
  const size = Math.max(1, Math.floor(data.length / buckets));
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * size;
    const end = Math.min(data.length, start + size);
    for (let j = start; j < end; j += 4) max = Math.max(max, Math.abs(data[j]));
    peaks[i] = max;
  }
  return peaks;
}
