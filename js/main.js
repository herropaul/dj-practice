import { analyzeTrack, beatOffsetMs, wrapPhaseDelta } from "./bpm.js";
import { listSamples, renderSample } from "./samples.js";
import { Metronome, Mixer } from "./audio.js";

const $ = (sel) => document.querySelector(sel);
if (typeof AudioContext === "undefined") {
  document.body.innerHTML = "<p>This browser has no Web Audio. Try a current version of Chrome or Firefox.</p>";
  throw new Error("Web Audio is missing");
}

const ctx = new AudioContext();
const mixer = new Mixer(ctx);
const metronome = new Metronome(ctx);
const samples = listSamples();

const LESSONS = [
  {
    title: "Tap the beat",
    body: "A click is playing and the lamp flashes with it. Press the space bar on each flash. Land 8 taps in a row close to the click. This is the feeling you want later, when the click is a kick drum.",
    keys: "Space taps the click. Enter continues once the lesson is done.",
  },
  {
    title: "Start on the beat",
    body: "You have one song. Cue parks it on the first beat. Play as the lamp flashes, so the first kick lands on the click, then pause so you know how to stop. The click follows the song's tempo. It is only there to show you the beat.",
    keys: "Q plays or pauses the left song. A jumps back to the first beat. 1, 2, and 3 load the practice loops.",
  },
  {
    title: "Hand the song over",
    body: "Two songs share one set of speakers. The crossfader decides who is heard. Play the left song, play the right song, then slide the crossfader from the left side all the way to the right. They will probably clash. Read the note under the fader. You fix that next.",
    keys: "Q and A are the left song. P and L are the right song. Arrow keys move the crossfader. 8, 9, and 0 load loops on the right.",
  },
  {
    title: "Make the beats agree",
    body: "Push, on the right, is a little faster than Floor, on the left. Play both with the crossfader near the middle. Slow the right song until the speed gap is almost zero, then hold Sooner or Later until the bright lines stack. Keep them stacked for two seconds. Sync stays hidden until you do this yourself. Headphones help.",
    keys: "Z and X move the left tempo. Comma and period move the right tempo. Hold S or D to slide the left kick, N or M for the right. Shift makes the tempo keys bigger. Y syncs, once it appears.",
  },
];

const state = {
  lesson: 1,
  unlocked: 1,
  syncUnlocked: false,
  audioOn: false,
  streak: 0,
  lastBeatAt: null,
  usedCue: false,
  usedPause: false,
  onBeat: false,
  playedA: false,
  playedB: false,
  crossLow: false,
  crossHigh: false,
  movedTempo: false,
  goalReady: false,
  matchSince: null,
};

const TAP_WINDOW_MS = 100;
const START_WINDOW_MS = 100;

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem("practice-dj") || "{}");
    if (saved.unlocked >= 1 && saved.unlocked <= 4) {
      state.unlocked = saved.unlocked;
      state.lesson = saved.unlocked;
    }
    state.syncUnlocked = Boolean(saved.syncUnlocked);
  } catch {
    /* keep the defaults */
  }
}

function save() {
  localStorage.setItem("practice-dj", JSON.stringify({
    unlocked: state.unlocked,
    syncUnlocked: state.syncUnlocked,
  }));
}

function resetAttempt() {
  state.streak = 0;
  state.lastBeatAt = null;
  state.usedCue = false;
  state.usedPause = false;
  state.onBeat = false;
  state.playedA = false;
  state.playedB = false;
  state.crossLow = false;
  state.crossHigh = false;
  state.movedTempo = false;
  state.goalReady = false;
  state.matchSince = null;
}

function setStatus(text) {
  const node = $("#status");
  if (node.textContent !== text) node.textContent = text;
}

function setHold(text) {
  const node = $("#hold");
  if (node.textContent !== text) node.textContent = text;
}

function setError(text) {
  $("#error").textContent = text;
}

metronome.onBeat = (time, generation) => {
  const delay = Math.max(0, (time - ctx.currentTime) * 1000);
  setTimeout(() => {
    if (generation !== metronome.generation) return;
    const lamp = $("#lamp");
    lamp.classList.add("on");
    setTimeout(() => lamp.classList.remove("on"), 80);
  }, delay);
};

