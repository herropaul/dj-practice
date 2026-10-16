/**
 * Tempo from a mono buffer.
 *
 * The bass is followed for about twenty seconds. Autocorrelation finds the
 * gap that repeats, inside a beginner range of roughly 70–180 BPM. A loop
 * stands well clear of the other gaps; silence and noise do not, and come
 * back as null.
 */

const MIN_BPM = 70;
const MAX_BPM = 180;
const MIN_CONFIDENCE = 0.2;

export function analyzeTrack(samples, sampleRate) {
  if (!samples || !sampleRate || samples.length < sampleRate * 0.5) {
    return { bpm: null, downbeat: 0 };
  }
  return {
    bpm: bpmFromEnvelope(samples, sampleRate),
    downbeat: firstTransient(samples, sampleRate),
  };
}

export function detectBpm(samples, sampleRate) {
  return analyzeTrack(samples, sampleRate).bpm;
}

/** Shortest signed wrap of (phaseB - phaseA), in fractions of a beat. */
export function wrapPhaseDelta(phaseA, phaseB) {
  let delta = phaseB - phaseA;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

/**
 * Milliseconds phaseB sits relative to phaseA.
 * Positive means phaseB is late.
 */
export function beatOffsetMs(phaseA, phaseB, bpm) {
  if (!bpm) return null;
  return -wrapPhaseDelta(phaseA, phaseB) * (60000 / bpm);
}

function bpmFromEnvelope(samples, sampleRate) {
  const built = onsetEnvelope(samples, sampleRate);
  if (!built) return null;
  const { frames, hopSeconds } = built;
  const minLag = Math.max(2, Math.round(60 / (MAX_BPM + 4) / hopSeconds));
  const maxLag = Math.min(frames.length - 4, Math.round(60 / (MIN_BPM - 4) / hopSeconds));
  if (maxLag <= minLag + 2) return null;

  let energy = 0;
  for (let i = 0; i < frames.length; i++) energy += frames[i] * frames[i];
  if (energy < 1e-8) return null;

  const endLag = Math.min(frames.length - 2, maxLag * 2 + 1);
  const correlation = new Float32Array(endLag + 1);
  for (let lag = minLag - 1; lag <= endLag; lag++) {
    let sum = 0;
    const end = frames.length - lag;
    for (let i = 0; i < end; i++) sum += frames[i] * frames[i + lag];
    correlation[lag] = sum;
  }

  const score = new Float32Array(maxLag + 2);
  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let combined = correlation[lag];
    const twice = lag * 2;
    if (twice <= endLag) combined += correlation[twice] * 0.35;
    score[lag] = combined;
    if (combined > best) {
      best = combined;
      bestLag = lag;
    }
  }

  if (best / energy < MIN_CONFIDENCE) return null;
  const refined = bestLag + parabola(score[bestLag - 1] || 0, best, score[bestLag + 1] || 0);
  const bpm = 60 / (refined * hopSeconds);
  if (!(bpm >= MIN_BPM && bpm <= MAX_BPM)) return null;
  return Math.round(bpm * 10) / 10;
}

function onsetEnvelope(samples, sampleRate) {
  const limit = Math.min(samples.length, Math.floor(sampleRate * 20));
  const coeff = 1 - Math.exp((-2 * Math.PI * 90) / sampleRate);
  const hop = Math.max(1, Math.round(sampleRate / 500));
  const hops = Math.floor(limit / hop);
  if (hops < 64) return null;

  const raw = new Float32Array(hops);
  let low = 0;
  let acc = 0;
  let count = 0;
  let frame = 0;
  for (let i = 0; i < limit; i++) {
    low += coeff * (samples[i] - low);
    acc += low * low;
    count += 1;
    if (count === hop) {
      raw[frame] = acc / hop;
      frame += 1;
      acc = 0;
      count = 0;
    }
  }

  const onset = new Float32Array(hops);
  for (let i = 1; i < hops; i++) {
    const diff = raw[i] - raw[i - 1];
    onset[i] = diff > 0 ? diff : 0;
  }
  const smooth = new Float32Array(hops);
  for (let i = 0; i < hops; i++) {
    const left = onset[Math.max(0, i - 1)];
    const right = onset[Math.min(hops - 1, i + 1)];
    smooth[i] = (left + onset[i] + right) / 3;
  }
  let mean = 0;
  for (let i = 0; i < hops; i++) mean += smooth[i];
  mean /= hops;
  let peak = 0;
  for (let i = 0; i < hops; i++) {
    smooth[i] -= mean;
    peak = Math.max(peak, Math.abs(smooth[i]));
  }
  if (peak < 1e-12) return null;
  return { frames: smooth, hopSeconds: hop / sampleRate };
}

function parabola(y0, y1, y2) {
  const denom = y0 - 2 * y1 + y2;
  if (Math.abs(denom) < 1e-12) return 0;
  return Math.max(-0.8, Math.min(0.8, (0.5 * (y0 - y2)) / denom));
}

function firstTransient(samples, sampleRate) {
  const limit = Math.min(samples.length, Math.floor(sampleRate * 30));
  let peak = 0;
  for (let i = 0; i < limit; i += 8) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-4) return 0;
  const threshold = peak * 0.2;
  for (let i = 0; i < limit; i++) {
    if (Math.abs(samples[i]) >= threshold) return i / sampleRate;
  }
  return 0;
}
