(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const D=window.NexusDecision;
  const IDS=['tunnel','ambassador','gordie'];
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
  function freshness(raw){
    if(!data)return {kind:'unavailable',age:Infinity};
    const r=D.reading(raw,data,Date.now());
    const s=source();
    if(s?.status!=='ok')return {kind:'unavailable',age:D.age(raw?.observation_at)};
    if(sourceAge()>20&&['current','aging','closed','not_applicable'].includes(r.kind))
      return {kind:'stale',age:r.age};
    return r;
  }
  function entry(raw,category){
    // Canada-bound NEXUS inspection waits and lane counts are not published by CBSA.
    if(direction==='ca'&&category==='nexus')return {wait:'—',lanes:'—',kind:'unavailable',status:'Not reported by CBSA'};
    const r=freshness(raw),age=D.age(raw?.observation_at),up=Number.isFinite(age)&&age<=20&&source()?.status==='ok'&&sourceAge()<=20&&snapshotAge()<=20;
    const count=Number.isInteger(raw?.lanes_open)&&raw.lanes_open>=0?String(raw.lanes_open):'—';
    if(!raw)return {wait:'—',lanes:'—',kind:'unavailable',status:'Not reported'};
    let wait='—',kind=r.kind,status='Unavailable';
    if(raw.status==='reported'&&Number.isInteger(raw.minutes)&&raw.minutes>=0&&raw.minutes<=720){
      if(r.kind!=='unavailable'){wait=String(raw.minutes);status=r.kind==='current'?'Current · '+ago(age):r.kind==='aging'?'Aging · '+ago(age):r.kind==='stale'?'Stale · '+ago(age):'Old report · '+ago(age)}
      else{kind='unavailable';status='Last report '+ago(age)+' · not current';}
    }else if(raw.status==='closed'){wait='Closed';kind=up?'warning':'old';status=up?'Source-reported closure':'Last reported closed · not live'}
    else if(raw.status==='not_applicable'){wait='N/A';status='Not applicable';}
    else if(Number.isFinite(age)){status='Report '+ago(age)}
    const lanes=count!=='—'?(up?count:count+'*'):'—';
    if(count==='—'&&raw.status==='closed')status+=' · lanes unreported';
    return {wait,lanes,kind,status,observation:raw.observation_at,countRaw:count};
  }
  function metric(m,id,cat){
    const wait=m.wait==='Closed'?'<span class="closed-word">Closed</span>':esc(m.wait)+' <small>'+((m.wait==='—'||m.wait==='N/A')?'':'min')+'</small>';
    const laneText=m.lanes==='—'?'Lanes: —':'Lanes: '+esc(m.lanes);
    return '<div class="reading '+cat+'" aria-label="'+esc(cat)+' for '+esc(LABELS[id][0])+': '+esc(m.wait)+', '+esc(laneText)+', '+esc(m.status)+'">'+
      '<div class="reading-main">'+wait+'</div><div class="reading-lanes">'+laneText+'</div>'+
      '<div class="reading-state" data-state="'+esc(m.kind)+'">'+esc(m.status)+'</div></div>';
  }
  function render(){
    $('intoUs').setAttribute('aria-pressed',String(direction==='us'));
    $('intoCa').setAttribute('aria-pressed',String(direction==='ca'));
    const s=source(),snap=snapshotAge(),fetchAge=sourceAge();
    let state='warn',note='No published border data available';
    if(busy&&!data)note='Loading latest published official reports…';
    else if(loadError)note='Snapshot connection error · '+loadError;
    else if(s?.status==='error'){state='error';note=(direction==='us'?'CBP':'CBSA')+' upstream retrieval failed · last historical report only'}
    else if(s?.status!=='ok')note='Official source unavailable';
    else if(snap>20||fetchAge>20)note='Connected · published snapshot or collection is overdue';
    else{state='ok';note=(direction==='us'?'CBP':'CBSA')+' connected · source retrieved '+ago(fetchAge)}
    $('statusDot').dataset.state=state;
    $('summary').textContent=note;
    const now=Date.now();
    $('crossingRows').innerHTML=IDS.map(id=>{
      const port=data?.directions?.[direction]?.[id]||{};
      return '<article class="crossing-row" aria-label="'+esc(LABELS[id][0])+'">'+
        '<div><div class="crossing-name">'+esc(LABELS[id][0])+'</div><div class="crossing-short">'+(direction==='us'?'CBP':'CBSA')+' · '+(Number.isFinite(D.age(port.standard?.observation_at,now))?'regular '+ago(D.age(port.standard?.observation_at,now)):'time not reported')+'</div></div>'+
        metric(entry(port.nexus,'nexus'),id,'NEXUS')+
        metric(entry(port.standard,'regular'),id,'Regular')+
        '<div class="camera-cell"><button type="button" class="camera-button" data-camera="'+id+'" aria-label="'+esc(id==='gordie'?'Camera not yet available for Gordie Howe':'Open '+LABELS[id][0]+' camera')+'" title="'+(id==='gordie'?'Camera not yet officially available':'Open camera')+'" '+(id==='gordie'?'disabled':'')+'>'+(id==='gordie'?'⊘':'▣')+'</button></div>'+
        '</article>';
    }).join('');
    $('crossingRows').querySelectorAll('button[data-camera]:not(:disabled)').forEach(b=>b.addEventListener('click',()=>openCamera(b.dataset.camera)));
    const anyOld=IDS.some(id=>{const p=data?.directions?.[direction]?.[id]||{};return ['stale','old','unavailable'].includes(freshness(p.standard).kind)});
    $('freshnessNote').textContent=(anyOld?'* Lane counts are last-reported (not necessarily live). ':'')+
      'Missing readings and missing lane counts are never assumed zero. CBSA does not supply separate NEXUS waits or lane counts; border inspection minutes exclude road approaches.';
    renderDiagnostics();
  }
  function renderDiagnostics(){
    const lines=[];
    lines.push('<div class="diag-grid"><div><strong>Snapshot generated</strong><div>'+esc(clock(data?.generated_at))+' · '+esc(ago(snapshotAge()))+'</div></div>'+
      '<div><strong>Last browser check</strong><div>'+esc(lastFetch?clock(lastFetch):'Not yet')+'</div></div></div>');
    if(loadError)lines.push('<p>Connection error: '+esc(loadError)+'</p>');
    for(const id of IDS){
      const port=data?.directions?.[direction]?.[id]||{};
      lines.push('<div class="diag-entry"><strong>'+esc(LABELS[id][0])+'</strong>');
      for(const [key,label] of [['nexus','NEXUS'],['standard','Regular']]){
        if(direction==='ca'&&key==='nexus'){lines.push('<div>NEXUS: no inspection-wait or lane-count data from CBSA</div>');continue;}
        const raw=port[key];const count=Number.isInteger(raw?.lanes_open)?raw.lanes_open:'not supplied';
        const value=Number.isInteger(raw?.minutes)&&raw.status==='reported'?raw.minutes+' min':raw?.status||'not supplied';
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
        ' · '+esc(src?.coverage??'—')+' records'+(src.retained_previous?' · HISTORICAL FALLBACK':'')+
        '<div>Retrieved: '+esc(clock(src?.retrieved_at))+' · last success: '+esc(clock(src?.last_success_at||src?.retrieved_at))+'</div>'+
        (url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Official source ↗</a>':'')+'</div>');
    }
    lines.push('<p>Source retrieval, agency observation, and page publication are different timestamps. “Closed” and “0 min” are different reports; missing lanes do not mean zero lanes. Counts are source-reported, not independently confirmed.</p>');
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
  function openCamera(id){
    if(id==='gordie')return;
    camera={id,index:0};
    $('cameraTitle').textContent=LABELS[id][0]+' camera';
    $('cameraSubtitle').textContent=direction==='us'?'Into USA':'Into Canada';
    $('officialCamera').href=id==='tunnel'?OFFICIAL.tunnel:OFFICIAL.ambassador[direction];
    $('cameraDialog').showModal();switchView(0);
  }
  function switchView(index){
    if(!camera)return;
    camera.index=index;
    const views=CAMERAS[camera.id][direction],frame=$('cameraFrame');
    frame.hidden=true;frame.removeAttribute('src');$('cameraNotice').hidden=false;
    $('cameraNotice').textContent='Loading official camera. If video does not play, use the operator link.';
    $('cameraViewChoices').innerHTML=views.map((v,i)=>'<button type="button" data-view="'+i+'" aria-pressed="'+String(i===index)+'">'+esc(v[0])+'</button>').join('');
    $('cameraViewChoices').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>switchView(Number(b.dataset.view))));
    frame.src=views[index][1];frame.hidden=false;
  }
  function closeCamera(){$('cameraFrame').removeAttribute('src');$('cameraFrame').hidden=true;camera=null;$('cameraDialog').close();}
  $('intoUs').addEventListener('click',()=>setDirection('us'));
  $('intoCa').addEventListener('click',()=>setDirection('ca'));
  function setDirection(next){if(next===direction)return;direction=next;try{localStorage.setItem('nexus-board-direction',next)}catch{}if(camera)closeCamera();render();}
  $('refresh').addEventListener('click',refresh);
  $('closeCamera').addEventListener('click',closeCamera);
  $('cameraDialog').addEventListener('close',()=>{$('cameraFrame').removeAttribute('src');$('cameraFrame').hidden=true;camera=null});
  $('cameraRetry').addEventListener('click',()=>{if(camera)switchView(camera.index)});
  render();refresh();
  setInterval(()=>{if(!document.hidden)refresh()},REFRESH_MS);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastTry>REFRESH_MS)refresh()});
  setInterval(()=>{if(!document.hidden)render()},60000);
})();