function enterLesson(n) {
  state.lesson = n;
  resetAttempt();
  document.body.dataset.lesson = String(n);
  if (n === 1) {
    mixer.a.pause();
    mixer.b.pause();
    if (state.audioOn) metronome.start(100);
    setStatus("Tap on the flashes. 0 / 8.");
  } else if (n === 2) {
    mixer.b.pause();
    ensureDeck(mixer.a, "floor");
    if (state.audioOn) metronome.start(mixer.a.bpm || 120);
    setCross(0, { silent: true });
    setStatus("Cue the song, start it on a flash, then pause.");
  } else {
    metronome.stop();
    ensureDeck(mixer.a, "floor");
    ensureDeck(mixer.b, "push");
    if (n === 3) {
      setCross(0, { silent: true });
      setStatus("Play both songs, then move the crossfader all the way right.");
    } else {
      setCross(0.5, { silent: true });
      if (!state.syncUnlocked) {
        mixer.a.setRate(1);
        mixer.b.setRate(1);
        writeTempoSlider("a");
        writeTempoSlider("b");
      }
      setStatus("Line the beats up and hold them there.");
    }
  }
  render();
  requestAnimationFrame(fitCanvases);
}

function ensureDeck(deck, sampleId) {
  if (!deck.buffer) loadBuiltIn(deck, sampleId, { skipMetronome: true });
}

function advance() {
  if (!state.goalReady || state.lesson >= 4) return;
  const next = state.lesson + 1;
  if (next > state.unlocked) {
    state.unlocked = next;
    save();
  }
  enterLesson(next);
}

function render() {
  hideTip();
  const lesson = LESSONS[state.lesson - 1];
  document.body.dataset.lesson = String(state.lesson);
  $("#lesson-kicker").textContent = `Lesson ${state.lesson} of 4`;
  $("#lesson-title").textContent = lesson.title;
  $("#lesson-body").textContent = lesson.body;
  $("#keys").textContent = lesson.keys;
  $("#streak").textContent = `${state.streak} / 8 on the beat`;
  $("#tap-panel").hidden = state.lesson !== 1;
  $("#lamp-wrap").hidden = state.lesson > 2;
  $("#deck-a").hidden = state.lesson < 2;
  $("#deck-b").hidden = state.lesson < 3;
  $("#cross-panel").hidden = state.lesson < 3;
  $("#clash-panel").hidden = state.lesson < 3;
  $("#drift").hidden = state.lesson < 4;
  $("#tempo-a-wrap").hidden = state.lesson < 4;
  $("#tempo-b-wrap").hidden = state.lesson < 4;
  $("#sync").hidden = !state.syncUnlocked;
  $("#continue").hidden = !(state.goalReady && state.lesson < 4);

  for (let i = 1; i <= 4; i++) {
    const pip = $(`#pip-${i}`);
    const locked = i > state.unlocked;
    pip.classList.toggle("current", i === state.lesson);
    pip.classList.toggle("locked", locked);
    pip.setAttribute("aria-disabled", locked ? "true" : "false");
    pip.setAttribute("aria-current", i === state.lesson ? "step" : "false");
  }

  paintDeck("a", mixer.a);
  paintDeck("b", mixer.b);
}

function paintDeck(side, deck) {
  $(`#name-${side}`).textContent = deck.name || "Nothing loaded";
  const bpm = $(`#bpm-${side}`);
  bpm.textContent = !deck.buffer ? "—" : deck.bpm == null ? "No steady beat" : `${deck.bpm.toFixed(1)} BPM`;
  $(`#empty-${side}`).hidden = Boolean(deck.peaks);
  const play = $(`#play-${side} .label`);
  play.textContent = deck.playing ? "Pause" : "Play";
}

function formatTime(seconds) {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const rest = (safe - mins * 60).toFixed(1).padStart(4, "0");
  return `${mins}:${rest}`;
}

