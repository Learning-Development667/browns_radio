# Browns Radio — rules for Claude

Browns Radio is a personal digital car-radio PWA (vanilla HTML/CSS/JS, no
frameworks, no build step) hosted on GitHub Pages at
https://learning-development667.github.io/browns_radio/

## Workflow rules

- **Always work directly on the `main` branch.** Never create feature
  branches and never open pull requests.
- **Never delete files in the `music/` or `icons/` folders.**
- **Bump the version number on every commit.** The version lives in two
  places that must stay in sync:
  - the `APP_VERSION` constant at the top of `js/scripts.js`
  - the visible version label in `index.html` (bottom corner)
- **Update the `?v=` cache-busting query strings in `index.html` on every
  commit** (the `<script>` tags for `content/songs.js` and
  `js/scripts.js`) so clients always fetch the new code.
- **Run `node --check` on all JS files before committing**
  (`js/scripts.js`, `content/songs.js`, `sw.js`).
- **Delete any handover brief files before committing.**

## Architecture notes

- `index.html` — all markup and all CSS (embedded `<style>` tag).
- `js/scripts.js` — all app logic in a single IIFE.
- `content/songs.js` — the playlist (`const SONGS = [...]`), loaded via a
  `<script>` tag before `scripts.js`. Adding a song = drop the file in
  `music/` + add one line here.
- `sw.js` — network-first service worker; cache name `browns-radio-v1`.
- Audio is played through a single `<audio>` element — never fetch or
  decode audio files manually.
- The Web Audio visualiser must never break playback: the AudioContext is
  created only on the first user tap, and any failure hides the
  visualiser while normal playback continues.
