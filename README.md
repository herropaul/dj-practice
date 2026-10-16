# First beat

A beginner DJ practice page. It runs entirely in the browser: playback, tempo, EQ, and crossfading use the Web Audio API. There is no account, no analytics, and no upload. Songs you open stay on your computer.

## Lessons

Lessons open one at a time. Progress is remembered in this browser.

1. **Tap the beat.** A click flashes a lamp. Land 8 taps in a row on the click.
2. **Start on the beat.** One deck. Cue back to the first beat, press play as the lamp flashes, then pause.
3. **Hand the song over.** Two decks and a crossfader. Play both songs and move the crossfader from the left side to the right. A note under the fader explains the clash when the kicks miss each other.
4. **Make the beats agree.** Tempo sliders (the pitch moves with the speed, like a record) and a stacked waveform. The bright lines are beats; they walk apart when the tempos differ. Line them up and hold that for two seconds. **Sync stays hidden until you do this yourself.** After that, Y jumps the right song onto the left song's tempo and beat.

Phrasing, EQ swaps, and recording are intentionally not part of this.

## Run it

Modules will not load from a `file://` address. From this folder:

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`. Headphones help on lesson 4.

## Keys

| Key | What it does |
| --- | --- |
| Space | Tap the click (lesson 1) |
| Q / A | Play or pause / cue the left song |
| P / L | Play or pause / cue the right song |
| Left / Right | Move the crossfader |
| Z / X | Left tempo down / up (Shift is a bigger step) |
| , / . | Right tempo down / up |
| S / D | Hold to nudge the left kick later / sooner |
| N / M | Hold to nudge the right kick later / sooner |
| 1 2 3 | Load Floor, Push, or Stroll on the left |
| 8 9 0 | Load those loops on the right |
| Y | Sync the right song, after you earn it |
| Enter | Continue, once the lesson is done |

Every control also has a plain-language tooltip. Tab reaches the bass, middle, and treble sliders; the arrow keys move a slider while it is focused.

## Built-in loops

Floor (120), Push (126), and Stroll (100) are synthesized by `js/samples.js` when a lesson needs them. They are original sounds made for this project.

**License:** these loops are dedicated to the public domain under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). You can copy, change, and use them for any purpose. No other audio is included.

The app measures tempo from the bass hits when a loop or a file loads. It looks for a steady beat between about 70 and 180 BPM. A song with no steady kick shows "No steady beat".

## Tests

```bash
npm test
```

That runs the tempo detector against clicks, silence, noise, a plain tone, and the built-in loops. `tests/verify-ui.mjs` drives the lessons in Chrome (it needs `puppeteer-core` and a local Chrome). It is not part of `npm test`.

## GitHub Pages

`.github/workflows/pages.yml` publishes the page on every push to `main`. In the repository settings, open **Pages → Build and deployment → Source** and choose **GitHub Actions**. The workflow cannot flip that setting for you. After it is on, the action deploys the static `index.html`, `css/`, and `js/` files.