function writeTempoSlider(side) {
  const deck = side === "a" ? mixer.a : mixer.b;
  $(`#tempo-${side}`).value = String((deck.rate - 1) * 100);
  updateTempoLabel(side);
}

function updateTempoLabel(side) {
  const deck = side === "a" ? mixer.a : mixer.b;
  const percent = (deck.rate - 1) * 100;
  const sign = percent > 0.05 ? "+" : "";
  const heard = deck.outputBpm();
  const heardText = heard == null ? "" : ` · ${heard.toFixed(1)} BPM`;
  $(`#tempo-label-${side}`).textContent = `${sign}${percent.toFixed(1)}%${heardText}`;
}

function crossWords(value) {
  if (value < 0.08) return "Hearing the left song only";
  if (value > 0.92) return "Hearing the right song only";
  if (value < 0.4) return "Mostly the left song, with a little of the right";
  if (value > 0.6) return "Mostly the right song, with a little of the left";
  return "Both songs together, near the middle";
}

function setCross(value, options = {}) {
  const next = Math.min(1, Math.max(0, value));
  mixer.setCross(next);
  $("#cross").value = String(next);
  $("#cross-label").textContent = crossWords(next);
  if (next <= 0.08) state.crossLow = true;
  if (next >= 0.92) state.crossHigh = true;
  if (!options.silent) checkGoals();
}

function loadBuiltIn(deck, id, options = {}) {
  const rendered = renderSample(id, ctx.sampleRate);
  const analysis = analyzeTrack(rendered.samples, ctx.sampleRate);
  const buffer = ctx.createBuffer(1, rendered.samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(rendered.samples);
  const grid = analysis.downbeat < 0.02 ? 0 : analysis.downbeat;
  deck.load(buffer, { bpm: analysis.bpm, name: rendered.name, gridOrigin: grid });
  afterLoad(deck, options);
}

async function loadFile(deck, file) {
  setError("");
  const side = deck === mixer.a ? "a" : "b";
  $(`#bpm-${side}`).textContent = "Listening…";
  try {
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    const mono = mixMono(audio);
    const analysis = analyzeTrack(mono, audio.sampleRate);
    const grid = analysis.downbeat < 0.02 ? 0 : analysis.downbeat;
    deck.load(audio, {
      bpm: analysis.bpm,
      name: file.name,
      gridOrigin: grid,
    });
    afterLoad(deck);
  } catch {
    setError("That file did not open. Try a WAV or MP3.");
    render();
  }
}

function mixMono(buffer) {
  const out = new Float32Array(buffer.length);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i] / channels;
  }
  return out;
}

function afterLoad(deck, options = {}) {
  deck.setRate(1);
  const side = deck === mixer.a ? "a" : "b";
  writeTempoSlider(side);
  if (!options.skipMetronome && state.lesson === 2 && deck === mixer.a && state.audioOn) {
    metronome.start(deck.bpm || 120);
  }
  render();
}

function onTap() {
  if (state.goalReady) return;
  const near = metronome.nearest(ctx.currentTime);
  if (!near) {
    setStatus("Listen for the first click, then tap.");
    return;
  }
  const ms = Math.round(near.deltaMs);
  if (Math.abs(ms) > TAP_WINDOW_MS) {
    state.streak = 0;
    state.lastBeatAt = null;
    $("#streak").textContent = "0 / 8 on the beat";
    setStatus(`Off by ${Math.abs(ms)} ms. The streak starts over.`);
    return;
  }
  if (state.lastBeatAt === near.at) {
    state.streak = 0;
    state.lastBeatAt = null;
    $("#streak").textContent = "0 / 8 on the beat";
    setStatus("That click already had a tap. Wait for the next one.");
    return;
  }
  const period = 60 / metronome.bpm;
  if (state.lastBeatAt != null && near.at - state.lastBeatAt > period * 1.5) {
    state.streak = 1;
  } else {
    state.streak += 1;
  }
  state.lastBeatAt = near.at;
  $("#streak").textContent = `${state.streak} / 8 on the beat`;
  if (state.streak >= 8) {
    state.goalReady = true;
    setStatus("Eight taps landed on the click. You can feel the beat.");
    render();
    return;
  }
  setStatus(`${state.streak} of 8 taps on the beat (${ms} ms).`);
}

