/* ============================================================
   BROWNS RADIO — app logic
   Vanilla JS, single IIFE. No frameworks, no build step.
   ============================================================ */
(function () {
  'use strict';

  var APP_VERSION = '1.2.0';

  /* ---------- playlist ---------- */
  var songs = (typeof SONGS !== 'undefined' && Array.isArray(SONGS)) ? SONGS : [];
  var hasTracks = songs.length > 0;

  /* ---------- constants ---------- */
  var STORAGE_KEY = 'brownsRadio.state.v1';
  var REPEAT_OFF = 0, REPEAT_ONE = 1, REPEAT_ALL = 2;
  var EQ_BARS = 24;
  var SCREENSAVER_DELAY = 30000; // 30s
  var TICKER_SPEED = 40;         // px per second
  var TICKER_PAUSE = 2;          // seconds paused at loop start
  var TICKER_GAP = 60;           // px between repeated titles

  /* ---------- elements ---------- */
  var audio = document.getElementById('audio');
  var lcdTitle = document.getElementById('lcd-title');
  var lcdFreq = document.getElementById('lcd-freq');
  var lcdElapsed = document.getElementById('lcd-elapsed');
  var lcdTotal = document.getElementById('lcd-total');
  var indShuffle = document.getElementById('ind-shuffle');
  var indRepeat = document.getElementById('ind-repeat');
  var eqCanvas = document.getElementById('eq');
  var seek = document.getElementById('seek');
  var seekElapsed = document.getElementById('seek-elapsed');
  var seekRemaining = document.getElementById('seek-remaining');
  var btnPlay = document.getElementById('btn-play');
  var btnPrev = document.getElementById('btn-prev');
  var btnNext = document.getElementById('btn-next');
  var btnRepeat = document.getElementById('btn-repeat');
  var btnShuffle = document.getElementById('btn-shuffle');
  var iconPlay = document.getElementById('icon-play');
  var iconPause = document.getElementById('icon-pause');
  var presetsEl = document.getElementById('presets');
  var tracklistEl = document.getElementById('tracklist');
  var screensaverEl = document.getElementById('screensaver');
  var ssPanel = document.getElementById('ss-panel');
  var ssTitle = document.getElementById('ss-title');
  var ssEqCanvas = document.getElementById('ss-eq');
  var embersCanvas = document.getElementById('embers');

  /* ---------- state ---------- */
  var current = 0;
  var repeatMode = REPEAT_OFF;
  var shuffleOn = false;
  var shuffleOrder = [];
  var shufflePos = 0;
  var pendingSeek = null;   // saved position to restore once metadata loads
  var seeking = false;      // user is dragging the seek bar
  var durations = {};       // track index -> duration (seconds)
  var presetMap = [];       // preset number (1-6) -> track index or null
  var trackRows = [];

  /* audio graph (created lazily on first tap — iOS requirement) */
  var audioCtx = null;
  var analyser = null;
  var freqData = null;
  var audioGraphFailed = false;

  var wakeLock = null;
  var eqRafId = null;

  /* ============================================================
     helpers
     ============================================================ */
  function fmtTime(secs) {
    if (!isFinite(secs) || secs < 0) secs = 0;
    var m = Math.floor(secs / 60);
    var s = Math.floor(secs % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function trackFreq(index) {
    return (87.9 + index * 0.4).toFixed(1);
  }

  function isPlaying() {
    return !audio.paused && !audio.ended;
  }

  /* ---------- persistence ---------- */
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        track: current,
        pos: audio.currentTime || 0,
        repeat: repeatMode,
        shuffle: shuffleOn
      }));
    } catch (e) { /* storage unavailable — resume just won't work */ }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /* ============================================================
     LCD ticker (RDS-style scroll for long titles)
     ============================================================ */
  var tickerStyle = document.createElement('style');
  document.head.appendChild(tickerStyle);

  function setLcdTitle(text) {
    lcdTitle.style.animation = 'none';
    lcdTitle.textContent = text;
    tickerStyle.textContent = '';

    var wrap = lcdTitle.parentElement;
    // wait a frame so widths are measurable after the text change
    requestAnimationFrame(function () {
      var textWidth = lcdTitle.scrollWidth;
      var boxWidth = wrap.clientWidth;
      if (textWidth <= boxWidth || boxWidth === 0) return;

      var distance = textWidth + TICKER_GAP;
      // duplicate the title so the loop is seamless
      lcdTitle.textContent = '';
      var a = document.createElement('span');
      a.textContent = text;
      var b = document.createElement('span');
      b.textContent = text;
      b.style.paddingLeft = TICKER_GAP + 'px';
      lcdTitle.appendChild(a);
      lcdTitle.appendChild(b);

      var scrollTime = distance / TICKER_SPEED;
      var total = TICKER_PAUSE + scrollTime;
      var pausePct = (TICKER_PAUSE / total * 100).toFixed(2);
      tickerStyle.textContent =
        '@keyframes lcd-ticker {' +
        '0%, ' + pausePct + '% { transform: translateX(0); }' +
        '100% { transform: translateX(-' + distance + 'px); }' +
        '}';
      lcdTitle.style.animation = 'lcd-ticker ' + total.toFixed(2) + 's ease-in-out infinite';
    });
  }

  /* ============================================================
     display updates
     ============================================================ */
  function updateTimes() {
    var dur = audio.duration;
    var cur = audio.currentTime || 0;
    lcdElapsed.textContent = fmtTime(cur);
    lcdTotal.textContent = fmtTime(dur);
    seekElapsed.textContent = fmtTime(cur);
    seekRemaining.textContent = '-' + fmtTime(isFinite(dur) ? Math.max(0, dur - cur) : 0);
    if (!seeking) {
      var pct = (isFinite(dur) && dur > 0) ? (cur / dur) * 1000 : 0;
      seek.value = Math.round(pct);
      seek.style.setProperty('--seek-fill', (pct / 10) + '%');
    }
  }

  function updateModeUI() {
    var labels = ['RPT OFF', 'RPT ONE', 'RPT ALL'];
    btnRepeat.textContent = labels[repeatMode];
    btnRepeat.classList.toggle('on', repeatMode !== REPEAT_OFF);
    btnShuffle.classList.toggle('on', shuffleOn);
    indShuffle.classList.toggle('on', shuffleOn);
    indRepeat.classList.toggle('on', repeatMode !== REPEAT_OFF);
    indRepeat.textContent = repeatMode === REPEAT_ONE ? 'RPT 1'
      : repeatMode === REPEAT_ALL ? 'RPT ALL' : 'RPT';
  }

  function updatePlayUI() {
    var playing = isPlaying();
    iconPlay.style.display = playing ? 'none' : '';
    iconPause.style.display = playing ? '' : 'none';
    btnPlay.classList.toggle('playing', playing);
    btnPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  var trackUiReady = false;
  function flashLcdTitle() {
    var wrap = lcdTitle.parentElement;
    if (!wrap) return;
    wrap.classList.remove('tc');
    void wrap.offsetWidth; // reflow so the animation can restart
    wrap.classList.add('tc');
  }

  function updateTrackUI() {
    if (!hasTracks) return;
    var song = songs[current];
    setLcdTitle(song.title || 'UNTITLED');
    lcdFreq.textContent = trackFreq(current);
    ssTitle.textContent = song.title || 'UNTITLED';
    // Subtle retune flash on genuine track changes (skip the first render).
    if (trackUiReady) flashLcdTitle();
    trackUiReady = true;
    trackRows.forEach(function (row, i) {
      row.classList.toggle('current', i === current);
    });
    presetMap.forEach(function (trackIndex, i) {
      var btn = presetsEl.children[i];
      if (btn) btn.classList.toggle('active', trackIndex === current);
    });
    updateMediaSessionMetadata();
  }

  /* ============================================================
     audio graph / EQ visualiser
     ============================================================ */
  function initAudioGraph() {
    if (audioCtx || audioGraphFailed) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('no AudioContext');
      audioCtx = new Ctx();
      var source = audioCtx.createMediaElementSource(audio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) {
      // Visualiser must never break playback — hide it and carry on.
      audioGraphFailed = true;
      audioCtx = null;
      analyser = null;
      eqCanvas.classList.add('hidden');
    }
  }

  function resumeAudioCtx() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
  }

  function sizeCanvas(canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    return canvas.getContext('2d');
  }

  function drawBars(canvas, levels) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    if (!ctx || w === 0) return;
    ctx.clearRect(0, 0, w, h);
    var n = levels.length;
    var gap = Math.max(1, Math.round(w * 0.012));
    var barW = (w - gap * (n - 1)) / n;
    for (var i = 0; i < n; i++) {
      var level = Math.max(0.04, Math.min(1, levels[i]));
      var barH = level * h;
      var x = i * (barW + gap);
      var y = h - barH;
      ctx.fillStyle = '#00A3FF';
      ctx.fillRect(x, y, barW, barH);
      // lighter tip
      var tipH = Math.min(barH, Math.max(2, h * 0.06));
      ctx.fillStyle = '#7FD4FF';
      ctx.fillRect(x, y, barW, tipH);
    }
  }

  function eqLevels() {
    var levels = [];
    if (analyser && freqData) {
      analyser.getByteFrequencyData(freqData);
      var usable = Math.floor(freqData.length * 0.85); // drop dead top bins
      var per = usable / EQ_BARS;
      for (var i = 0; i < EQ_BARS; i++) {
        var start = Math.floor(i * per);
        var end = Math.max(start + 1, Math.floor((i + 1) * per));
        var sum = 0;
        for (var j = start; j < end; j++) sum += freqData[j];
        levels.push((sum / (end - start)) / 255);
      }
    }
    return levels;
  }

  function eqLoop() {
    eqRafId = null;
    if (!isPlaying()) return;
    var levels = eqLevels();
    if (levels.length) {
      drawBars(eqCanvas, levels);
      if (screensaverActive) drawBars(ssEqCanvas, levels.slice(0, 12));
    } else if (screensaverActive) {
      // no analyser — gentle fake bars so the screensaver still breathes
      var fake = [];
      var t = performance.now() / 1000;
      for (var i = 0; i < 12; i++) {
        fake.push(0.18 + 0.14 * Math.abs(Math.sin(t * 2.1 + i * 0.9)));
      }
      drawBars(ssEqCanvas, fake);
    }
    eqRafId = requestAnimationFrame(eqLoop);
  }

  function startEq() {
    if (eqRafId === null) eqRafId = requestAnimationFrame(eqLoop);
  }

  function drawIdleBars() {
    if (audioGraphFailed) return;
    var levels = [];
    for (var i = 0; i < EQ_BARS; i++) levels.push(0.06 + 0.03 * ((i * 7) % 3));
    drawBars(eqCanvas, levels);
  }

  /* ============================================================
     playback
     ============================================================ */
  function loadTrack(index, autoplay) {
    if (!hasTracks) return;
    current = ((index % songs.length) + songs.length) % songs.length;
    audio.src = encodeURI(songs[current].file);
    updateTrackUI();
    updateTimes();
    saveState();
    if (autoplay) play();
  }

  function play() {
    if (!hasTracks) return;
    initAudioGraph();
    resumeAudioCtx();
    var p = audio.play();
    if (p && p.catch) p.catch(function () { updatePlayUI(); });
  }

  function pause() {
    audio.pause();
  }

  function togglePlay() {
    if (!hasTracks) return;
    if (isPlaying()) pause();
    else play();
  }

  /* ---------- shuffle ---------- */
  function buildShuffleOrder(startIndex) {
    shuffleOrder = songs.map(function (_, i) { return i; });
    for (var i = shuffleOrder.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffleOrder[i];
      shuffleOrder[i] = shuffleOrder[j];
      shuffleOrder[j] = tmp;
    }
    if (typeof startIndex === 'number') {
      var pos = shuffleOrder.indexOf(startIndex);
      if (pos > 0) {
        shuffleOrder.splice(pos, 1);
        shuffleOrder.unshift(startIndex);
      }
    }
    shufflePos = 0;
  }

  function nextTrack(fromEnded) {
    if (!hasTracks) return;
    if (shuffleOn) {
      if (shufflePos + 1 < shuffleOrder.length) {
        shufflePos++;
      } else if (!fromEnded || repeatMode === REPEAT_ALL) {
        buildShuffleOrder(); // all played — reshuffle
      } else {
        stopAtEnd();
        return;
      }
      loadTrack(shuffleOrder[shufflePos], true);
    } else {
      if (current + 1 < songs.length) {
        loadTrack(current + 1, true);
      } else if (!fromEnded || repeatMode === REPEAT_ALL) {
        loadTrack(0, true);
      } else {
        stopAtEnd();
      }
    }
  }

  function prevTrack() {
    if (!hasTracks) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (shuffleOn) {
      shufflePos = (shufflePos - 1 + shuffleOrder.length) % shuffleOrder.length;
      loadTrack(shuffleOrder[shufflePos], true);
    } else {
      loadTrack(current - 1, true);
    }
  }

  function stopAtEnd() {
    pause();
    audio.currentTime = 0;
    updateTimes();
    saveState();
  }

  function onEnded() {
    if (repeatMode === REPEAT_ONE) {
      audio.currentTime = 0;
      play();
      return;
    }
    nextTrack(true);
  }

  /* ============================================================
     presets
     ============================================================ */
  function buildPresets() {
    // preset field wins; remaining buttons fill with unclaimed songs in order
    presetMap = [null, null, null, null, null, null];
    var claimed = {};
    songs.forEach(function (song, i) {
      var p = song.preset;
      if (p >= 1 && p <= 6 && presetMap[p - 1] === null) {
        presetMap[p - 1] = i;
        claimed[i] = true;
      }
    });
    var fill = 0;
    for (var slot = 0; slot < 6; slot++) {
      if (presetMap[slot] !== null) continue;
      while (fill < songs.length && claimed[fill]) fill++;
      if (fill < songs.length) {
        presetMap[slot] = fill;
        claimed[fill] = true;
      }
    }

    presetsEl.innerHTML = '';
    presetMap.forEach(function (trackIndex, slot) {
      var btn = document.createElement('button');
      btn.className = 'btn btn-preset';
      btn.textContent = String(slot + 1);
      if (trackIndex === null) {
        btn.disabled = true;
      } else {
        btn.setAttribute('aria-label', 'Preset ' + (slot + 1) + ': ' + songs[trackIndex].title);
        btn.addEventListener('click', function () {
          if (shuffleOn) {
            buildShuffleOrder(trackIndex);
          }
          loadTrack(trackIndex, true);
        });
      }
      presetsEl.appendChild(btn);
    });
  }

  /* ============================================================
     track list
     ============================================================ */
  // Track which rows have already animated in, so a re-render never
  // re-triggers the staggered entrance for items already on screen.
  var renderedRowIds = new Set();

  function buildTracklist() {
    tracklistEl.innerHTML = '';
    trackRows = [];
    if (!hasTracks) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'NO TRACKS LOADED';
      tracklistEl.appendChild(li);
      return;
    }
    songs.forEach(function (song, i) {
      var row = document.createElement('li');
      var num = document.createElement('span');
      num.className = 't-num';
      num.textContent = String(i + 1).length < 2 ? '0' + (i + 1) : String(i + 1);
      var title = document.createElement('span');
      title.className = 't-title';
      title.textContent = song.title || 'Untitled';
      var dur = document.createElement('span');
      dur.className = 't-dur';
      dur.textContent = '–:––';
      row.appendChild(num);
      row.appendChild(title);
      row.appendChild(dur);
      row.addEventListener('click', function () {
        if (shuffleOn) buildShuffleOrder(i);
        loadTrack(i, true);
      });
      // Staggered fade-in from below — first appearance only.
      var rowId = song.file || ('idx-' + i);
      if (!renderedRowIds.has(rowId)) {
        renderedRowIds.add(rowId);
        row.classList.add('row-in');
        row.style.animationDelay = (i * 0.07) + 's';
      }
      tracklistEl.appendChild(row);
      trackRows.push(row);
    });
  }

  function setRowDuration(index, secs) {
    durations[index] = secs;
    var row = trackRows[index];
    if (row) row.querySelector('.t-dur').textContent = fmtTime(secs);
  }

  /* Populate durations lazily with one hidden probe element,
     one track at a time (metadata only — no manual fetching). */
  function probeDurations() {
    if (!hasTracks) return;
    var probe = document.createElement('audio');
    probe.preload = 'metadata';
    var i = -1;
    function nextProbe() {
      i++;
      if (i >= songs.length) { probe.removeAttribute('src'); return; }
      if (durations[i] !== undefined) { nextProbe(); return; }
      probe.src = encodeURI(songs[i].file);
    }
    probe.addEventListener('loadedmetadata', function () {
      if (isFinite(probe.duration)) setRowDuration(i, probe.duration);
      nextProbe();
    });
    probe.addEventListener('error', nextProbe);
    nextProbe();
  }

  /* ============================================================
     Media Session (lock screen / car controls)
     ============================================================ */
  function updateMediaSessionMetadata() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: hasTracks ? (songs[current].title || 'Untitled') : 'Browns Radio',
        artist: 'Browns Radio',
        album: 'BROWNS FM ' + (hasTracks ? trackFreq(current) : ''),
        artwork: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      });
    } catch (e) { /* metadata is cosmetic */ }
  }

  function updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    try {
      if (isFinite(audio.duration) && audio.duration > 0) {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate || 1,
          position: Math.min(audio.currentTime || 0, audio.duration)
        });
      }
    } catch (e) { /* ignore */ }
  }

  function initMediaSession() {
    if (!('mediaSession' in navigator)) return;
    var handlers = {
      play: function () { play(); },
      pause: function () { pause(); },
      previoustrack: function () { prevTrack(); },
      nexttrack: function () { nextTrack(false); },
      seekto: function (details) {
        if (details && typeof details.seekTime === 'number' && isFinite(audio.duration)) {
          audio.currentTime = Math.min(details.seekTime, audio.duration);
          updateTimes();
          updatePositionState();
        }
      }
    };
    Object.keys(handlers).forEach(function (action) {
      try {
        navigator.mediaSession.setActionHandler(action, handlers[action]);
      } catch (e) { /* action unsupported on this platform */ }
    });
  }

  /* ============================================================
     wake lock
     ============================================================ */
  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () {
        if (wakeLock === lock) wakeLock = null;
      });
    }).catch(function () { /* denied or low battery — fine */ });
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      if (isPlaying()) {
        requestWakeLock();
        resumeAudioCtx();
      }
      embersVisible = true;
      startEmbers();
    } else {
      embersVisible = false;
    }
  });

  /* ============================================================
     screensaver (burn-in guard, DVD-style drift)
     ============================================================ */
  var screensaverActive = false;
  var idleTimer = null;
  var ssRafId = null;
  var ssX = 40, ssY = 80, ssVX = 0.55, ssVY = 0.42;

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (isPlaying()) {
      idleTimer = setTimeout(activateScreensaver, SCREENSAVER_DELAY);
    }
  }

  function activateScreensaver() {
    if (!isPlaying() || screensaverActive) return;
    screensaverActive = true;
    screensaverEl.classList.add('active');
    sizeCanvas(ssEqCanvas);
    if (ssRafId === null) ssRafId = requestAnimationFrame(ssLoop);
    startEq(); // keeps mini EQ fed even if main loop idles
  }

  function deactivateScreensaver() {
    if (!screensaverActive) return;
    screensaverActive = false;
    screensaverEl.classList.remove('active');
    if (ssRafId !== null) {
      cancelAnimationFrame(ssRafId);
      ssRafId = null;
    }
  }

  function ssLoop() {
    ssRafId = null;
    if (!screensaverActive) return;
    var maxX = window.innerWidth - ssPanel.offsetWidth;
    var maxY = window.innerHeight - ssPanel.offsetHeight;
    ssX += ssVX;
    ssY += ssVY;
    if (ssX <= 0) { ssX = 0; ssVX = Math.abs(ssVX); }
    if (ssX >= maxX) { ssX = Math.max(0, maxX); ssVX = -Math.abs(ssVX); }
    if (ssY <= 0) { ssY = 0; ssVY = Math.abs(ssVY); }
    if (ssY >= maxY) { ssY = Math.max(0, maxY); ssVY = -Math.abs(ssVY); }
    ssPanel.style.transform = 'translate(' + ssX.toFixed(1) + 'px,' + ssY.toFixed(1) + 'px)';
    ssRafId = requestAnimationFrame(ssLoop);
  }

  ['pointerdown', 'touchstart', 'keydown'].forEach(function (evt) {
    document.addEventListener(evt, function () {
      deactivateScreensaver();
      resetIdleTimer();
    }, { passive: true });
  });

  /* ============================================================
     ember particles (very subtle, behind the radio face)
     ============================================================ */
  var embers = [];
  var embersVisible = true;
  var embersRafId = null;

  function initEmbers() {
    var ctx = sizeCanvas(embersCanvas);
    if (!ctx) return;
    embers = [];
    for (var i = 0; i < 13; i++) {
      embers.push({
        x: Math.random() * embersCanvas.width,
        y: Math.random() * embersCanvas.height,
        r: (1 + Math.random() * 2.2) * (window.devicePixelRatio || 1),
        vy: 0.1 + Math.random() * 0.25,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 0.004 + Math.random() * 0.006,
        alpha: 0.05 + Math.random() * 0.1
      });
    }
  }

  function embersLoop() {
    embersRafId = null;
    if (!embersVisible) return;
    var ctx = embersCanvas.getContext('2d');
    var w = embersCanvas.width, h = embersCanvas.height;
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < embers.length; i++) {
      var p = embers[i];
      p.y -= p.vy;
      p.sway += p.swaySpeed;
      var x = p.x + Math.sin(p.sway) * 14;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      ctx.beginPath();
      ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 163, 255, ' + p.alpha.toFixed(3) + ')';
      ctx.fill();
    }
    embersRafId = requestAnimationFrame(embersLoop);
  }

  function startEmbers() {
    if (embersRafId === null) embersRafId = requestAnimationFrame(embersLoop);
  }

  /* ============================================================
     event wiring
     ============================================================ */
  btnPlay.addEventListener('click', togglePlay);
  btnPrev.addEventListener('click', prevTrack);
  btnNext.addEventListener('click', function () { nextTrack(false); });

  btnRepeat.addEventListener('click', function () {
    repeatMode = (repeatMode + 1) % 3;
    updateModeUI();
    saveState();
  });

  btnShuffle.addEventListener('click', function () {
    shuffleOn = !shuffleOn;
    if (shuffleOn) buildShuffleOrder(current);
    updateModeUI();
    saveState();
  });

  seek.addEventListener('input', function () {
    seeking = true;
    seek.style.setProperty('--seek-fill', (seek.value / 10) + '%');
    if (isFinite(audio.duration)) {
      seekElapsed.textContent = fmtTime(audio.duration * seek.value / 1000);
    }
  });

  seek.addEventListener('change', function () {
    if (isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = audio.duration * seek.value / 1000;
    }
    seeking = false;
    updateTimes();
    updatePositionState();
  });

  audio.addEventListener('play', function () {
    updatePlayUI();
    startEq();
    requestWakeLock();
    resetIdleTimer();
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
    }
  });

  audio.addEventListener('pause', function () {
    updatePlayUI();
    drawIdleBars();
    releaseWakeLock();
    deactivateScreensaver();
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    saveState();
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = 'paused'; } catch (e) {}
    }
  });

  audio.addEventListener('ended', onEnded);

  audio.addEventListener('loadedmetadata', function () {
    if (pendingSeek !== null) {
      if (pendingSeek < audio.duration) audio.currentTime = pendingSeek;
      pendingSeek = null;
    }
    if (isFinite(audio.duration)) setRowDuration(current, audio.duration);
    updateTimes();
    updatePositionState();
  });

  var lastSave = 0;
  audio.addEventListener('timeupdate', function () {
    updateTimes();
    updatePositionState();
    var now = Date.now();
    if (now - lastSave > 4000) {
      lastSave = now;
      saveState();
    }
  });

  audio.addEventListener('error', function () {
    if (!hasTracks) return;
    setLcdTitle('TRACK ERROR — ' + (songs[current].title || 'UNTITLED'));
  });

  window.addEventListener('resize', function () {
    sizeCanvas(eqCanvas);
    initEmbers();
    if (!isPlaying()) drawIdleBars();
    if (screensaverActive) sizeCanvas(ssEqCanvas);
    setLcdTitle(hasTracks ? (songs[current].title || 'UNTITLED')
      : 'NO TRACKS LOADED — ADD SONGS TO music/ FOLDER');
  });

  window.addEventListener('pagehide', saveState);

  /* ============================================================
     boot
     ============================================================ */
  function boot() {
    buildPresets();
    buildTracklist();
    updateModeUI();
    initMediaSession();
    initEmbers();
    startEmbers();

    sizeCanvas(eqCanvas);
    drawIdleBars();

    if (!hasTracks) {
      setLcdTitle('NO TRACKS LOADED — ADD SONGS TO music/ FOLDER');
      btnPlay.disabled = true;
      btnPrev.disabled = true;
      btnNext.disabled = true;
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
          setLcdTitle('NO TRACKS LOADED — ADD SONGS TO music/ FOLDER');
        });
      }
      return;
    }

    var saved = loadState();
    if (saved) {
      if (typeof saved.repeat === 'number' && saved.repeat >= 0 && saved.repeat <= 2) {
        repeatMode = saved.repeat;
      }
      shuffleOn = !!saved.shuffle;
      if (typeof saved.track === 'number' && saved.track >= 0 && saved.track < songs.length) {
        current = saved.track;
        if (typeof saved.pos === 'number' && saved.pos > 0) pendingSeek = saved.pos;
      }
      updateModeUI();
    }
    if (shuffleOn) buildShuffleOrder(current);

    // restore paused — iOS forbids autoplay; first tap of play resumes
    loadTrack(current, false);
    probeDurations();

    // ticker widths shift once the Google Fonts arrive — re-measure
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        setLcdTitle(songs[current].title || 'UNTITLED');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // expose version for debugging in the console
  window.BROWNS_RADIO_VERSION = APP_VERSION;
})();
