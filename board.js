(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const D=window.NexusDecision;
  const IDS=['ambassador','tunnel','gordie'];
  const LABELS={tunnel:['Detroit–Windsor Tunnel','Tunnel'],ambassador:['Ambassador Bridge','Bridge'],gordie:['Gordie Howe International Bridge','Gordie Howe']};
  const CAMERAS={
    tunnel:{
      us:[['Windsor inspection','https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/4aea1c45-d402-3690-afae-fe635942da82']],
      ca:[['Detroit inspection','https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/794566d4-a75e-3cd1-6f95-2d60e54f2fdb'],['Randolph Street','https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/5408b5c3-f8d1-f34b-a18a-9943047905b6']]
    },
    ambassador:{
      us:[['Into USA','https://ambassador.solutionspal.com/cams/cam2.html']],
      ca:[['Into Canada','https://ambassador.solutionspal.com/cams/cam1.html']]
    }
  };
  const OFFICIAL={tunnel:'https://www.dwtunnel.com/',ambassador:{us:'https://www.ambassadorbridge.com/into-the-united-states/',ca:'https://www.ambassadorbridge.com/into-canada/'}};
  const REFRESH_MS=120000;
  const ZONE='America/Toronto';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clock=stamp=>{let d=new Date(stamp||'');return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(d)+' ET':'Not supplied'};
  const ago=n=>!Number.isFinite(n)?'time unknown':n<2?'just now':n<60?Math.floor(n)+'m ago':Math.floor(n/60)+'h '+Math.floor(n%60)+'m ago';
  let direction='us',data=null,loadError='',lastFetch='',busy=false,lastTry=0,camera=null;
  try{direction=localStorage.getItem('nexus-board-direction')==='ca'?'ca':'us'}catch{}
  function source(){return data?.sources?.[direction==='us'?'cbp':'cbsa'];}
  function sourceAge(){return D.age(source()?.retrieved_at,Date.now())}
  function snapshotAge(){return D.age(data?.generated_at,Date.now())}
  // Use the agency observation time to decide whether a wait may appear as current.
  // Retrieval or publication time cannot refresh an old agency observation.
  const CURRENT_LIMIT_MINUTES=20;
  // Beta reporting-delay heuristic, NOT an agency publication SLA.
  // Do not warn on normal hourly reporting or on a source Nexus has not checked recently.
  const REPORT_LATE_MINUTES={cbp:120,cbsa:120};
  // Three missed 10-minute collection opportunities merit a *collection* warning.
  const CHECK_OVERDUE_MINUTES=30;
  function lastOfficialCheck(src=source()){
    const stamp=src?.last_success_at||(src?.status==='ok'?src?.retrieved_at:null);
    return Number.isFinite(D.age(stamp,Date.now()))?stamp:null;
  }
  function lateAgencyReports(){
    const key=direction==='us'?'cbp':'cbsa';
    const late={};
    for(const id of IDS){
      const port=data?.directions?.[direction]?.[id]||{};
      const lanes=direction==='us'?['standard','nexus']:['standard'];
      const ages=lanes.map(lane=>port[lane]).filter(raw=>
        raw&&(raw.status==='reported'||raw.status==='closed'))
        .map(raw=>D.age(raw.observation_at,Date.now())).filter(Number.isFinite);
      if(ages.length&&Math.max(...ages)>=REPORT_LATE_MINUTES[key])
        late[id]=Math.max(...ages);
    }
    return late;
  }
  function timeOnly(stamp){
    const t=new Date(stamp||'');
    if(!Number.isFinite(t.getTime()))return null;
    const age=D.age(stamp,Date.now());
    const options=age>=1440
      ? {timeZone:ZONE,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}
      : {timeZone:ZONE,hour:'numeric',minute:'2-digit'};
    return new Intl.DateTimeFormat('en-CA',options).format(t)+' ET';
  }
  function freshness(raw){
    if(!data)return {kind:'unavailable',age:Infinity};
    const r=D.reading(raw,data,Date.now());
    if(source()?.status!=='ok')return {kind:'unavailable',age:D.age(raw?.observation_at)};
    if(sourceAge()>=CURRENT_LIMIT_MINUTES||snapshotAge()>=CURRENT_LIMIT_MINUTES)
      return {kind:'stale',age:r.age};
    return r;
  }
  // Compact presentation of CBSA's published *possible* service window.
  // It does not say the lane is physically open or that a NEXUS wait exists.
  function scheduleMoment(next,closing){
    if(typeof next!=='string'||!next)return null;
    // en-CA commonly formats meridiem as "a.m." / "p.m.", not "AM/PM".
    const normalized=next.replace(/[\u00a0\u202f]/g,' ');
    const match=/^(Today|Tomorrow) (\d{1,2}):(\d{2})\s+([ap])\.?m\.?\s+ET$/i.exec(normalized);
    if(!match)return next;
    const [,day,hourText,minutes,initial]=match;
    const meridiem=initial.toUpperCase()+'M';
    const hour=Number(hourText),midnight=hour===12&&minutes==='00'&&meridiem==='AM';
    const noon=hour===12&&minutes==='00'&&meridiem==='PM';
    const time=midnight?'midnight':noon?'noon':hour+(minutes==='00'?'':':'+minutes)+' '+meridiem;
    const dayText=day==='Today'||(day==='Tomorrow'&&midnight&&closing)?'':'tomorrow ';
    return dayText+time;
  }
  function operatorNexusLaneCount(id,now){
    if(id!=='tunnel')return null;
    const operator=data?.supplemental?.dwt?.ca;
    const src=data?.sources?.dwt;
    const count=operator?.lane_counts?.nexus;
    if(!Number.isInteger(count)||count<0||src?.status!=='ok')return null;
    if(D.age(operator?.observation_at,now)>=CURRENT_LIMIT_MINUTES||
        D.age(src?.retrieved_at,now)>=CURRENT_LIMIT_MINUTES||
        snapshotAge()>=CURRENT_LIMIT_MINUTES)return null;
    return count;
  }
  function canadaNexusEntry(id){
    const unsupported='NEXUS wait not published';
    const unknown={display:'Hours unverified',unit:'',variant:'not-published',
      lanes:'Lanes not verified',historical:false,kind:'unavailable',status:unsupported};
    if(!id||!data||!D.nextNexusSchedule)return unknown;
    const now=Date.now(),schedule=D.nextNexusSchedule(data,id,'ca',now);
    if(schedule.kind==='unknown')return unknown;
    const within=schedule.kind==='within';
    const when=scheduleMoment(schedule.next,within);
    const display=within
      ?(when?'Scheduled until '+when:'Within scheduled hours')
      :(when?'Opens '+when:'Outside scheduled hours');
    let lanes='Lanes not verified';
    if(within){
      const scheduled=D.scheduledNexusLaneCount?.(data,id,'ca',now);
      if(Number.isInteger(scheduled)&&scheduled>0)
        lanes=scheduled+' '+(scheduled===1?'lane':'lanes')+' scheduled';
      else {
        const listed=operatorNexusLaneCount(id,now);
        if(listed!==null)
          lanes=listed+' NEXUS '+(listed===1?'lane':'lanes')+' listed (operator)';
      }
    }
    return {display,unit:'',variant:'schedule',lanes,historical:false,kind:'schedule',
      status:'Published hours only · '+unsupported,source:'CBSA schedule',
      scheduleKind:schedule.kind};
  }
  function entry(raw,category,id){
    // Agency observation time, a successful source check, and snapshot
    // publication are different clocks. None can substitute for another.
    const missingLanes='Lanes not reported';
    if(!data)return {display:'Checking…',unit:'',variant:'checking',
      lanes:missingLanes,historical:false,kind:'unavailable',status:'Checking official reports'};
    // Canada-bound NEXUS inspection waits/counts are not published by CBSA.
    if(direction==='ca'&&category==='nexus')return canadaNexusEntry(id);
    if(!raw)return {display:'Not reported',unit:'',variant:'not-reported',
      lanes:missingLanes,historical:false,kind:'unavailable',status:'No official reading'};
    const now=Date.now(),s=source(),obsAge=D.age(raw.observation_at,now);
    const checkAge=D.age(lastOfficialCheck(s),now),snapAge=snapshotAge(),r=freshness(raw);
    const verified=s?.status==='ok';
    const retained=s?.status==='error'&&s?.retained_previous===true;
    const dated=Number.isFinite(obsAge);
    const withinHistory=(verified||retained)&&dated&&
      obsAge<D.READING_EXPIRE_AGE&&checkAge<D.READING_EXPIRE_AGE&&snapAge<D.READING_EXPIRE_AGE;
    const current=verified&&obsAge<CURRENT_LIMIT_MINUTES&&
      checkAge<CURRENT_LIMIT_MINUTES&&snapAge<CURRENT_LIMIT_MINUTES&&
      (D.usable(r)||r.kind==='closed'||r.kind==='not_applicable');
    const count=withinHistory&&Number.isInteger(raw.lanes_open)&&raw.lanes_open>=0
      ?raw.lanes_open:null;
    const lanes=count===null?missingLanes
      :count+' '+(count===1?'lane':'lanes')+(current?' reported':' last reported');
    const valid=raw.status==='reported'&&Number.isInteger(raw.minutes)&&
      raw.minutes>=0&&raw.minutes<=720;
    if(current&&valid)return {display:raw.minutes===0?'No Delay':String(raw.minutes),
      unit:raw.minutes===0?'':'min',variant:raw.minutes===0?'no-delay':'number',
      lanes,historical:false,kind:r.kind,status:'Observed '+ago(obsAge)};
    if(current&&raw.status==='closed')return {display:'Closed',unit:'',variant:'closed',
      lanes,historical:false,kind:'warning',status:'Official report · '+ago(obsAge)};
    if(raw.status==='closed'&&(verified||retained))return {
      display:'Closure unverified',unit:'',variant:'unverified',
      lanes:withinHistory?lanes:missingLanes,historical:true,kind:'warning',
      status:dated?'Last reported '+ago(obsAge):'Report time unknown'
    };
    if(current&&raw.status==='not_applicable')return {
      display:'Not applicable',unit:'',variant:'not-published',lanes:missingLanes,
      historical:false,kind:'unavailable',status:'Not applicable to this lane'
    };
    // Historical numerical reports remain visible for context only.
    // A historical 0 is *not* presented as a fresh "No Delay".
    if(withinHistory&&valid)return {
      display:String(raw.minutes),unit:'min',variant:'number',lanes,
      historical:true,kind:'historical',status:'Reported '+ago(obsAge)
    };
    if(raw.status==='not_applicable')return {
      display:'Not applicable',unit:'',variant:'not-published',lanes:missingLanes,
      historical:false,kind:'unavailable',status:'Not applicable to this lane'
    };
    if(valid&&dated&&(verified||retained))return {
      display:'Unavailable',unit:'',variant:'expired',lanes:missingLanes,
      historical:true,kind:'old',status:'Last report '+ago(obsAge)
    };
    if(s?.status==='error'&&!retained)return {
      display:'Unavailable',unit:'',variant:'unavailable',lanes:missingLanes,
      historical:false,kind:'unavailable',status:'Source check failed'
    };
    if(valid&&!dated)return {
      display:'Unavailable',unit:'',variant:'unavailable',lanes:missingLanes,
      historical:false,kind:'unavailable',status:'Report time unknown'
    };
    return {display:'Unavailable',unit:'',variant:'unavailable',lanes:missingLanes,
      historical:false,kind:'unavailable',status:'No verified wait'};
  }
  // Normal measurements stay compact. Historical measurements are explicitly aged.
  function metric(m,id,cat){
    const missing=m.lanes==='Lanes not reported'||m.lanes==='Lanes not published'||m.lanes==='Lanes not verified';
    const laneLine=missing?'':m.lanes.replace(/ last reported$/,' (last report)').replace(/ reported$/,'');
    const hint=(m.kind==='schedule'||m.kind==='historical'||m.kind==='old'||m.kind==='warning'||
      (m.variant==='unavailable'&&m.status==='Report time unknown'))?m.status:'';
    return '<div class="reading '+cat+'" aria-label="'+esc(cat)+' for '+esc(LABELS[id][0])+': '+
      esc(m.display)+(m.unit?' '+esc(m.unit):'')+', '+esc(m.lanes)+', '+esc(m.status)+'">'+
      '<div class="reading-label">'+esc(cat)+'</div>'+
      '<div class="reading-main" data-display="'+esc(m.variant)+'" data-historical="'+
      String(m.historical)+'">'+esc(m.display)+
      (m.unit?' <small>'+esc(m.unit)+'</small>':'')+'</div>'+
      (laneLine?'<div class="reading-lanes" data-historical="'+String(m.historical)+'">'+esc(laneLine)+'</div>':'')+
      (hint?'<div class="reading-hint" data-state="'+esc(m.kind)+'">'+esc(hint)+'</div>':'')+'</div>';
  }
  function cameraMarkup(id){
    const icon=id==='gordie'
      ?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3M3 3l18 18"/></svg>'
      :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>';
    return '<div class="camera-cell"><button type="button" class="camera-button" data-camera="'+id+
      '" aria-label="'+esc(id==='gordie'?'Camera not yet available for Gordie Howe':'Open '+LABELS[id][0]+' camera')+
      '" title="'+(id==='gordie'?'Camera not yet officially available':'Open camera')+
      '" '+(id==='gordie'?'disabled':'')+'>'+icon+'</button></div>';
  }
  function render(){
    $('intoUs').setAttribute('aria-pressed',String(direction==='us'));
    $('intoCa').setAttribute('aria-pressed',String(direction==='ca'));
    const s=source(),snap=snapshotAge(),name=direction==='us'?'CBP':'CBSA';
    const checkedAt=lastOfficialCheck(s),checkAge=D.age(checkedAt,Date.now());
    const checkedLabel=Number.isFinite(checkAge)?'Checked '+ago(checkAge)+' · '+name:name+' check time unavailable';
    const checksDelayed=!Number.isFinite(checkAge)||checkAge>=CHECK_OVERDUE_MINUTES||snap>=CHECK_OVERDUE_MINUTES;
    // Never blame agency reporting when Nexus itself has not checked recently.
    const lateReports=s?.status==='ok'&&!checksDelayed?lateAgencyReports():{};
    const lateCount=Object.keys(lateReports).length;
    let state='warn',note='No published border data available';
    if(busy&&!data)note='Loading published official reports…';
    else if(loadError){
      state='error';
      note='Unable to load latest snapshot'+(Number.isFinite(checkAge)?' · last '+name+' check '+ago(checkAge):'');
    }else if(s?.status==='error'){
      state='error';
      note=name+' check failed'+(Number.isFinite(checkAge)?' · last successful check '+ago(checkAge):'');
    }else if(s?.status!=='ok')note=name+' data unavailable';
    else if(!Number.isFinite(checkAge))note=name+' check time unavailable';
    else if(checksDelayed)note=checkedLabel+' · collection delayed';
    else if(lateCount)note=checkedLabel+' · Older report'+(lateCount===1?'':'s');
    else{state='ok';note=checkedLabel;}
    $('statusDot').dataset.state=state;
    $('summary').textContent=note;
    $('summary').title=Number.isFinite(checkAge)
      ?name+' last successfully checked '+clock(checkedAt)+'. Source observations may be older.'
      :name+' last successful source check not verified.';
    $('crossingRows').innerHTML=IDS.map(id=>{
      const port=data?.directions?.[direction]?.[id]||{};
      const reportAge=lateReports[id];
      const reportWarning=Number.isFinite(reportAge)
        ?'<div class="crossing-report-warning">Report '+esc(ago(reportAge))+'</div>':'';
      return '<article class="crossing-row" aria-label="'+esc(LABELS[id][0])+'">'+
        '<div class="crossing-identity"><div class="crossing-name">'+esc(LABELS[id][0])+'</div>'+reportWarning+'</div>'+
        '<div class="metrics">'+metric(entry(port.nexus,'nexus',id),id,'NEXUS')+
        metric(entry(port.standard,'regular'),id,'Regular')+'</div>'+
        cameraMarkup(id)+'</article>';
    }).join('');
    $('crossingRows').querySelectorAll('button[data-camera]:not(:disabled)')
      .forEach(b=>b.addEventListener('click',()=>openCamera(b.dataset.camera)));
    $('freshnessNote').textContent='“Checked” is the last successful official data retrieval, not the age of the agency observation. '+
      'Canada-bound NEXUS cells show CBSA published hours, not live NEXUS waits or confirmed open lanes. '+
      'Ambassador scheduled lane counts and Tunnel operator-listed counts are distinct from live operation. '+
      'Historical inspection waits are labelled and expire after two hours; reported zero is never inferred from missing data.';
    renderDiagnostics();
    if(camera)renderCameraInfo();
  }
  function renderDiagnostics(){
    const lines=[];
    const checkedAt=lastOfficialCheck(),checkedAge=D.age(checkedAt,Date.now());
    lines.push('<div class="diag-grid"><div><strong>Official '+esc(direction==='us'?'CBP':'CBSA')+' last successful check</strong><div>'+
      esc(checkedAt?clock(checkedAt)+' · '+ago(checkedAge):'Unavailable')+'</div></div>'+
      '<div><strong>Server snapshot published</strong><div>'+esc(clock(data?.generated_at))+' · '+esc(ago(snapshotAge()))+'</div></div>'+
      '<div><strong>Browser downloaded snapshot</strong><div>'+esc(lastFetch?clock(lastFetch):'Not yet')+
      ' (not an agency check)</div></div></div>');
    if(loadError)lines.push('<p>Connection error: '+esc(loadError)+'</p>');
    for(const id of IDS){
      const port=data?.directions?.[direction]?.[id]||{};
      lines.push('<div class="diag-entry"><strong>'+esc(LABELS[id][0])+'</strong>');
      for(const [key,label] of [['nexus','NEXUS'],['standard','Regular']]){
        if(direction==='ca'&&key==='nexus'){
          const schedule=D.nextNexusSchedule(data,id,'ca',Date.now());
          const laneCount=D.scheduledNexusLaneCount?.(data,id,'ca',Date.now());
          lines.push('<div>NEXUS wait: not published by CBSA · schedule: '+
            esc(schedule.kind)+(schedule.next?' · next: '+esc(schedule.next):'')+
            ' · scheduled lane count: '+esc(laneCount??'not verified')+
            ' (schedule is not live operation)</div>');
          continue;
        }
        const raw=port[key];const count=Number.isInteger(raw?.lanes_open)?raw.lanes_open:'not supplied';
        const value=Number.isInteger(raw?.minutes)&&raw.status==='reported'?(raw.minutes===0?'No Delay':raw.minutes+' min'):raw?.status||'not supplied';
        lines.push('<div>'+label+': <strong>'+esc(value)+'</strong> · lanes reported '+esc(count)+' · '+esc(clock(raw?.observation_at))+' · '+esc(ago(D.age(raw?.observation_at)))+'</div>');
      }
      if(direction==='ca'&&id==='tunnel'){
        const d=data?.supplemental?.dwt?.ca;
        lines.push('<div>Tunnel operator NEXUS lanes (separate source): '+esc(d?.lane_counts?.nexus??'not supplied')+' · '+esc(clock(d?.observation_at))+' (may be stale; not a NEXUS wait)</div>');
      }
      lines.push('</div>');
    }
    lines.push('<h3 class="diag-heading">Source health</h3>');
    for(const [name,src] of Object.entries(data?.sources||{})){
      const url=typeof src?.url==='string'&&/^https:\/\//.test(src.url)?src.url:null;
      lines.push('<div class="diag-source"><strong>'+esc(name.toUpperCase())+'</strong> · '+esc(src?.status||'?')+
        ' · '+esc(src?.coverage??'not available')+' records'+(src.retained_previous?' · HISTORICAL FALLBACK':'')+
        '<div>Last attempt: '+esc(clock(src?.retrieved_at))+' · last successful check: '+
        esc(clock(src?.last_success_at||(src?.status==='ok'?src?.retrieved_at:null)))+
        (src?.cache_reused?' · reused from collector cache':'')+'</div>'+
        (url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Official source ↗</a>':'')+'</div>');
    }
    lines.push('<p>Historical numbers are context, not live wait estimates. “Checked” refers to the last successful official-source retrieval, not opening this page. Amber agency-report notices are based on the age of the agency observations, and are shown only after a recent successful source check. Source retrieval, agency observation, and page publication are different timestamps. “Closed” and “0 min” are different reports; missing lanes do not mean zero lanes. Counts are source-reported, not independently confirmed.</p>');
    $('diagnosticBody').innerHTML=lines.join('');
  }
  async function refresh(){
    if(busy)return;
    const time=Date.now();
    if(lastTry&&time-lastTry<15000)return;
    lastTry=time;busy=true;render();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),13000);
    try{
      const response=await fetch('./data/live.json?ts='+time,{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const next=await response.json();
      if(!['nexus-live-v1','nexus-live-v2'].includes(next.schema)||!next.sources||!next.directions||!Number.isFinite(Date.parse(next.generated_at||'')))
        throw new Error('Invalid or ungenerated snapshot');
      if(!data||Date.parse(next.generated_at)>=Date.parse(data.generated_at)){data=next;loadError='';}
      lastFetch=new Date().toISOString();
    }catch(error){loadError=error?.name==='AbortError'?'Timed out':String(error?.message||'Network unavailable').slice(0,110);}
    finally{clearTimeout(timer);busy=false;render();}
  }
  const BRIDGE_DEFAULT_ZOOM=4;
  const BRIDGE_DEFAULT_FRAMING={left:0.20,up:0.50};
  const bridgeZoom={scale:1,x:0,y:0,pointer:null};
  let backdropPressed=false, focusBeforeCamera=null;
  function renderCameraInfo(){
    if(!camera)return;
    const port=data?.directions?.[direction]?.[camera.id]||{};
    const nexus=entry(port.nexus,'nexus',camera.id),standard=entry(port.standard,'regular');
    for(const [label,r] of [['Nexus',nexus],['Regular',standard]]){
      const wait=$('camera'+label+'Wait');
      wait.textContent=r.display+(r.unit?' '+r.unit:'');
      wait.dataset.display=r.variant;
      wait.dataset.historical=String(r.historical);
      $('camera'+label+'Lanes').textContent=r.lanes;
      $('camera'+label+'Status').textContent=r.status;
    }
    let title='NEXUS availability unverified';
    let note='Next opening or closing time is not verified by the available data.';
    if(direction==='us'){
      if(nexus.variant==='closed'){
        title='NEXUS reported closed by CBP';
        note='Next opening time not published in available US-bound data.';
      }else if(['number','no-delay'].includes(nexus.variant)){
        title='NEXUS inspection report available';
        note='Next scheduled closing time not published in available US-bound data.';
      }else if(port.nexus?.status==='closed'){
        title='NEXUS previously reported closed';
        note='The old closure cannot be verified as current; reopening time unknown.';
      }
    }else{
      const schedule=D.nextNexusSchedule(data,camera.id,'ca',Date.now());
      if(schedule.kind==='within'){
        title='Within published NEXUS hours';
        note=schedule.next?'Scheduled NEXUS availability ends '+schedule.next+'.':'No confirmed next closing time.';
      }else if(schedule.kind==='outside'){
        title='Outside published NEXUS hours';
        note=schedule.next?'Next scheduled NEXUS opening '+schedule.next+'.':'Next scheduled opening unverified.';
      }else{
        title='NEXUS schedule unverified';
        note=schedule.reason||'Published schedule could not be interpreted.';
      }
      note+=' Schedule does not confirm live lane availability.';
      if(camera.id==='tunnel'){
        const op=data?.supplemental?.dwt?.ca, count=op?.lane_counts?.nexus;
        const opAge=D.age(op?.observation_at);
        if(Number.isInteger(count)&&Number.isFinite(opAge)&&
          opAge<CURRENT_LIMIT_MINUTES&&data?.sources?.dwt?.status==='ok'&&
          D.age(data.sources.dwt.retrieved_at)<CURRENT_LIMIT_MINUTES){
          note+=' Tunnel operator lists '+count+' NEXUS '+(count===1?'lane':'lanes')+
            ' ('+ago(opAge)+'; not confirmation of open lanes).';
        }
      }
    }
    $('cameraNexusSchedule').textContent=title;
    $('cameraNexusScheduleNote').textContent=note;
    const summary=direction==='ca'
      ? title==='Within published NEXUS hours'?'Within published hours'
        :title==='Outside published NEXUS hours'?'Outside published hours':'Hours unverified'
      :title.includes('reported closed')?'Closure reported':'Hours unverified';
    $('cameraScheduleSummary').textContent=summary;
    const observations=['nexus','standard'].map(key=>{
      if(direction==='ca'&&key==='nexus')return 'NEXUS wait: not published by CBSA';
      const item=port[key];
      return (key==='nexus'?'NEXUS':'Regular')+' observed: '+clock(item?.observation_at);
    });
    $('cameraSourceDetails').textContent=(direction==='us'?'CBP':'CBSA')+' · '+observations.join(' · ')+
      ' · Source retrieved: '+clock(source()?.retrieved_at);
  }
  function bridgePanLimits(){
    const f=$('cameraFrame'),stage=$('cameraStage');
    return {x:Math.max(0,(f.offsetWidth*bridgeZoom.scale-stage.clientWidth)/2),
      y:Math.max(0,(f.offsetHeight*bridgeZoom.scale-stage.clientHeight)/2)};
  }
  function applyBridgeZoom(){
    if(camera?.id!=='ambassador')return;
    const lim=bridgePanLimits();
    bridgeZoom.x=Math.max(-lim.x,Math.min(lim.x,bridgeZoom.x));
    bridgeZoom.y=Math.max(-lim.y,Math.min(lim.y,bridgeZoom.y));
    const scale=bridgeZoom.scale;
    $('cameraFrame').style.transform=scale===1?'':'translate('+bridgeZoom.x+'px, '+bridgeZoom.y+'px) scale('+scale+')';
    const surface=$('cameraZoomSurface');
    surface.setAttribute('aria-pressed',String(scale>1));
    surface.setAttribute('aria-label',scale>1?'Drag to pan bridge camera; tap to fit':'Tap to zoom bridge camera to 4 times');
    $('cameraZoomHint').textContent=scale>1?'Drag to pan · Tap to fit':'Tap to zoom 4×';
    $('cameraZoomControls').querySelectorAll('button').forEach(b=>
      b.setAttribute('aria-pressed',String(Number(b.dataset.scale)===scale)));
  }
  function setBridgeScale(scale){
    if(camera?.id!=='ambassador'||![1,2,3,4].includes(scale))return;
    bridgeZoom.scale=scale;bridgeZoom.pointer=null;
    const lim=bridgePanLimits();
    bridgeZoom.x=scale===1?0:lim.x*BRIDGE_DEFAULT_FRAMING.left;
    bridgeZoom.y=scale===1?0:lim.y*BRIDGE_DEFAULT_FRAMING.up;
    applyBridgeZoom();
  }
  function resetCameraFrame(){
    const frame=$('cameraFrame');
    frame.src='about:blank';frame.removeAttribute('src');
    frame.hidden=true;frame.style.transform='';
    bridgeZoom.scale=1;bridgeZoom.x=0;bridgeZoom.y=0;bridgeZoom.pointer=null;
    $('cameraZoomSurface').hidden=true;
    $('cameraZoomSurface').classList.remove('is-dragging');
    $('cameraZoomControls').hidden=true;
  }
  function closeCamera(){
    resetCameraFrame();
    camera=null;backdropPressed=false;
    if($('cameraDialog').open)$('cameraDialog').close();
  }
  function openCamera(id){
    if(id==='gordie'||!CAMERAS[id])return;
    if(camera)closeCamera();
    focusBeforeCamera=document.activeElement||null;
    camera={id,index:0};
    $('cameraDetails').open=false;
    $('cameraTitle').textContent=LABELS[id][0]+' camera';
    $('cameraSubtitle').textContent=(direction==='us'?'Into USA · CBP':'Into Canada · CBSA')+' · official camera';
    $('officialCamera').href=id==='tunnel'?OFFICIAL.tunnel:OFFICIAL.ambassador[direction];
    renderCameraInfo();
    $('cameraDialog').showModal();
    switchView(0);
  }
  function switchView(index){
    if(!camera)return;
    const views=CAMERAS[camera.id][direction],view=views?.[index];
    if(!view)return;
    camera.index=index;resetCameraFrame();
    const frame=$('cameraFrame');
    $('cameraNotice').hidden=false;
    $('cameraNotice').textContent='Loading official camera. If video does not play, use the operator link.';
    $('cameraViewChoices').hidden=views.length<=1;
    $('cameraViewChoices').innerHTML=views.map((v,i)=>
      '<button type="button" data-view="'+i+'" aria-pressed="'+String(i===index)+'">'+esc(v[0])+'</button>').join('');
    $('cameraViewChoices').querySelectorAll('button').forEach(b=>
      b.addEventListener('click',()=>switchView(Number(b.dataset.view))));
    frame.src=view[1];frame.hidden=false;
    const isBridge=camera.id==='ambassador';
    $('cameraZoomSurface').hidden=!isBridge;
    $('cameraZoomControls').hidden=!isBridge;
    if(isBridge){
      setBridgeScale(BRIDGE_DEFAULT_ZOOM);
      const expectedCamera=camera, expectedIndex=index;
      requestAnimationFrame(()=>{
        if(camera===expectedCamera&&camera.index===expectedIndex&&$('cameraDialog').open)
          setBridgeScale(BRIDGE_DEFAULT_ZOOM);
      });
    }
  }
  const cameraZoomSurface=$('cameraZoomSurface');
  cameraZoomSurface.addEventListener('pointerdown',e=>{
    if(camera?.id!=='ambassador'||e.button!==0)return;
    bridgeZoom.pointer={id:e.pointerId,x:e.clientX,y:e.clientY,
      startX:bridgeZoom.x,startY:bridgeZoom.y,moved:false};
    cameraZoomSurface.setPointerCapture(e.pointerId);
  });
  cameraZoomSurface.addEventListener('pointermove',e=>{
    const p=bridgeZoom.pointer;
    if(!p||p.id!==e.pointerId||camera?.id!=='ambassador'||bridgeZoom.scale<=1)return;
    const dx=e.clientX-p.x,dy=e.clientY-p.y;
    if(Math.hypot(dx,dy)>6)p.moved=true;
    if(p.moved){
      bridgeZoom.x=p.startX+dx;bridgeZoom.y=p.startY+dy;
      cameraZoomSurface.classList.add('is-dragging');applyBridgeZoom();
    }
  });
  cameraZoomSurface.addEventListener('pointerup',e=>{
    const p=bridgeZoom.pointer;
    if(!p||p.id!==e.pointerId)return;
    if(!p.moved)setBridgeScale(bridgeZoom.scale===1?BRIDGE_DEFAULT_ZOOM:1);
    bridgeZoom.pointer=null;cameraZoomSurface.classList.remove('is-dragging');
    if(cameraZoomSurface.hasPointerCapture(e.pointerId))
      cameraZoomSurface.releasePointerCapture(e.pointerId);
  });
  cameraZoomSurface.addEventListener('pointercancel',()=>{
    bridgeZoom.pointer=null;cameraZoomSurface.classList.remove('is-dragging');
  });
  cameraZoomSurface.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    e.preventDefault();
    setBridgeScale(bridgeZoom.scale===1?BRIDGE_DEFAULT_ZOOM:1);
  });
  $('cameraZoomControls').querySelectorAll('button').forEach(b=>
    b.addEventListener('click',()=>setBridgeScale(Number(b.dataset.scale))));
  window.addEventListener('resize',()=>{if(camera?.id==='ambassador')applyBridgeZoom()});
  const cameraDialog=$('cameraDialog');
  function outsideDialog(e){
    const r=cameraDialog.getBoundingClientRect();
    return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;
  }
  cameraDialog.addEventListener('pointerdown',e=>{
    backdropPressed=e.target===cameraDialog&&outsideDialog(e);
  });
  cameraDialog.addEventListener('pointerup',e=>{
    const dismiss=backdropPressed&&e.target===cameraDialog&&outsideDialog(e);
    backdropPressed=false;
    if(dismiss)closeCamera();
  });
  cameraDialog.addEventListener('pointercancel',()=>{backdropPressed=false});
  cameraDialog.addEventListener('cancel',e=>{e.preventDefault();closeCamera()});
  cameraDialog.addEventListener('close',()=>{
    resetCameraFrame();camera=null;backdropPressed=false;
    if(focusBeforeCamera&&typeof focusBeforeCamera.focus==='function'&&focusBeforeCamera.isConnected!==false)
      focusBeforeCamera.focus({preventScroll:true});
    focusBeforeCamera=null;
  });
  $('intoUs').addEventListener('click',()=>setDirection('us'));
  $('intoCa').addEventListener('click',()=>setDirection('ca'));
  function setDirection(next){if(next===direction)return;direction=next;try{localStorage.setItem('nexus-board-direction',next)}catch{}if(camera)closeCamera();render();}
  $('refresh').addEventListener('click',refresh);
  $('closeCamera').addEventListener('click',closeCamera);

  $('cameraRetry').addEventListener('click',()=>{if(camera)switchView(camera.index)});
  render();refresh();
  setInterval(()=>{if(!document.hidden)refresh()},REFRESH_MS);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastTry>REFRESH_MS)refresh()});
  setInterval(()=>{if(!document.hidden)render()},60000);
})();