function handleTransport(deck, side) {
  const action = deck.toggle();
  if (action === "play") {
    if (side === "a") state.playedA = true;
    else state.playedB = true;
    if (state.lesson === 2 && side === "a") judgeStart(ctx.currentTime);
  } else if (state.lesson === 2 && side === "a") {
    state.usedPause = true;
  }
  checkGoals();
  render();
}

function handleCue(deck, side) {
  deck.cue();
  if (state.lesson === 2 && side === "a") state.usedCue = true;
  checkGoals();
  render();
}

function judgeStart(time) {
  const near = metronome.nearest(time);
  if (!near) {
    setStatus("The click is not running yet.");
    return;
  }
  const ms = Math.round(near.deltaMs);
  if (Math.abs(ms) <= START_WINDOW_MS) {
    state.onBeat = true;
    setStatus(`Started on the click (${ms} ms).`);
  } else {
    const way = ms > 0 ? "late" : "early";
    setStatus(`That start was ${Math.abs(ms)} ms ${way}. Cue, then play as the lamp flashes.`);
  }
}

function checkGoals() {
  if (state.goalReady) return;
  if (state.lesson === 2 && state.usedCue && state.usedPause && state.onBeat) {
    state.goalReady = true;
    setStatus("Cue, a start on the click, and a pause. That's the left deck.");
    render();
  }
  if (state.lesson === 3 && state.playedA && state.playedB && state.crossLow && state.crossHigh) {
    state.goalReady = true;
    setStatus("The right song has the speakers. Next you will make the kicks agree.");
    render();
  }
}

function bumpTempo(side, delta) {
  const slider = $(`#tempo-${side}`);
  const next = Math.min(8, Math.max(-8, Math.round((Number(slider.value) + delta) * 10) / 10));
  slider.value = String(next);
  slider.dispatchEvent(new Event("input", { bubbles: true }));
}

function syncRight() {
  const left = mixer.a;
  const right = mixer.b;
  if (!left.bpm || !right.bpm || left.phase() == null || right.phase() == null) {
    setStatus("Sync needs a steady beat in both songs.");
    return;
  }
  let rate = left.outputBpm() / right.bpm;
  if (rate < 0.92 || rate > 1.08) {
    setStatus("Those tempos are more than 8% apart, so the slider cannot land the match.");
    rate = Math.min(1.08, Math.max(0.92, rate));
  }
  right.setRate(rate);
  writeTempoSlider("b");
  const delta = wrapPhaseDelta(left.phase(), right.phase());
  right.seek(right.wrapped() - delta * (60 / right.bpm));
  state.movedTempo = true;
  render();
}

function matchSnapshot() {
  const left = mixer.a;
  const right = mixer.b;
  if (!left.playing || !right.playing || !left.bpm || !right.bpm) return null;
  if (mixer.cross < 0.2 || mixer.cross > 0.8) return null;
  const phaseA = left.phase();
  const phaseB = right.phase();
  if (phaseA == null || phaseB == null) return null;
  return {
    gap: Math.abs(right.outputBpm() - left.outputBpm()),
    offset: Math.abs(beatOffsetMs(phaseA, phaseB, left.outputBpm())),
  };
}

