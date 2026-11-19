'use strict';

/* Cropped-Dacast-first-tap / bounded-session diagnostic only. Never synthesize a provider click. */
const NEXUS_DWT_VIEWS = Object.freeze({
  us: Object.freeze({ label: 'Windsor inspection · USA-bound', url: 'https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/4aea1c45-d402-3690-afae-fe635942da82' }),
  ca: Object.freeze({ label: 'Detroit inspection · Canada-bound', url: 'https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/794566d4-a75e-3cd1-6f95-2d60e54f2fdb' }),
  randolph: Object.freeze({ label: 'Randolph Street · Canada-bound', url: 'https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/5408b5c3-f8d1-f34b-a18a-9943047905b6' })
});
const NEXUS_DWT_SESSION_MS = 9000;
const NEXUS_DWT_PREPARE_IDLE_MS = 20000;

/* Pure policy: launch and Resume both have fixed limits; a fresh user action is required to restart. */
function nexusDwtDeadline(startedAt, durationMs) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new TypeError('Finite start and positive duration required');
  }
  return startedAt + durationMs;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NEXUS_DWT_VIEWS, NEXUS_DWT_SESSION_MS, NEXUS_DWT_PREPARE_IDLE_MS, nexusDwtDeadline };
}

if (typeof document !== 'undefined') {
  (() => {
    const $ = id => document.getElementById(id);
    const main = $('labMain'), pill = $('cameraPill'), host = $('playerLayer');
    const shade = $('modalShade'), target = $('modalTarget'), expired = $('expiredPanel');
    const events = [], sessions = [];
    let state = 'idle', frame = null, generation = 0, current = null;
    let launchTimer = null, sessionTimer = null, paintTimer = null, idleTimer = null;
    let preparedAt = null, lastFocusSource = 'none', sessionSequence = 0, firstHandoffCount = 0;
    let focusTarget = null, handlingHidden = false;

    function now() { return performance.now(); }
    function format(ms) { return (Math.max(0, ms) / 1000).toFixed(1) + 's'; }
    function log(msg) {
      events.push(new Date().toISOString() + ' ' + msg);
      if (events.length > 100) events.shift();
      $('log').textContent = events.join('\n');
    }
    function clearTimers() {
      if (launchTimer !== null) clearTimeout(launchTimer);
      if (sessionTimer !== null) clearTimeout(sessionTimer);
      if (paintTimer !== null) clearInterval(paintTimer);
      if (idleTimer !== null) clearTimeout(idleTimer);
      launchTimer = sessionTimer = paintTimer = idleTimer = null;
    }
    function stopMedia() {
      generation++;
      if (frame) {
        frame.removeAttribute('src');
        frame.src = 'about:blank';
        frame.remove();
        frame = null;
      }
      host.replaceChildren();
      host.hidden = true;
      host.classList.remove('expanded');
    }
    function positionLayer() {
      if (!frame) return;
      const rect = (state === 'playing' || state === 'resuming' || state === 'launching') && !shade.hidden
        ? target.getBoundingClientRect() : pill.getBoundingClientRect();
      host.style.left = rect.left + 'px';
      host.style.top = rect.top + 'px';
      host.style.width = rect.width + 'px';
      host.style.height = rect.height + 'px';
      if (state === 'expired' && !shade.hidden) positionExpired();
    }
    function positionExpired() {
      if (expired.hidden) return;
      const r = target.getBoundingClientRect();
      expired.style.left = r.left + 'px';
      expired.style.top = r.top + 'px';
      expired.style.width = r.width + 'px';
      expired.style.height = r.height + 'px';
    }
    function render() {
      pill.classList.toggle('launching', state === 'launching');
      const overlay = state === 'playing' || state === 'launching' || state === 'resuming' || state === 'expired';
      shade.hidden = !overlay;
      expired.hidden = state !== 'expired';
      host.classList.toggle('expanded', overlay);
      document.body.classList.toggle('modal-open', overlay);
      main.inert = overlay;
      $('manualOpen').disabled = state === 'playing' || state === 'launching' || state === 'resuming';
      $('mark').disabled = !(state === 'playing' || state === 'resuming') || !current || current.markedAt !== null;
      $('prepare').disabled = overlay;
      $('camera').disabled = overlay;
      $('handoff').disabled = overlay;
      $('resumeMode').disabled = overlay;
      $('stopAll').disabled = false;
      const messages = {
        idle: 'No stream loaded. Press Prepare to arm the cropped native Play control.',
        armed: 'Ready · tap Camera once. The tap reaches Dacast’s own Play control.',
        launching: 'Native iframe focus detected. Expanding the same iframe…',
        playing: 'Modal open · nine-second cutoff armed.',
        resuming: 'Resumed iframe loaded in modal. If video does not start, tap native Play.',
        expired: 'Preview ended · iframe removed. Resume is available inside modal.'
      };
      $('launcherStatus').textContent = messages[state] || messages.idle;
      if (overlay) {
        $('modalTitle').textContent = NEXUS_DWT_VIEWS[$('camera').value].label;
        $('modalSubtitle').textContent = state === 'resuming'
          ? 'Resume via fresh iframe · native Play may still be needed'
          : 'Same native Dacast iframe · nine-second session';
        $('modalStatus').textContent = state === 'expired'
          ? 'The iframe has been removed. No player remains active.'
          : 'Iframe focus is not proof of playback. Mark actual moving footage only when seen.';
      }
      positionLayer();
      positionExpired();
      renderHistory();
    }
    function renderHistory() {
      const ul = $('history');
      ul.replaceChildren();
      if (!sessions.length) {
        const li = document.createElement('li'); li.textContent = 'No sessions yet.'; ul.append(li);
        return;
      }
      sessions.forEach(s => {
        const li = document.createElement('li');
        const strong = document.createElement('strong');
        strong.textContent = '#' + s.id + ' · ' + NEXUS_DWT_VIEWS[s.camera].label + ' · ' + s.kind;
        const line = document.createElement('div');
        line.textContent = (s.ended ? 'Stopped at +' + format(s.elapsed) + ' (' + s.reason + ')' : 'Active / awaiting cutoff') +
          ' · focus: ' + s.focus + ' · iframe load: ' + (s.loadOffset === null ? 'not observed' : '+' + format(s.loadOffset)) +
          ' · moving footage: ' + (s.markOffset === null ? 'not marked' : '+' + format(s.markOffset));
        const result = document.createElement('div');
        result.textContent = 'Observation: ' + s.result;
        li.append(strong, line, result);
        ul.append(li);
      });
    }
    function markEnded(reason) {
      if (!current || current.ended) return;
      current.ended = true;
      current.elapsed = Math.round(now() - current.startAt);
      current.reason = reason;
      current.endedIso = new Date().toISOString();
      log('Session #' + current.id + ' ended +' + format(current.elapsed) + ' · ' + reason);
      renderHistory();
    }
    function killAtDeadline() {
      if (!current || current.ended) return;
      markEnded('9-second cutoff · iframe destroyed');
      clearTimers();
      stopMedia();
      state = 'expired';
      $('timer').textContent = '0.0s';
      $('timerDescription').textContent = 'Camera stream unloaded';
      $('result').value = current.result;
      render();
      const resumeButton = $('resume');
      resumeButton.focus({ preventScroll: true });
    }
    function paintCountdown() {
      if (!current || current.ended) return;
      const remaining = Math.max(0, current.deadlineAt - now());
      $('timer').textContent = format(remaining);
      $('timerDescription').textContent = current.kind === 'first'
        ? 'Nine seconds from native iframe focus'
        : 'Nine seconds from Resume action (not confirmed playback)';
    }
    function startBoundedSession(kind, source) {
      const startAt = now();
      current = {
        id: ++sessionSequence,
        camera: $('camera').value,
        kind: kind,
        startIso: new Date().toISOString(),
        startAt: startAt,
        deadlineAt: nexusDwtDeadline(startAt, NEXUS_DWT_SESSION_MS),
        loadOffset: null,
        markOffset: null,
        markedAt: null,
        focus: source,
        ended: false,
        elapsed: null,
        reason: '',
        result: 'untested',
        endedIso: null
      };
      sessions.unshift(current);
      if (sessions.length > 30) sessions.pop();
      $('result').value = 'untested';
      const selected = current;
      sessionTimer = setTimeout(() => {
        if (current === selected && !selected.ended) killAtDeadline();
      }, NEXUS_DWT_SESSION_MS);
      paintTimer = setInterval(paintCountdown, 100);
      paintCountdown();
      log('Session #' + selected.id + ' started · ' + kind + ' · trigger=' + source + ' · cutoff 9.0s');
      renderHistory();
    }
    function onFrameLoad(f, token) {
      if (token !== generation || f !== frame) return;
      if (current && !current.ended && current.loadOffset === null) {
        current.loadOffset = Math.round(now() - current.startAt);
      }
      log('Dacast iframe load event · not proof of playback · state=' + state);
      renderHistory();
    }
    function onFocus(f, token, source) {
      if (token !== generation || f !== frame) return;
      if (state === 'armed') {
        state = 'launching';
        lastFocusSource = source;
        firstHandoffCount++;
        if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
        startBoundedSession('first', source);
        render();
        log('Native iframe focus from ' + source + '; scheduling handoff; not playback proof');
        const delayMs = Number($('handoff').value);
        launchTimer = setTimeout(() => {
          launchTimer = null;
          if (token !== generation || state !== 'launching') return;
          state = 'playing';
          render();
          log('Expanded same iframe after ' + delayMs + 'ms; retained Play gesture target');
        }, delayMs);
        return;
      }
      if (state === 'resuming') log('Resumed modal iframe focused; session deadline remains anchored to Resume click');
    }
    function createFrame() {
      const selected = NEXUS_DWT_VIEWS[$('camera').value];
      if (!selected) return;
      const token = ++generation;
      const f = document.createElement('iframe');
      f.title = 'DWT · ' + selected.label + ' · native Dacast Play';
      f.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
      f.allowFullscreen = true;
      f.referrerPolicy = 'no-referrer';
      f.loading = 'eager';
      f.addEventListener('load', () => onFrameLoad(f, token));
      f.addEventListener('focus', () => onFocus(f, token, 'iframe focus'));
      f.addEventListener('error', () => {
        if (token === generation) log('Iframe element error; provider internals inaccessible');
      });
      f.src = selected.url;
      host.replaceChildren(f);
      host.hidden = false;
      frame = f;
      log('Fresh original Dacast iframe created; generation ' + token);
    }
    function prepare() {
      clearTimers();
      if (current && !current.ended) markEnded('Reset before cutoff');
      stopMedia();
      current = null;
      state = 'armed';
      preparedAt = now();
      render();
      createFrame();
      positionLayer();
      const token = generation;
      idleTimer = setTimeout(() => {
        if (state === 'armed' && token === generation) {
          log('Prepared iframe inactive for 20s; unloading to avoid an indefinite live connection');
          closeAll('Prepared player idle safety release');
        }
      }, NEXUS_DWT_PREPARE_IDLE_MS);
      log('Cropped 480×270 Dacast frame, 6× magnification, native center Play; camera=' + $('camera').value);
    }
    function manualOpen() {
      if (state === 'idle' || state === 'expired') prepare();
      if (state !== 'armed') return;
      if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
      startBoundedSession('first', 'manual modal open; native Play not asserted');
      state = 'playing';
      render();
      log('Manual recovery: modal opened; a native Play tap may be needed');
    }
    function resume() {
      if (state !== 'expired') return;
      const mode = $('resumeMode').value;
      if (mode === 'pill') {
        log('User tapped Resume → return to cropped native Play launcher');
        closeModalOnly();
        prepare();
        $('launcherStatus').textContent = 'Resume armed. Tap the cropped Camera pill to press native Play.';
        return;
      }
      clearTimers();
      stopMedia();
      state = 'resuming';
      render();
      startBoundedSession('resume', 'Resume button click; no playback assumption');
      createFrame();
      positionLayer();
      log('Resume button created a new iframe in modal. No synthetic player click. Native Play may be required.');
    }
    function closeModalOnly() {
      shade.hidden = true;
      expired.hidden = true;
      document.body.classList.remove('modal-open');
      main.inert = false;
    }
    function closeAll(reason) {
      clearTimers();
      if (current && !current.ended) markEnded(reason);
      stopMedia();
      state = 'idle';
      current = null;
      preparedAt = null;
      closeModalOnly();
      render();
      log('Full teardown: ' + reason);
    }
    function recordMark() {
      if (!current || current.ended || current.markedAt !== null) return;
      current.markedAt = now();
      current.markOffset = Math.round(current.markedAt - current.startAt);
      $('mark').disabled = true;
      log('Session #' + current.id + ': viewer marked moving footage +' + format(current.markOffset));
      renderHistory();
    }
    function makeReport() {
      const lines = [
        'Nexus DWT cropped native-Play / 9s kill + Resume diagnostic',
        'UTC: ' + new Date().toISOString(),
        'Origin: ' + location.origin,
        'Browser: ' + navigator.userAgent,
        'Camera last selected: ' + NEXUS_DWT_VIEWS[$('camera').value].label,
        'Handoff delay: ' + $('handoff').value + 'ms',
        'Resume strategy: ' + $('resumeMode').selectedOptions[0].textContent,
        'Configuration: original 480×270 native iframe cropped 6× under white Camera control; same iframe expanded without reparenting',
        'Initial 9-second timer: native iframe focus (not video proof); Resume timer: user Resume action',
        'Safety: 20-second prepared idle release; iframe destroyed at cutoff/close/hide',
        'First focus handoffs observed: ' + firstHandoffCount,
        'Iframe load/focus cannot confirm moving video. User markers are observations, not player API callbacks.',
        '',
        'Sessions:'
      ];
      sessions.slice().reverse().forEach(s => {
        lines.push('#' + s.id + ' · ' + NEXUS_DWT_VIEWS[s.camera].label + ' · ' + s.kind);
        lines.push('  Started: ' + s.startIso + '; focus: ' + s.focus);
        lines.push('  Loaded: ' + (s.loadOffset === null ? 'not observed during session' : '+' + format(s.loadOffset)) +
          '; moving footage: ' + (s.markOffset === null ? 'not marked' : '+' + format(s.markOffset)));
        lines.push('  End: ' + (s.ended ? '+' + format(s.elapsed) + ', ' + s.reason : 'active'));
        lines.push('  Result: ' + s.result);
      });
      lines.push('', 'Notes: ' + ($('notes').value.trim() || 'None'), '', 'Events:', ...events);
      return lines.join('\n');
    }
    $('prepare').addEventListener('click', prepare);
    $('manualOpen').addEventListener('click', manualOpen);
    $('stopAll').addEventListener('click', () => closeAll('Manual stop / unload'));
    $('close').addEventListener('click', () => closeAll('Modal closed'));
    $('resume').addEventListener('click', resume);
    $('mark').addEventListener('click', recordMark);
    $('camera').addEventListener('change', () => closeAll('Camera changed'));
    $('result').addEventListener('change', () => {
      if (current) { current.result = $('result').value; renderHistory(); }
    });
    $('clear').addEventListener('click', () => {
      closeAll('Report cleared');
      sessions.length = 0;
      events.length = 0;
      current = null;
      firstHandoffCount = 0;
      $('notes').value = '';
      $('result').value = 'untested';
      $('reportFallback').hidden = true;
      $('copyStatus').textContent = '';
      renderHistory();
      log('Report cleared. No video playing.');
    });
    $('copy').addEventListener('click', async () => {
      const report = makeReport();
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw Error('Clipboard unavailable');
        await navigator.clipboard.writeText(report);
        $('reportFallback').hidden = true;
        $('copyStatus').textContent = 'Copied. Paste the report into the Nexus project discussion.';
      } catch {
        $('reportFallback').hidden = false;
        $('reportFallback').value = report;
        $('reportFallback').select();
        $('copyStatus').textContent = 'Clipboard permission unavailable. Copy from the textbox below.';
      }
    });
    window.addEventListener('blur', () => {
      const token = generation, f = frame;
      setTimeout(() => {
        if (f && token === generation && f === frame && document.activeElement === f) {
          onFocus(f, token, 'window blur + iframe activeElement');
        }
      }, 0);
    });
    function escapeClose(event) {
      if (event.key === 'Escape' && !shade.hidden) { event.preventDefault(); closeAll('Escape / modal close'); }
    }
    document.addEventListener('keydown', escapeClose);
    shade.addEventListener('pointerdown', event => {
      if (event.target === shade) closeAll('Backdrop tapped');
    });
    window.addEventListener('resize', positionLayer);
    window.addEventListener('scroll', () => { if (frame && shade.hidden) positionLayer(); }, { passive: true });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', positionLayer);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !handlingHidden) {
        handlingHidden = true;
        closeAll('Page hidden (visibilitychange)');
      }
      if (!document.hidden) handlingHidden = false;
    });
    window.addEventListener('pagehide', () => closeAll('Page navigation / background'));
    render();
    log('Diagnostic loaded without iframe. Tap Prepare to initialize the cropped native Play target.');
  })();
}
