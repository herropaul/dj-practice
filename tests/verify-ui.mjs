/**
 * Headless pass through all four lessons.
 * Uses the system Chrome via puppeteer-core, which is not a project dependency:
 *   npm install --no-save puppeteer-core
 *   SHOTS=/tmp/dj-shots node tests/verify-ui.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const root = new URL("..", import.meta.url).pathname;
const shots = process.env.SHOTS || "/tmp/dj-shots";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const rel = normalize(decodeURIComponent(url.pathname));
  const path = rel === sep ? join(root, "index.html") : join(root, rel);
  if (!path.startsWith(root)) {
    res.writeHead(400);
    res.end("bad path");
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    console.error("404", path);
    res.writeHead(404);
    res.end("missing");
  }
});

function writeClickWav(path, bpm, sampleRate) {
  const seconds = 6;
  const total = Math.floor(seconds * sampleRate);
  const pcm = Buffer.alloc(total * 2);
  const period = Math.round((60 / bpm) * sampleRate);
  for (let at = 0; at + 400 < total; at += period) {
    let phase = 0;
    for (let i = 0; i < 400; i++) {
      const t = i / sampleRate;
      phase += (2 * Math.PI * 70) / sampleRate;
      const sample = Math.sin(phase) * Math.exp(-t * 24);
      pcm.writeInt16LE(Math.max(-32767, Math.min(32767, (sample * 28000) | 0)), (at + i) * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return writeFile(path, Buffer.concat([header, pcm]));
}

await mkdir(shots, { recursive: true });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const headed = process.env.HEADED === "1";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  headless: headed ? false : true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--window-position=40,40",
    "--window-size=1280,900",
  ],
});

const page = await browser.newPage();
page.setDefaultTimeout(20000);
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
const logs = [];
page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") logs.push(`console: ${msg.text()}`);
});

async function shot(name) {
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
}

async function text(sel) {
  return page.$eval(sel, (el) => el.textContent.trim());
}

function press(code, key) {
  return page.evaluate((code, key) => {
    document.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
  }, code, key);
}

async function tapOnFlashes(count) {
  await page.evaluate(async (count) => {
    const lamp = document.querySelector("#lamp");
    let got = 0;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`only ${got} flashes`)), 15000);
      const observer = new MutationObserver(() => {
        if (!lamp.classList.contains("on")) return;
        document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }));
        got += 1;
        if (got >= count) {
          clearTimeout(timer);
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(lamp, { attributes: true, attributeFilter: ["class"] });
    });
  }, count);
}

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0" });
  await page.click("#start");
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Tap"));

  await tapOnFlashes(12);
  await page.waitForSelector("#continue:not([hidden])");
  assert.match(await text("#streak"), /^8 \/ 8/);
  assert.match(await text("#status"), /Eight taps/);
  await shot("lesson1-tap");

  await page.click("#continue");
  await page.waitForFunction(() => document.querySelector("#lesson-title").textContent.includes("Start on the beat"));
  const bpmA = parseFloat(await text("#bpm-a"));
  assert.ok(Math.abs(bpmA - 120) <= 1, `left BPM ${bpmA}`);
  assert.match(await text("#name-a"), /Floor/);
  const wavePixels = await page.evaluate(() => {
    const canvas = document.querySelector("#wave-a");
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i] + data[i + 1] + data[i + 2] > 30) count += 1;
    return count;
  });
  assert.ok(wavePixels > 20, `waveform pixels ${wavePixels}`);

  await page.$eval("#eq-a-low", (el) => {
    el.value = "-6";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.match(await text("#eq-a-low-value"), /-6 dB/);

  await press("KeyA", "a");
  await page.evaluate(() => new Promise((resolve, reject) => {
    const lamp = document.querySelector("#lamp");
    const timer = setTimeout(() => reject(new Error("no flash for the start")), 5000);
    const observer = new MutationObserver(() => {
      if (!lamp.classList.contains("on")) return;
      clearTimeout(timer);
      observer.disconnect();
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ", key: "q", bubbles: true }));
      resolve();
    });
    observer.observe(lamp, { attributes: true, attributeFilter: ["class"] });
  }));
  assert.equal(await text("#play-a .label"), "Pause");
  const started = await text("#time-a");
  await new Promise((resolve) => setTimeout(resolve, 400));
  const later = await text("#time-a");
  assert.notEqual(started, later, `playhead did not move (${started} -> ${later})`);
  await shot("lesson2-deck");
  await press("KeyQ", "q");
  await page.waitForSelector("#continue:not([hidden])");
  assert.match(await text("#status"), /start on the click/i);

  await page.click("#continue");
  await page.waitForFunction(() => document.querySelector("#lesson-title").textContent.includes("Hand the song over"));
  const bpmB = parseFloat(await text("#bpm-b"));
  assert.ok(Math.abs(bpmB - 126) <= 1, `right BPM ${bpmB}`);
  await press("KeyQ", "q");
  await press("KeyP", "p");
  await page.$eval("#cross", (el) => {
    el.value = "0.5";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => /walking apart|gallop|faster|slower/.test(document.querySelector("#clash").textContent));
  assert.match(await text("#cross-label"), /middle/);
  assert.equal(await page.$eval("#sync", (el) => el.hidden), true);
  await shot("lesson3-clash");
  await page.$eval("#cross", (el) => {
    el.value = "1";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForSelector("#continue:not([hidden])");
  assert.match(await text("#cross-label"), /right song only/);

  await page.click("#continue");
  await page.waitForFunction(() => document.querySelector("#lesson-title").textContent.includes("Make the beats agree"));
  await page.waitForFunction(() => /BPM (fast|slow)/.test(document.querySelector("#drift-readout").textContent));
  assert.equal(await page.$eval("#sync", (el) => el.hidden), true);
  const before = await text("#drift-readout");
  assert.match(before, /BPM fast/);
  const gap = parseFloat(before.replace(/.*?([\d.]+) BPM.*/, "$1"));
  assert.ok(gap >= 3, `expected a clear speed gap, got ${before}`);
  await shot("lesson4-drift");
  await page.$eval("#tempo-b", (el) => {
    el.value = "2";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const beforeGap = before.match(/Speed gap: ([\d.]+)/)[1];
  await page.waitForFunction((gap) => {
    const match = document.querySelector("#drift-readout").textContent.match(/Speed gap: ([\d.]+)/);
    return match && match[1] !== gap;
  }, {}, beforeGap);
  const moved = await text("#drift-readout");
  const movedGap = Number(moved.match(/Speed gap: ([\d.]+)/)[1]);
  assert.ok(movedGap > Number(beforeGap) + 1, `tempo did not widen the gap (${before} -> ${moved})`);

  const percent = await page.evaluate(() => {
    const left = parseFloat(document.querySelector("#bpm-a").textContent);
    const right = parseFloat(document.querySelector("#bpm-b").textContent);
    return (left / right - 1) * 100;
  });
  await page.$eval("#tempo-b", (el, value) => {
    el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, percent);
  await press("KeyA", "a");
  await press("KeyL", "l");
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ", key: "q", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyP", key: "p", bubbles: true }));
  });
  await page.$eval("#cross", (el) => {
    el.value = "0.5";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForSelector("#sync:not([hidden])", { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector("#hold").textContent.includes("Sync is available"));
  const matched = await text("#drift-readout");
  assert.match(matched, /Speed gap: 0\.[0-4] BPM|Speed gap: 0\.0 BPM/);
  assert.match(matched, /together|ms/);
  const driftPixels = await page.evaluate(() => {
    const canvas = document.querySelector("#drift-canvas");
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 16) if (data[i] + data[i + 1] + data[i + 2] > 40) count += 1;
    return count;
  });
  assert.ok(driftPixels > 30, `drift canvas pixels ${driftPixels}`);
  await shot("lesson4-matched");

  const wavPath = join(shots, "user-click.wav");
  await writeClickWav(wavPath, 100, 44100);
  const fileInput = await page.$("#file-a");
  await fileInput.uploadFile(wavPath);
  await page.waitForFunction(() => /BPM/.test(document.querySelector("#bpm-a").textContent) && !document.querySelector("#bpm-a").textContent.includes("Listening"));
  const loaded = parseFloat(await text("#bpm-a"));
  assert.ok(Math.abs(loaded - 100) <= 1, `file BPM ${loaded}`);
  assert.match(await text("#name-a"), /user-click\.wav/);

  console.log("verified all four lessons");
  console.log({ bpmA, bpmB, before, moved, matched, wavePixels, driftPixels });
} catch (error) {
  await shot("failure");
  const status = await text("#status").catch(() => "");
  const hold = await text("#hold").catch(() => "");
  const drift = await text("#drift-readout").catch(() => "");
  console.error(logs.join("\n"));
  throw new Error(`${error.message}\nstatus: ${status}\nhold: ${hold}\ndrift: ${drift}`);
} finally {
  await browser.close();
  server.close();
}