function updateMatch() {
  if (state.lesson !== 4) return;
  if (state.syncUnlocked) {
    setHold("You lined the beats up yourself. Sync is available. Y jumps the right song onto the left one.");
    return;
  }
  const far = temposTooFar();
  const snap = matchSnapshot();
  if (!snap) {
    state.matchSince = null;
    setHold(far
      ? "These two are more than 8% apart, which is the whole slider. Load Floor on the left and Push on the right."
      : "Play both songs with the crossfader near the middle. Move the right tempo until the speed gap is under half a beat per minute, then nudge until the kicks stack. Hold that for 2 seconds.");
    return;
  }
  const close = snap.gap < 0.5 && snap.offset < 30 && state.movedTempo;
  if (!close) {
    state.matchSince = null;
    const missing = [];
    if (!state.movedTempo) missing.push("move a tempo slider");
    if (snap.gap >= 0.5) missing.push(`speed gap is ${snap.gap.toFixed(1)} BPM`);
    if (snap.offset >= 30) missing.push(`beats are ${Math.round(snap.offset)} ms apart`);
    setHold(`Not yet: ${missing.join(", ")}.`);
    return;
  }
  if (!state.matchSince) state.matchSince = ctx.currentTime;
  const held = ctx.currentTime - state.matchSince;
  if (held >= 2) {
    state.syncUnlocked = true;
    save();
    setStatus("The beats stayed together. Sync is unlocked.");
    setHold("You lined the beats up yourself. Sync is available. Y jumps the right song onto the left one.");
    render();
    return;
  }
  setHold(`Holding together: ${held.toFixed(1)} / 2 seconds.`);
}

function temposTooFar() {
  const left = mixer.a;
  const right = mixer.b;
  if (!left.bpm || !right.bpm) return false;
  return Math.abs(right.bpm - left.bpm) / left.bpm > 0.085;
}

function clashCopy() {
  const idle = "When both songs are in the speakers and their kicks miss each other, the reason shows up here.";
  if (state.lesson < 3) return { title: "Why this sounds bad", text: idle, kind: "idle" };
  const left = mixer.a;
  const right = mixer.b;
  if (!left.playing || !right.playing || left.bpm == null || right.bpm == null || left.phase() == null || right.phase() == null || mixer.cross <= 0.12 || mixer.cross >= 0.88) {
    return { title: "Why this sounds bad", text: idle, kind: "idle" };
  }
  const gap = right.outputBpm() - left.outputBpm();
  const offset = beatOffsetMs(left.phase(), right.phase(), left.outputBpm());
  const absGap = Math.abs(gap);
  const absOff = Math.abs(offset);
  if (absGap < 0.4 && absOff < 25) {
    return {
      title: "Why this sounds right",
      text: "The kicks are landing together. That single pulse is the sound you want.",
      kind: "good",
    };
  }
  const parts = [];
  if (absGap >= 0.4) {
    const way = gap > 0 ? "faster" : "slower";
    parts.push(`The right song is ${way} by ${absGap.toFixed(1)} BPM, so the beats keep walking apart.`);
  }
  if (absOff >= 25) {
    const way = offset > 0 ? "late" : "early";
    parts.push(`The right kick is ${Math.round(absOff)} ms ${way}. Those two thumps are the gallop you hear.`);
  }
  parts.push("Match the tempo, then nudge until the bright lines stack.");
  return { title: "Why this sounds bad", text: parts.join(" "), kind: "bad" };
}

function driftText() {
  const left = mixer.a;
  const right = mixer.b;
  if (left.bpm == null || right.bpm == null) return "Speed gap: — · Beat offset: —";
  const gap = right.outputBpm() - left.outputBpm();
  const abs = Math.abs(gap);
  const gapLabel = abs < 0.05 ? "Speed gap: 0.0 BPM" : `Speed gap: ${abs.toFixed(1)} BPM ${gap > 0 ? "fast" : "slow"}`;
  const phaseA = left.phase();
  const phaseB = right.phase();
  if (phaseA == null || phaseB == null) return `${gapLabel} · Beat offset: —`;
  const ms = Math.round(beatOffsetMs(phaseA, phaseB, left.outputBpm()));
  const offLabel = Math.abs(ms) < 8
    ? "Beat offset: together"
    : `Beat offset: ${Math.abs(ms)} ms ${ms > 0 ? "late" : "early"}`;
  return `${gapLabel} · ${offLabel}`;
}

