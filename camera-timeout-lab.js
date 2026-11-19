'use strict';

/* Isolated DWT timing diagnostic. Source URLs and iframe attributes mirror board.js. */
const DWT_CAMERAS = Object.freeze({
  us: Object.freeze({ label: 'Windsor inspection · into USA', url: 'https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/4aea1c45-d402-3690-afae-fe635942da82' }),
  ca: Object.freeze({ label: 'Detroit inspection · into Canada', url: 'https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/794566d4-a75e-3cd1-6f95-2d60e54f2fdb' }),
  randolph: Object.freeze({ label: 'Randolph Street · into Canada', url: 'https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/5408b5c3-f8d1-f34b-a18a-9943047905b6' })
});

const DWT_MODES = Object.freeze({
  hard9: Object.freeze({ anchor: 'start', delayMs: 9000, safetyMs: 9000, label: '9s after iframe source' }),
  hard12: Object.freeze({ anchor: 'start', delayMs: 12000, safetyMs: 12000, label: '12s after iframe source' }),
  hard15: Object.freeze({ anchor: 'start', delayMs: 15000, safetyMs: 15000, label: '15s after iframe source' }),
  load9: Object.freeze({ anchor: 'load', delayMs: 9000, safetyMs: 20000, label: '9s after iframe load (20s cap)' }),
  marked9: Object.freeze({ anchor: 'marked', delayMs: 9000, safetyMs: 30000, label: '9s after manual moving-video mark (30s cap)' }),
  baseline: Object.freeze({ anchor: 'none', delayMs: 0, safetyMs: 45000, label: 'Current behaviour; manual stop (45s safety cap)' })
});

function calculateDwtDeadline(options) {
  const profile = DWT_MODES[options.mode];
  if (!profile || !Number.isFinite(options.startedAt)) {
    throw new TypeError('Known profile and finite start timestamp required');
  }
  const cap = options.startedAt + profile.safetyMs;
  let deadline = cap;
  let cause = 'Safety cap reached (' + Math.round(profile.safetyMs / 1000) + 's)';
  let anchor = null;
  if (profile.anchor === 'start') anchor = options.startedAt;
  if (profile.anchor === 'load' && Number.isFinite(options.loadedAt)) anchor = options.loadedAt;
  if (profile.anchor === 'marked' && Number.isFinite(options.markedAt)) anchor = options.markedAt;
  if (anchor !== null) {
    const candidate = anchor + profile.delayMs;
    if (candidate <= cap) {
      deadline = candidate;
      cause = profile.label + ' elapsed';
    }
  }
  return { at: deadline, cause: cause, waitingFor: anchor === null && profile.anchor !== 'none' ? profile.anchor : null };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DWT_CAMERAS, DWT_MODES, calculateDwtDeadline };
}

