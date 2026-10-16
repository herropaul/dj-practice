import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTrack, beatOffsetMs, detectBpm, wrapPhaseDelta } from "../js/bpm.js";
import { listSamples, renderSample } from "../js/samples.js";

function clicks(bpm, seconds, sampleRate, leadSeconds = 0) {
  const out = new Float32Array(Math.floor((seconds + leadSeconds) * sampleRate));
  const period = Math.round((60 / bpm) * sampleRate);
  const start = Math.floor(leadSeconds * sampleRate);
  for (let at = start; at + 300 < out.length; at += period) {
    let phase = 0;
    for (let i = 0; i < 300; i++) {
      const t = i / sampleRate;
      phase += (2 * Math.PI * 70) / sampleRate;
      out[at + i] += Math.sin(phase) * Math.exp(-t * 28);
    }
  }
  return out;
}

test("detects steady click tempos", () => {
  const sampleRate = 44100;
  for (const bpm of [90, 100, 120, 126, 140, 174]) {
    const heard = detectBpm(clicks(bpm, 8, sampleRate), sampleRate);
    assert.ok(heard != null, `no tempo for ${bpm}`);
    assert.ok(Math.abs(heard - bpm) <= 0.6, `heard ${heard} for ${bpm}`);
  }
});

test("detects a click track after a silent intro", () => {
  const sampleRate = 44100;
  const analysis = analyzeTrack(clicks(120, 8, sampleRate, 1.25), sampleRate);
  assert.ok(Math.abs(analysis.bpm - 120) <= 0.6);
  assert.ok(Math.abs(analysis.downbeat - 1.25) < 0.03, `downbeat ${analysis.downbeat}`);
});

test("returns null for silence, noise, and a steady tone", () => {
  const sampleRate = 44100;
  assert.equal(detectBpm(new Float32Array(sampleRate * 4), sampleRate), null);
  const noise = new Float32Array(sampleRate * 6);
  let seed = 17;
  for (let i = 0; i < noise.length; i++) {
    seed = (seed * 16807) % 2147483647;
    noise[i] = (seed / 2147483647) * 2 - 1;
  }
  assert.equal(detectBpm(noise, sampleRate), null);
  const tone = new Float32Array(sampleRate * 4);
  for (let i = 0; i < tone.length; i++) {
    tone[i] = Math.sin((2 * Math.PI * 80 * i) / sampleRate);
  }
  assert.equal(detectBpm(tone, sampleRate), null);
});

test("hears the built-in loops at the tempo they were built on", () => {
  for (const sampleRate of [44100, 48000]) {
    for (const spec of listSamples()) {
      const rendered = renderSample(spec.id, sampleRate);
      const analysis = analyzeTrack(rendered.samples, sampleRate);
      assert.ok(
        analysis.bpm != null && Math.abs(analysis.bpm - spec.bpm) <= 0.6,
        `${spec.id} @ ${sampleRate}: heard ${analysis.bpm}, wanted ${spec.bpm}`,
      );
      assert.ok(analysis.downbeat < 0.02, `${spec.id} downbeat ${analysis.downbeat}`);
    }
  }
});

test("wraps phase and reports lateness in milliseconds", () => {
  assert.ok(Math.abs(wrapPhaseDelta(0.1, 0.2) - 0.1) < 1e-9);
  assert.ok(Math.abs(wrapPhaseDelta(0.9, 0.1) - 0.2) < 1e-9);
  assert.ok(Math.abs(wrapPhaseDelta(0.1, 0.9) + 0.2) < 1e-9);
  // A phase that has already moved on is early, so the offset is negative.
  assert.ok(Math.abs(beatOffsetMs(0, 0.1, 120) - -50) < 1e-6);
  assert.ok(Math.abs(beatOffsetMs(0.05, 0.95, 120) - 50) < 1e-6);
});