function fitCanvases() {
  for (const canvas of document.querySelectorAll("canvas")) fitCanvas(canvas);
}

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function drawDeck(canvas, deck, color) {
  const c = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  if (w < 2) return;
  c.clearRect(0, 0, w, h);
  c.fillStyle = "#100e0c";
  c.fillRect(0, 0, w, h);
  if (!deck.peaks || !deck.buffer) return;
  c.fillStyle = color;
  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    const index = Math.floor((x / w) * deck.peaks.length);
    const amp = deck.peaks[index] * h * 0.46;
    c.fillRect(x, mid - amp, 1, Math.max(1, amp * 2));
  }
  const head = (deck.wrapped() / deck.buffer.duration) * w;
  c.fillStyle = "#f6efe2";
  c.fillRect(head, 0, Math.max(2, w / 500), h);
}

function drawDrift(canvas) {
  const c = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  if (w < 2) return;
  c.fillStyle = "#100e0c";
  c.fillRect(0, 0, w, h);
  const left = mixer.a;
  if (!left.bpm || !left.buffer) return;
  const half = ((60 / left.bpm) / left.rate) * 2;
  drawLane(c, left, 0, h / 2, w, half, "#e39b3a");
  drawLane(c, mixer.b, h / 2, h / 2, w, half, "#7fd0c6");
  c.fillStyle = "#f6efe2";
  c.fillRect(w / 2 - 1, 0, 2, h);
}

function drawLane(c, deck, top, height, w, half, color) {
  if (!deck.buffer || !deck.peaks) return;
  const mid = top + height / 2;
  c.fillStyle = color;
  for (let x = 0; x < w; x += 1) {
    const dt = (x / w - 0.5) * 2 * half;
    const pos = bufferPos(deck, dt);
    const index = Math.min(deck.peaks.length - 1, Math.floor((pos / deck.buffer.duration) * deck.peaks.length));
    const amp = deck.peaks[index] * height * 0.4;
    c.fillRect(x, mid - amp, 1, Math.max(1, amp * 2));
  }
  if (!deck.bpm) return;
  const current = deck.wrapped();
  const beatLen = 60 / deck.bpm;
  const dur = deck.buffer.duration;
  const rate = deck.soundRate() || 1;
  const index = Math.round((current - deck.gridOrigin) / beatLen);
  c.fillStyle = "rgba(246, 239, 226, 0.92)";
  for (let n = index - 8; n <= index + 8; n++) {
    let delta = deck.gridOrigin + n * beatLen - current;
    delta = ((delta % dur) + dur) % dur;
    if (delta > dur / 2) delta -= dur;
    const dt = delta / rate;
    if (Math.abs(dt) > half) continue;
    const x = (dt / (2 * half) + 0.5) * w;
    c.fillRect(x, top + 6, 2, height - 12);
  }
}

function bufferPos(deck, dt) {
  const dur = deck.buffer.duration;
  let pos = deck.wrapped() + dt * deck.soundRate();
  pos %= dur;
  if (pos < 0) pos += dur;
  return pos;
}

let clashShown = "";
function frame() {
  if (mixer.a.buffer) $("#time-a").textContent = formatTime(mixer.a.wrapped());
  if (mixer.b.buffer) $("#time-b").textContent = formatTime(mixer.b.wrapped());
  if (!$("#deck-a").hidden) drawDeck($("#wave-a"), mixer.a, "#e39b3a");
  if (!$("#deck-b").hidden) drawDeck($("#wave-b"), mixer.b, "#7fd0c6");
  if (!$("#drift").hidden) {
    drawDrift($("#drift-canvas"));
    const text = driftText();
    const node = $("#drift-readout");
    if (node.textContent !== text) node.textContent = text;
  }
  if (!$("#clash-panel").hidden) {
    const copy = clashCopy();
    const panel = $("#clash-panel");
    panel.classList.remove("idle", "bad", "good");
    panel.classList.add(copy.kind);
    if (clashShown !== copy.text) {
      clashShown = copy.text;
      $("#clash-title").textContent = copy.title;
      $("#clash").textContent = copy.text;
    }
  }
  updateMatch();
  requestAnimationFrame(frame);
}

function showTip(el) {
  const tip = $("#tip");
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const rect = el.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let top = rect.bottom + 8;
  if (top + tipRect.height > window.innerHeight - 8) top = rect.top - tipRect.height - 8;
  let left = rect.left;
  if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
  tip.style.top = `${Math.max(8, top)}px`;
  tip.style.left = `${Math.max(8, left)}px`;
}

