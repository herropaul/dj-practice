/**
 * Original practice loops, synthesized in the browser.
 * Dedicated to the public domain under CC0 1.0. See the README.
 *
 * Each loop is an exact number of beats so it cycles without drifting.
 */

const SPECS = [
  { id: "floor", name: "Floor", bpm: 120, bass: 55 },
  { id: "push", name: "Push", bpm: 126, bass: 73.42 },
  { id: "stroll", name: "Stroll", bpm: 100, bass: 49 },
];

export function listSamples() {
  return SPECS.map(({ id, name, bpm }) => ({ id, name, bpm }));
}

export function renderSample(id, sampleRate) {
  const spec = SPECS.find((item) => item.id === id);
  if (!spec) throw new Error(`Unknown sample: ${id}`);
  const bars = 4;
  const beats = bars * 4;
  const beatSamples = Math.round((60 / spec.bpm) * sampleRate);
  const length = beats * beatSamples;
  const out = new Float32Array(length);

  for (let beat = 0; beat < beats; beat++) {
    const at = beat * beatSamples;
    addKick(out, sampleRate, at, 0.95);
    if (beat % 2 === 1) addClap(out, sampleRate, at, 0.34);
    if (beat % 2 === 0) addBass(out, sampleRate, at, spec.bass, 0.22);
    addHat(out, sampleRate, at, 0.11);
    const off = at + Math.floor(beatSamples / 2);
    if (off < length) addHat(out, sampleRate, off, 0.07);
  }

  normalize(out, 0.9);
  return { id: spec.id, name: spec.name, samples: out };
}

function addKick(out, sampleRate, at, amp) {
  const len = Math.min(out.length - at, Math.floor(sampleRate * 0.16));
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const freq = 48 + 150 * Math.exp(-t * 32);
    phase += (2 * Math.PI * freq) / sampleRate;
    const body = Math.sin(phase) * Math.exp(-t * 12);
    const click = noise(at + i * 17) * Math.exp(-t * 220);
    out[at + i] += (body * 0.92 + click * 0.28) * amp;
  }
}

function addClap(out, sampleRate, at, amp) {
  const len = Math.min(out.length - at, Math.floor(sampleRate * 0.1));
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const burst = Math.exp(-t * 16) * (0.55 + 0.45 * Math.sin(Math.PI * t * 90) ** 2);
    out[at + i] += noise(at * 3 + i) * burst * amp;
  }
}

function addHat(out, sampleRate, at, amp) {
  const len = Math.min(out.length - at, Math.floor(sampleRate * 0.035));
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const n = noise(at * 5 + i * 3);
    const high = n - prev;
    prev = n;
    out[at + i] += high * Math.exp(-t * 90) * amp;
  }
}

function addBass(out, sampleRate, at, freq, amp) {
  const len = Math.min(out.length - at, Math.floor(sampleRate * 0.18));
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    phase += (2 * Math.PI * freq) / sampleRate;
    const attack = Math.min(1, t / 0.008);
    out[at + i] += Math.sin(phase) * attack * Math.exp(-t * 7) * amp;
  }
}

function normalize(out, peak) {
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]));
  if (max < 1e-8) return;
  const gain = peak / max;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
}

function noise(i) {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
