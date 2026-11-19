'use strict';

/* Standalone diagnostic; never synthesize a Dacast Play click. */
const RESUME_CAMERAS = Object.freeze({
  us: Object.freeze({name:'Windsor inspection · into USA',url:'https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/4aea1c45-d402-3690-afae-fe635942da82'}),
  ca: Object.freeze({name:'Detroit inspection · into Canada',url:'https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/794566d4-a75e-3cd1-6f95-2d60e54f2fdb'}),
  randolph: Object.freeze({name:'Randolph Street · into Canada',url:'https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/5408b5c3-f8d1-f34b-a18a-9943047905b6'})
});
const RESUME_VARIANTS = Object.freeze({
  pill6: Object.freeze({label:'A · White Resume pill · 6×',shape:'pill',zoom:6,prewarm:true}),
  round6: Object.freeze({label:'B · Circular Resume · 6×',shape:'round',zoom:6,prewarm:true}),
  pill4: Object.freeze({label:'C · White Resume pill · 4×',shape:'pill',zoom:4,prewarm:true}),
  native6: Object.freeze({label:'D · Unmasked native Play crop · 6×',shape:'native',zoom:6,prewarm:true}),
  full: Object.freeze({label:'E · Full native Dacast player',shape:'full',zoom:1,prewarm:true}),
  control: Object.freeze({label:'F · Regular reload button (control)',shape:'control',zoom:1,prewarm:false})
});
const RESUME_SESSION_MS=9000,RESUME_STANDBY_MS=15000,RESUME_INITIAL_IDLE_MS=20000;
function resumeDeadline(startAt) {
  if(!Number.isFinite(startAt))throw new TypeError('Missing start timestamp');
  return startAt+RESUME_SESSION_MS;
}
function resumePolicy(id) {
  const variant=RESUME_VARIANTS[id];
  if(!variant)throw new TypeError('Unknown Resume variant');
  return variant;
}
if(typeof module!=='undefined'&&module.exports)module.exports={RESUME_CAMERAS,RESUME_VARIANTS,RESUME_SESSION_MS,RESUME_STANDBY_MS,RESUME_INITIAL_IDLE_MS,resumeDeadline,resumePolicy};