function hideTip() {
  $("#tip").hidden = true;
}

function tipTarget(event) {
  const node = event.target;
  if (!(node instanceof Element)) return null;
  return node.closest("[data-tip]");
}

async function startAudio() {
  if (state.audioOn) return;
  state.audioOn = true;
  $("#gate").hidden = true;
  await ctx.resume();
  enterLesson(state.lesson);
}

function onKeyDown(event) {
  if (!state.audioOn) return;
  const code = event.code;
  if (code === "Space") {
    if (event.target instanceof Element && event.target.closest("button, a, input")) return;
    event.preventDefault();
    if (state.lesson === 1) onTap();
    return;
  }
  if (code === "Enter") {
    if (event.target instanceof Element && event.target.closest("button, a, input")) return;
    if (state.goalReady && state.lesson < 4) {
      event.preventDefault();
      advance();
    }
    return;
  }
  if ((code === "ArrowLeft" || code === "ArrowRight") && state.lesson >= 3) {
    if (event.target instanceof Element && event.target.closest("input")) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 0.05;
    const dir = code === "ArrowLeft" ? -1 : 1;
    setCross(Number($("#cross").value) + dir * step);
    return;
  }
  if (state.lesson >= 4 && (code === "KeyZ" || code === "KeyX")) {
    event.preventDefault();
    bumpTempo("a", (code === "KeyZ" ? -1 : 1) * (event.shiftKey ? 1 : 0.1));
    return;
  }
  if (state.lesson >= 4 && (code === "Comma" || code === "Period")) {
    event.preventDefault();
    bumpTempo("b", (code === "Comma" ? -1 : 1) * (event.shiftKey ? 1 : 0.1));
    return;
  }
  if (state.lesson >= 4 && !event.repeat && (code === "KeyS" || code === "KeyD")) {
    event.preventDefault();
    mixer.a.setNudge(code === "KeyS" ? -1 : 1);
    return;
  }
  if (state.lesson >= 4 && !event.repeat && (code === "KeyN" || code === "KeyM")) {
    event.preventDefault();
    mixer.b.setNudge(code === "KeyN" ? -1 : 1);
    return;
  }
  if (code === "KeyQ" && state.lesson >= 2) {
    event.preventDefault();
    handleTransport(mixer.a, "a");
    return;
  }
  if (code === "KeyA" && state.lesson >= 2) {
    event.preventDefault();
    handleCue(mixer.a, "a");
    return;
  }
  if (code === "KeyP" && state.lesson >= 3) {
    event.preventDefault();
    handleTransport(mixer.b, "b");
    return;
  }
  if (code === "KeyL" && state.lesson >= 3) {
    event.preventDefault();
    handleCue(mixer.b, "b");
    return;
  }
  if (code === "KeyY" && state.syncUnlocked) {
    event.preventDefault();
    syncRight();
    return;
  }
  const sampleKey = {
    Digit1: ["a", 0],
    Digit2: ["a", 1],
    Digit3: ["a", 2],
    Digit8: ["b", 0],
    Digit9: ["b", 1],
    Digit0: ["b", 2],
  }[code];
  if (!sampleKey) return;
  const [side, index] = sampleKey;
  if (side === "a" && state.lesson < 2) return;
  if (side === "b" && state.lesson < 3) return;
  const sample = samples[index];
  if (!sample) return;
  event.preventDefault();
  loadBuiltIn(side === "a" ? mixer.a : mixer.b, sample.id);
}

function onKeyUp(event) {
  if (event.code === "KeyS" && mixer.a.nudge === -1) mixer.a.setNudge(0);
  if (event.code === "KeyD" && mixer.a.nudge === 1) mixer.a.setNudge(0);
  if (event.code === "KeyN" && mixer.b.nudge === -1) mixer.b.setNudge(0);
  if (event.code === "KeyM" && mixer.b.nudge === 1) mixer.b.setNudge(0);
}

function bindNudge(id, deck, direction) {
  const button = $(id);
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    deck.setNudge(direction);
  });
  const release = () => deck.setNudge(0);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
}