if (typeof document !== 'undefined') {
  (() => {
    const $ = id => document.getElementById(id);
    const dialog = $('cameraDialog');
    const stage = $('cameraStage');
    const reusableFrame = $('cameraFrame');
    const cameras = $('view');
    const mode = $('mode');
    const teardown = $('teardown');
    const viewport = $('viewport');
    const outcome = $('outcome');
    const history = [];
    const events = [];
    let current = null;
    let activeFrame = null;
    let cutoffTimer = null;
    let countdownTimer = null;
    let serial = 0;
    let backdropPressed = false;
    let priorFocus = null;

    function log(message) {
      events.push(new Date().toISOString() + ' ' + message);
      if (events.length > 90) events.shift();
      $('eventLog').textContent = events.join('\n');
    }

    function clearTimers() {
      if (cutoffTimer !== null) clearTimeout(cutoffTimer);
      if (countdownTimer !== null) clearInterval(countdownTimer);
      cutoffTimer = null;
      countdownTimer = null;
    }

    function formatSeconds(ms) {
      return (Math.max(0, ms) / 1000).toFixed(1) + 's';
    }

    function renderTimer() {
      if (!current || !current.active) return;
      const deadline = calculateDwtDeadline(current);
      const elapsed = performance.now() - current.startedAt;
      const remaining = deadline.at - performance.now();
      $('timerValue').textContent = formatSeconds(remaining);
      $('timerLabel').textContent = 'Elapsed ' + formatSeconds(elapsed) + (deadline.waitingFor ? ' · waiting for ' + (deadline.waitingFor === 'load' ? 'iframe load event' : 'manual mark') : ' · cutoff in');
    }

    function scheduleCutoff() {
      if (!current || !current.active) return;
      clearTimers();
      const run = current;
      const deadline = calculateDwtDeadline(run);
      const remainingMs = Math.max(0, deadline.at - performance.now());
      cutoffTimer = setTimeout(() => {
        if (current === run && run.active) stopActive(deadline.cause);
      }, remainingMs);
      countdownTimer = setInterval(renderTimer, 100);
      renderTimer();
    }

    function unloadFrame(run) {
      const frame = activeFrame;
      if (!frame) return;
      frame.onload = null;
      // Mirror the current board.js reset before optional element removal.
      frame.src = 'about:blank';
      frame.removeAttribute('src');
      frame.hidden = true;
      if (run.teardown === 'remove') frame.remove();
      activeFrame = null;
    }

    function stopActive(reason) {
      if (!current || !current.active) return;
      const run = current;
      run.active = false;
      run.elapsedMs = Math.round(performance.now() - run.startedAt);
      run.endedAt = new Date().toISOString();
      run.reason = reason;
      clearTimers();
      unloadFrame(run);
      $('cameraNotice').hidden = false;
      $('cameraNotice').textContent = 'Video unloaded. ' + reason + '.';
      $('timerLabel').textContent = 'Stopped · source cleared';
      $('timerValue').textContent = formatSeconds(run.elapsedMs);
      $('activeStatus').textContent = 'Iframe unloaded after ' + formatSeconds(run.elapsedMs) + '. Record the result below.';
      $('markPlaying').disabled = true;
      $('stopVideo').disabled = true;
      log('Session ' + run.id + ' stopped: ' + reason + '; elapsed ' + formatSeconds(run.elapsedMs) + '; stop method ' + run.teardown);
      renderHistory();
    }

    function frameForRun(run) {
      if (run.teardown === 'reset') {
        if (!reusableFrame.isConnected) stage.prepend(reusableFrame);
        return reusableFrame;
      }
      const frame = reusableFrame.cloneNode(false);
      frame.removeAttribute('id');
      frame.title = 'Official crossing camera · diagnostic session';
      stage.prepend(frame);
      return frame;
    }

    function startTest() {
      if (document.visibilityState === 'hidden') return;
      if (current && current.active) stopActive('Replaced by next test');
      if (dialog.open) closeDialog();
      const camera = DWT_CAMERAS[cameras.value];
      const profile = DWT_MODES[mode.value];
      if (!camera || !profile) return;
      const run = {
        id: ++serial,
        camera: cameras.value,
        mode: mode.value,
        teardown: teardown.value,
        viewport: viewport.value,
        src: camera.url,
        startedAt: null,
        startedIso: new Date().toISOString(),
        loadedAt: null,
        markedAt: null,
        elapsedMs: null,
        endedAt: null,
        reason: null,
        outcome: 'unrated',
        active: true
      };
      current = run;
      history.unshift(run);
      if (history.length > 25) history.pop();
      $('cameraTitle').textContent = camera.label;
      $('cameraSubtitle').textContent = profile.label + ' · Dacast original iframe';
      $('cameraNotice').hidden = true;
      $('activeStatus').textContent = 'Tap the native Play control if shown; mark when moving footage begins.';
      $('markPlaying').disabled = false;
      $('stopVideo').disabled = false;
      outcome.value = 'unrated';
      stage.classList.toggle('compact-player', run.viewport === 'compact');
      priorFocus = document.activeElement;
      dialog.showModal();
      const frame = frameForRun(run);
      activeFrame = frame;
      frame.onload = () => {
        if (current !== run || !run.active || activeFrame !== frame || frame.getAttribute('src') !== run.src) return;
        if (run.loadedAt !== null) return;
        run.loadedAt = performance.now();
        log('Session ' + run.id + ': iframe load event at +' + formatSeconds(run.loadedAt - run.startedAt) + ' (not playback proof)');
        scheduleCutoff();
      };
      run.startedAt = performance.now();
      frame.src = run.src;
      frame.hidden = false;
      log('Session ' + run.id + ' opened: ' + camera.label + '; ' + profile.label + '; ' + run.teardown + '; ' + run.viewport);
      scheduleCutoff();
      renderHistory();
    }

    function closeDialog() {
      if (current && current.active) stopActive('Modal closed');
      if (dialog.open) dialog.close();
    }

    function recordManualStart() {
      if (!current || !current.active || current.markedAt !== null) return;
      current.markedAt = performance.now();
      $('markPlaying').disabled = true;
      const sinceStart = formatSeconds(current.markedAt - current.startedAt);
      $('activeStatus').textContent = 'Moving video manually marked at +' + sinceStart + '. This is a viewer observation.';
      log('Session ' + current.id + ': user marked moving video at +' + sinceStart);
      scheduleCutoff();
      renderHistory();
    }

    function renderHistory() {
      const ul = $('history');
      ul.replaceChildren();
      if (!history.length) {
        const li = document.createElement('li');
        li.textContent = 'No test sessions yet.';
        ul.append(li);
        return;
      }
      history.forEach(run => {
        const li = document.createElement('li');
        const heading = document.createElement('strong');
        heading.textContent = '#' + run.id + ' · ' + DWT_CAMERAS[run.camera].label + ' · ' + DWT_MODES[run.mode].label;
        const details = document.createElement('div');
        const loadTime = run.loadedAt === null ? 'no iframe load event' : 'iframe load +' + formatSeconds(run.loadedAt - run.startedAt);
        const markTime = run.markedAt === null ? 'moving video not marked' : 'moving video marked +' + formatSeconds(run.markedAt - run.startedAt);
        details.textContent = (run.active ? 'Active' : 'Stopped after ' + formatSeconds(run.elapsedMs) + ' (' + run.reason + ')') +
          ' · ' + loadTime + ' · ' + markTime + ' · ' + run.teardown + ' · ' + run.viewport;
        const result = document.createElement('div');
        const opt = outcome.querySelector('option[value="' + run.outcome + '"]');
        result.textContent = 'Outcome: ' + (opt ? opt.textContent : run.outcome);
        li.append(heading, details, result);
        ul.append(li);
      });
    }

    function makeReport() {
      const lines = [
        'Nexus DWT preview timing diagnostic · manually collected',
        'Reported at: ' + new Date().toISOString(),
        'Origin: ' + location.origin,
        'Browser: ' + navigator.userAgent,
        'Iframe loads do not prove playback; manual marks are viewer observations.',
        'No media bitrate or byte usage is measurable via this cross-origin iframe.',
        ''
      ];
      history.slice().reverse().forEach(run => {
        lines.push('Session #' + run.id + ': ' + DWT_CAMERAS[run.camera].label);
        lines.push('  Mode: ' + DWT_MODES[run.mode].label + '; teardown: ' + run.teardown + '; viewport: ' + run.viewport);
        lines.push('  Opened: ' + run.startedIso);
        lines.push('  Iframe load: ' + (run.loadedAt === null ? 'not observed' : '+' + formatSeconds(run.loadedAt - run.startedAt)));
        lines.push('  Moving video (manual): ' + (run.markedAt === null ? 'not marked' : '+' + formatSeconds(run.markedAt - run.startedAt)));
        lines.push('  End: ' + (run.active ? 'still active at export' : formatSeconds(run.elapsedMs) + ', ' + run.reason));
        lines.push('  Result: ' + run.outcome);
      });
      lines.push('', 'Notes: ' + ($('notes').value.trim() || 'None'), '', 'Local events:', ...events);
      return lines.join('\n');
    }

    $('startTest').addEventListener('click', startTest);
    $('markPlaying').addEventListener('click', recordManualStart);
    $('stopVideo').addEventListener('click', () => stopActive('Manual Stop / unload'));
    $('doneTest').addEventListener('click', closeDialog);
    $('closeCamera').addEventListener('click', closeDialog);
    outcome.addEventListener('change', () => {
      if (current) { current.outcome = outcome.value; renderHistory(); }
    });
    cameras.addEventListener('change', () => {
      if (current && current.active) stopActive('Camera changed');
      closeDialog();
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('close', () => {
      if (current && current.active) stopActive('Modal dismissed');
      if (priorFocus && priorFocus.isConnected && typeof priorFocus.focus === 'function') priorFocus.focus({ preventScroll: true });
      priorFocus = null;
    });
    function outsideDialog(event) {
      const r = dialog.getBoundingClientRect();
      return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    }
    dialog.addEventListener('pointerdown', event => {
      backdropPressed = event.target === dialog && outsideDialog(event);
    });
    dialog.addEventListener('pointerup', event => {
      const dismiss = backdropPressed && event.target === dialog && outsideDialog(event);
      backdropPressed = false;
      if (dismiss) closeDialog();
    });
    dialog.addEventListener('pointercancel', () => { backdropPressed = false; });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && current && current.active) stopActive('Page hidden');
    });
    window.addEventListener('pagehide', () => {
      if (current && current.active) stopActive('Page hidden / navigating away');
    });
    $('copyReport').addEventListener('click', async () => {
      const report = makeReport();
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard not available');
        await navigator.clipboard.writeText(report);
        $('reportFallback').hidden = true;
        $('copyStatus').textContent = 'Report copied. Paste it into the Nexus project discussion.';
      } catch {
        $('reportFallback').hidden = false;
        $('reportFallback').value = report;
        $('reportFallback').select();
        $('copyStatus').textContent = 'Clipboard unavailable; select and copy the report from the box below.';
      }
    });
    $('clearReport').addEventListener('click', () => {
      closeDialog();
      history.length = 0;
      events.length = 0;
      current = null;
      $('notes').value = '';
      $('copyStatus').textContent = '';
      $('reportFallback').hidden = true;
      $('reportFallback').value = '';
      $('eventLog').textContent = '';
      renderHistory();
      log('Local report cleared. No video loaded.');
    });
    log('Diagnostic ready. All Dacast frames have no src until a button is pressed.');
  })();
}