if(typeof document!=='undefined')(() => {
  const $=id=>document.getElementById(id);
  const shade=$('modalShade'),card=$('modalCard'),main=$('main'),pill=$('launcherPill');
  const host=$('playerLayer'),face=$('resumeFace'),slot=$('videoSlot');
  const cutoff=$('cutoffArea'),target=$('resumeTarget'),outcome=$('outcome');
  const events=[],history=[];
  let state='idle',frame=null,generation=0,active=null,sequence=0;
  let prepTimer=null,idleTimer=null,cutTimer=null,tickTimer=null,handoffTimer=null,expectedFocus=null;
  let focusCount=0,frontFocus=null;

  function t(){return performance.now();}
  function fmt(ms){return (Math.max(0,ms)/1000).toFixed(1)+'s';}
  function log(message){events.push(new Date().toISOString()+' '+message);if(events.length>110)events.shift();$('log').textContent=events.join('\n');}
  function clearTimers(){
    for(const key of ['prepTimer','idleTimer','cutTimer','tickTimer','handoffTimer']) {
      const n=({prepTimer,idleTimer,cutTimer,tickTimer,handoffTimer})[key];
      if(n!==null) {
        if(key==='tickTimer')clearInterval(n);else clearTimeout(n);
      }
    }
    prepTimer=idleTimer=cutTimer=tickTimer=handoffTimer=null;
  }
  function teardownFrame(){
    generation++;
    if(frame){
      frame.removeAttribute('src');
      frame.src='about:blank';
      frame.remove();
      frame=null;
    }
    host.replaceChildren();
    host.hidden=true;
    host.classList.remove('expanded');
    face.hidden=true;
  }
  function setLayerRect(element){
    const rect=element.getBoundingClientRect();
    host.style.left=rect.left+'px';host.style.top=rect.top+'px';
    host.style.width=rect.width+'px';host.style.height=rect.height+'px';
    face.style.left=rect.left+'px';face.style.top=rect.top+'px';
    face.style.width=rect.width+'px';face.style.height=rect.height+'px';
  }
  function position(){
    if(!frame||host.hidden)return;
    const initial=state==='initial-ready'||state==='launching';
    const pendingNative=state==='resuming'&&active?.kind==='resume';
    const resumeTarget=state==='resume-ready'||pendingNative;
    if(initial)setLayerRect(pill);
    else if(resumeTarget)setLayerRect(target);
    else setLayerRect(slot);
    const variant=resumePolicy($('candidate').value);
    const compact=initial||(resumeTarget&&variant.shape!=='full');
    host.classList.toggle('under-launcher',initial);
    host.classList.toggle('expanded',!compact);
    host.style.setProperty('--crop-zoom',String(initial?6:variant.zoom));
    host.style.borderRadius=resumeTarget&&variant.shape==='round'?'50%':'11px';
    face.dataset.shape=variant.shape;
    face.style.borderRadius=variant.shape==='round'?'50%':'11px';
    face.hidden=!resumeTarget||!['pill','round'].includes(variant.shape);
  }
  function renderHistory(){
    const ul=$('history');ul.replaceChildren();
    if(!history.length){const li=document.createElement('li');li.textContent='No sessions recorded.';ul.append(li);return;}
    history.forEach(s=>{
      const li=document.createElement('li');
      const strong=document.createElement('strong');
      strong.textContent='#'+s.id+' · '+RESUME_CAMERAS[s.camera].name+' · '+s.variant+' · '+s.kind;
      const info=document.createElement('div');
      info.textContent=(s.ended?'Stopped '+fmt(s.elapsedMs)+' ('+s.endReason+')':'Active')+
        ' · iframe load '+(s.loadMs===null?'not recorded':'+'+fmt(s.loadMs))+
        ' · moving video '+(s.movingMs===null?'not marked':'+'+fmt(s.movingMs))+
        ' · focus '+s.focus;
      const result=document.createElement('div');result.textContent='Result: '+s.result;
      li.append(strong,info,result);ul.append(li);
    });
  }
  function render(){
    const modal=state==='playing'||state==='launching'||state==='resuming'||state==='expired'||state==='resume-ready'||state==='resume-wait';
    shade.hidden=!modal;main.inert=modal;document.body.classList.toggle('modal-open',modal);
    const pendingNative=state==='resuming'&&active?.kind==='resume';
    cutoff.hidden=!['expired','resume-ready','resume-wait'].includes(state)&&!pendingNative;
    // Preserve the launch rect during the focus-to-modal handoff.
    pill.hidden=modal&&state!=='launching';
    $('prepare').disabled=modal;
    for(const id of ['candidate','camera','handoff','prewarm'])$(id).disabled=modal;
    $('manualOpen').disabled=modal;
    $('markMoving').disabled=!active||active.ended||active.movingMs!==null;
    $('fallbackFull').disabled=!modal||state==='resuming'||state==='playing'||state==='launching';
    $('modalTitle').textContent=RESUME_CAMERAS[$('camera').value].name;
    const variant=resumePolicy($('candidate').value);
    $('modalSubtitle').textContent='9-second preview · '+variant.label;
    cutoff.dataset.shape=variant.shape;
    $('controlResume').hidden=variant.prewarm;
    $('rearm').hidden=state!=='expired'||!variant.prewarm;
    target.hidden=state!=='resume-ready'&&!pendingNative;
    if(state==='expired') {
      $('expiredTitle').textContent='Preview ended';
      $('expiredDescription').textContent=variant.prewarm?'Preparing native Resume control in this modal…':'Regular Resume needs a second Play tap.';
      $('rearm').textContent='Prepare native Resume';
    }else if(state==='resume-ready'){
      $('expiredTitle').textContent=variant.shape==='full'?'Tap native Play to resume':'Ready to resume';
      $('expiredDescription').textContent=variant.shape==='full'?'Use the original Play control in the full-size player.':'Tap the real Dacast Play control under the Resume surface.';
    }else if(state==='resume-wait'){
      $('expiredTitle').textContent='Resume standby expired';
      $('expiredDescription').textContent='The unused iframe has been unloaded. Re-arm to try again.';
      $('rearm').hidden=false;
    }
    $('launchStatus').textContent=state==='initial-ready'?'Ready · tap the cropped Camera control once':
      state==='idle'?'Not prepared. Tap Prepare first.':
      state==='launching'?'Native Play focus detected; opening modal.':
      state==='playing'?'Video area expanded; nine-second timer is running.':
      state==='resume-ready'?'Tap native Resume inside the same modal.':
      'Camera modal and diagnostic active.';
    $('modalStatus').textContent=state==='resume-ready'?'Standby player prepared (up to 15s). This may consume data while waiting for your tap.':
      state==='resuming'?'Resume invoked; native Dacast playback may require a second Play tap.':
      state==='playing'?'Observe moving footage; iframe focus does not confirm it.':
      state==='resume-wait'?'Standby iframe released.':
      state==='expired'?'Prior player unloaded. Modal stays open.':'';
    position();renderHistory();
  }
  function newFrame(){
    const cam=RESUME_CAMERAS[$('camera').value];
    const token=++generation;
    const f=document.createElement('iframe');
    f.title='DWT · '+cam.name+' native Dacast player';
    f.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';
    f.allowFullscreen=true;f.referrerPolicy='no-referrer';f.loading='eager';
    f.addEventListener('load',()=>{
      if(frame!==f||generation!==token)return;
      if(active&&!active.ended&&active.loadMs===null)active.loadMs=Math.round(t()-active.startedAt);
      log('iframe load · '+state+' · not playback confirmation');
      renderHistory();
    });
    f.addEventListener('focus',()=>focusSignal(f,token,'iframe focus'));
    f.addEventListener('error',()=>{if(generation===token)log('Outer iframe error (no access to Dacast internals)');});
    frame=f;
    host.replaceChildren(f);host.hidden=false;
    f.src=cam.url;
    log('Fresh original Dacast iframe created; token='+token+'; no synthetic Play');
    position();
    return f;
  }
  function recordEnd(reason){
    if(!active||active.ended)return;
    active.ended=true;
    active.elapsedMs=Math.round(t()-active.startedAt);
    active.endReason=reason;
    active.endIso=new Date().toISOString();
    log('Session #'+active.id+' '+reason+' · '+fmt(active.elapsedMs));
    renderHistory();
  }
  function tick(){
    if(!active||active.ended)return;
    $('timer').textContent=fmt(active.deadlineAt-t());
  }
  function startSession(kind,signal){
    if(active&&!active.ended)recordEnd('Replaced');
    if(idleTimer!==null)clearTimeout(idleTimer);
    if(prepTimer!==null)clearTimeout(prepTimer);
    idleTimer=prepTimer=null;
    if(cutTimer!==null)clearTimeout(cutTimer);
    if(tickTimer!==null)clearInterval(tickTimer);
    if(handoffTimer!==null)clearTimeout(handoffTimer);
    cutTimer=tickTimer=handoffTimer=null;
    const start=t();
    const s={
      id:++sequence,camera:$('camera').value,variant:$('candidate').value,kind,
      startedIso:new Date().toISOString(),startedAt:start,deadlineAt:resumeDeadline(start),
      focus:signal,result:'untested',loadMs:null,movingMs:null,elapsedMs:null,
      endReason:'',ended:false,endIso:null
    };
    active=s;history.unshift(s);if(history.length>35)history.pop();
    outcome.value='untested';
    tick();
    cutTimer=setTimeout(()=>{if(active===s&&!s.ended)expire();},RESUME_SESSION_MS);
    tickTimer=setInterval(tick,100);
    $('timerLabel').textContent=kind==='control'?'9s from Resume button':'9s from iframe focus (not playback proof)';
    log('Session #'+s.id+' started: '+kind+' · '+signal+' · 9s cutoff');
    renderHistory();
  }
  function showPlaying(token,source){
    if(!frame||generation!==token||!['launching','resuming'].includes(state))return;
    state='playing';
    render();
    log('Same iframe expanded into modal; source='+source+'; no iframe reparent');
  }
  function focusSignal(f,token,source){
    if(f!==frame||token!==generation)return;
    if(state!=='initial-ready'&&state!=='resume-ready')return;
    const kind=state==='initial-ready'?'first':'resume';
    focusCount++;
    state=kind==='first'?'launching':'resuming';
    startSession(kind,source);
    const delay=Number($('handoff').value);
    if(kind==='first'){
      render();
      handoffTimer=setTimeout(()=>showPlaying(token,'initial native focus; '+delay+'ms'),delay);
    }else{
      /* Keep the modal and the same prepared iframe in place; move/expand after native Play gesture. */
      render();
      handoffTimer=setTimeout(()=>showPlaying(token,'in-modal native Resume; '+delay+'ms'),delay);
    }
    log('Native iframe focus captured ('+kind+'); timer started; not video proof');
  }
  function prepareFirst(){
    closeAll('Reset before first camera');
    state='initial-ready';render();
    newFrame();
    const token=generation;
    idleTimer=setTimeout(()=>{
      if(state==='initial-ready'&&token===generation)closeAll('Unused initial iframe released after 20s');
    },RESUME_INITIAL_IDLE_MS);
    log('Prepared initial crop · 480x270 · 6× · Play tap passes through label');
  }
  function expire(){
    if(!active||active.ended)return;
    recordEnd('Nine-second cutoff; iframe destroyed');
    clearTimers();teardownFrame();
    state='expired';
    $('timer').textContent='0.0s';$('timerLabel').textContent='Preview ended · player removed';
    render();
    scheduleResume();
  }
  function scheduleResume(){
    const variant=resumePolicy($('candidate').value);
    if(!variant.prewarm){
      log('Control candidate: no iframe preloaded. Resume button visible.');
      return;
    }
    const delay=Number($('prewarm').value);
    prepTimer=setTimeout(()=>{
      prepTimer=null;
      if(state==='expired')armResume();
    },delay);
    log('Scheduling native Resume iframe preparation after '+delay+'ms; no overlapping player');
  }
  function armResume(){
    if(state!=='expired'&&state!=='resume-wait')return;
    state='resume-ready';
    render();
    newFrame();
    position();
    const token=generation;
    idleTimer=setTimeout(()=>{
      if(state==='resume-ready'&&generation===token){
        teardownFrame();state='resume-wait';render();
        log('Unused prepared iframe released after 15s.');
      }
    },RESUME_STANDBY_MS);
    log('Native Resume prepared inside same modal; '+resumePolicy($('candidate').value).label);
  }
  function controlResume(){
    if(state!=='expired'||resumePolicy($('candidate').value).prewarm)return;
    state='resuming';render();
    startSession('control','Normal Resume click, no native playback claim');
    newFrame();showPlaying(generation,'normal reload button');
    log('Control resumed by loading full iframe; native Play may require second tap.');
  }
  function fallbackFull(){
    if(!['expired','resume-wait','resume-ready'].includes(state))return;
    clearTimers();teardownFrame();
    state='resuming';render();
    startSession('fallback','Manual full player action; no autoplay guarantee');
    newFrame();showPlaying(generation,'manual full-player fallback');
  }
  function closeAll(reason){
    clearTimers();
    recordEnd(reason);
    teardownFrame();
    state='idle';active=null;
    main.inert=false;
    render();
    log('All media unloaded: '+reason);
  }
  function markMoving(){
    if(!active||active.ended||active.movingMs!==null)return;
    active.movingMs=Math.round(t()-active.startedAt);
    log('Session #'+active.id+' manual moving-video mark at +'+fmt(active.movingMs));
    $('markMoving').disabled=true;renderHistory();
  }
  function manualOpen(){
    if(state==='idle')prepareFirst();
    if(state!=='initial-ready')return;
    state='resuming';render();
    startSession('first-manual','Manual open without native Play claim');
    showPlaying(generation,'manual open');
  }
  function makeReport(){
    const result=[
      'Nexus DWT in-modal Resume candidate diagnostic · manual observation',
      'UTC: '+new Date().toISOString(),
      'Origin: '+location.origin,
      'Browser: '+navigator.userAgent,
      'Current camera: '+RESUME_CAMERAS[$('camera').value].name,
      'Current candidate: '+resumePolicy($('candidate').value).label,
      'Prewarm delay: '+$('prewarm').value+'ms; focus handoff: '+$('handoff').value+'ms',
      'Initial launch: original 480x270 iframe, 6x crop, same-iframe expand',
      'Session cutoff: 9 seconds from iframe focus (or Resume button in control).',
      'Unused player release: 15s standby / 20s initial. Every session removes active iframe at cutoff.',
      'Native Dacast Play taps are genuine; no programmatic autoplay or playback detection.',
      'Focus signals observed: '+focusCount,
      '',
      'Sessions:'
    ];
    history.slice().reverse().forEach(s=>{
      result.push('#'+s.id+' '+RESUME_CAMERAS[s.camera].name+' · '+resumePolicy(s.variant).label+' · '+s.kind);
      result.push('  Focus: '+s.focus+'; opened: '+s.startedIso);
      result.push('  Player load: '+(s.loadMs===null?'not observed during session':'+'+fmt(s.loadMs))+
        '; user moving-video mark: '+(s.movingMs===null?'not marked':'+'+fmt(s.movingMs)));
      result.push('  End: '+(s.ended?fmt(s.elapsedMs)+' '+s.endReason:'active')+'; outcome: '+s.result);
    });
    result.push('', 'Notes: '+($('notes').value.trim()||'None'), '', 'Local log:', ...events);
    return result.join('\n');
  }

  $('prepare').addEventListener('click',prepareFirst);
  $('stop').addEventListener('click',()=>closeAll('Manual Stop'));
  $('manualOpen').addEventListener('click',manualOpen);
  $('closeModal').addEventListener('click',()=>closeAll('Modal closed'));
  $('rearm').addEventListener('click',armResume);
  $('controlResume').addEventListener('click',controlResume);
  $('fallbackFull').addEventListener('click',fallbackFull);
  $('markMoving').addEventListener('click',markMoving);
  outcome.addEventListener('change',()=>{if(active){active.result=outcome.value;renderHistory();}});
  $('camera').addEventListener('change',()=>closeAll('Camera changed'));
  $('candidate').addEventListener('change',()=>closeAll('Candidate changed'));
  shade.addEventListener('pointerdown',ev=>{if(ev.target===shade)closeAll('Backdrop close');});
  document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&!shade.hidden){ev.preventDefault();closeAll('Escape close');}});
  window.addEventListener('blur',()=>{
    const token=generation,f=frame;
    setTimeout(()=>{
      if(f&&f===frame&&generation===token&&document.activeElement===f)focusSignal(f,token,'window blur + iframe activeElement');
    },0);
  });
  window.addEventListener('resize',position);
  window.addEventListener('scroll',()=>{if(frame)position();},{passive:true});
  card.addEventListener('scroll',position,{passive:true});
  if(window.visualViewport)window.visualViewport.addEventListener('resize',position);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)closeAll('Page hidden / visibilitychange');
  });
  window.addEventListener('pagehide',()=>closeAll('Page navigation'));
  $('copy').addEventListener('click',async()=>{
    const report=makeReport();
    try{
      if(!navigator.clipboard||!navigator.clipboard.writeText)throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(report);
      $('reportFallback').hidden=true;
      $('copyStatus').textContent='Copied to clipboard; paste into the Nexus discussion.';
    }catch{
      $('reportFallback').hidden=false;
      $('reportFallback').value=report;
      $('reportFallback').select();
      $('copyStatus').textContent='Clipboard unavailable; select and copy the report below.';
    }
  });
  $('clear').addEventListener('click',()=>{
    closeAll('Clear report');
    history.length=0;events.length=0;active=null;sequence=0;focusCount=0;
    $('notes').value='';outcome.value='untested';$('reportFallback').hidden=true;$('copyStatus').textContent='';
    renderHistory();log('Local results cleared.');
  });
  render();log('Diagnostic ready; iframe is absent until explicit Prepare.');
})();