function bindEq(side) {
  const deck = side === "a" ? mixer.a : mixer.b;
  for (const band of ["low", "mid", "high"]) {
    const input = $(`#eq-${side}-${band}`);
    const value = $(`#eq-${side}-${band}-value`);
    input.addEventListener("input", () => {
      const db = Number(input.value);
      deck.setEq(band, db);
      value.textContent = `${db > 0 ? "+" : ""}${db} dB`;
    });
  }
}

function buildSampleButtons() {
  for (const side of ["a", "b"]) {
    const box = $(`#samples-${side}`);
    samples.forEach((sample, index) => {
      const button = document.createElement("button");
      const key = side === "a" ? index + 1 : [8, 9, 0][index];
      button.type = "button";
      button.append(document.createTextNode(sample.name));
      const kbd = document.createElement("kbd");
      kbd.textContent = String(key);
      button.append(kbd);
      button.dataset.tip = `Load ${sample.name}, a short original loop made for these lessons. Key ${key}.`;
      button.addEventListener("click", () => {
        if (!state.audioOn) return;
        loadBuiltIn(side === "a" ? mixer.a : mixer.b, sample.id);
      });
      box.appendChild(button);
    });
  }
}

function bind() {
  $("#start").addEventListener("click", () => { startAudio(); });
  $("#continue").addEventListener("click", advance);
  $("#reset").addEventListener("click", () => {
    localStorage.removeItem("practice-dj");
    state.unlocked = 1;
    state.syncUnlocked = false;
    mixer.a.unload();
    mixer.b.unload();
    metronome.stop();
    if (state.audioOn) enterLesson(1);
    else {
      state.lesson = 1;
      render();
    }
  });
  $("#tap").addEventListener("click", () => {
    if (state.audioOn && state.lesson === 1) onTap();
  });
  for (let i = 1; i <= 4; i++) {
    $(`#pip-${i}`).addEventListener("click", () => {
      if (!state.audioOn || i > state.unlocked) return;
      enterLesson(i);
    });
  }
  $("#play-a").addEventListener("click", () => handleTransport(mixer.a, "a"));
  $("#play-b").addEventListener("click", () => handleTransport(mixer.b, "b"));
  $("#cue-a").addEventListener("click", () => handleCue(mixer.a, "a"));
  $("#cue-b").addEventListener("click", () => handleCue(mixer.b, "b"));
  $("#sync").addEventListener("click", syncRight);
  $("#file-a").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) loadFile(mixer.a, file);
  });
  $("#file-b").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) loadFile(mixer.b, file);
  });
  for (const side of ["a", "b"]) {
    $(`#tempo-${side}`).addEventListener("input", (event) => {
      const deck = side === "a" ? mixer.a : mixer.b;
      deck.setRate(1 + Number(event.target.value) / 100);
      state.movedTempo = true;
      updateTempoLabel(side);
    });
    bindEq(side);
  }
  $("#cross").addEventListener("input", (event) => setCross(Number(event.target.value)));
  bindNudge("#nudge-a-later", mixer.a, -1);
  bindNudge("#nudge-a-earlier", mixer.a, 1);
  bindNudge("#nudge-b-later", mixer.b, -1);
  bindNudge("#nudge-b-earlier", mixer.b, 1);
  document.addEventListener("keydown", (event) => {
    if (!state.audioOn) {
      event.preventDefault();
      startAudio();
      return;
    }
    onKeyDown(event);
  });
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("pointerover", (event) => {
    const el = tipTarget(event);
    if (el) showTip(el);
  });
  document.addEventListener("pointerout", (event) => {
    const el = tipTarget(event);
    if (!el || el.contains(event.relatedTarget)) return;
    hideTip();
  });
  document.addEventListener("focusin", (event) => {
    const el = tipTarget(event);
    if (el) showTip(el);
  });
  document.addEventListener("focusout", hideTip);
  window.addEventListener("resize", fitCanvases);
}

restore();
buildSampleButtons();
bind();
render();
requestAnimationFrame(frame);
