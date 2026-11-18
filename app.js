(() => {
  'use strict';
  const D = window.NexusDecision;
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'nexus-prototype-v1'; // Preserve pre-RC1.4 local preferences.
  const NAMES = D.NAMES;
  const CROSSINGS = {
    tunnel: {waypoint:'Detroit Windsor Tunnel'},
    ambassador: {waypoint:'Ambassador Bridge, Windsor Detroit border'},
    gordie: {waypoint:'Gordie Howe International Bridge'}
  };
  const CBSA_HOURS_URL = 'https://www.cbsa-asfc.gc.ca/data/cbsa-offices-services-bureaux-asfc-en.json';
  const DACAST_ROOT='https://iframe.dacast.com/live/8b2b630f-b7c1-262d-f343-118f510224a0/';
  const CAMERAS = {
    tunnel:{us:{provider:'Detroit–Windsor Tunnel',official:'https://www.dwtunnel.com/',views:[{title:'Windsor inspection',embed:DACAST_ROOT+'4aea1c45-d402-3690-afae-fe635942da82'}]},
      ca:{provider:'Detroit–Windsor Tunnel',official:'https://www.dwtunnel.com/',views:[{title:'Detroit inspection',embed:DACAST_ROOT+'794566d4-a75e-3cd1-6f95-2d60e54f2fdb'},{title:'Randolph Street',embed:DACAST_ROOT+'5408b5c3-f8d1-f34b-a18a-9943047905b6'}]}},
    ambassador:{us:{provider:'Ambassador Bridge',official:'https://www.ambassadorbridge.com/into-the-united-states/',views:[{title:'Towards USA',embed:'https://ambassador.solutionspal.com/cams/cam2.html'}]},
      ca:{provider:'Ambassador Bridge',official:'https://www.ambassadorbridge.com/into-canada/',views:[{title:'Towards Canada',embed:'https://ambassador.solutionspal.com/cams/cam1.html'}]}},
    gordie:{us:{provider:'Ontario 511',official:'https://511on.ca/?SelectedLayers=Cameras',views:[]},
      ca:{provider:'MDOT Mi Drive',official:'https://mdotjboss.state.mi.us/MiDrive/map?cameras=true',views:[]}}
  };
  const defaults={direction:'us', favorites:{us:null,ca:null}, selected:{us:'tunnel',ca:'gordie'},
    destinations:{home:'',work:''}, destinationChoice:'work',theme:'system',nexus:true,recommendation:'conservative'};
  const safeText = x=>String(x??'').slice(0,280);
  const esc = x=>safeText(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtAge = n=>!Number.isFinite(n)?'time unknown':n<2?'just now':n<60?`${Math.round(n)} min ago`:`${Math.floor(n/60)}h ${Math.floor(n%60)}m ago`;
  const fmtClock=x=>{const t=new Date(x||'');return Number.isNaN(t.getTime())?'time unknown':new Intl.DateTimeFormat('en-CA',{hour:'numeric',minute:'2-digit',timeZone:'America/Toronto'}).format(t);};
  const fmtWait=r=>D.usable(r)?String(r.minutes):r.kind==='closed'?'Closed':'—';
  const waitUnit=r=>D.usable(r)?'min':'';
  function load(){try{const raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');return {...defaults,...raw,
    favorites:{...defaults.favorites,...raw.favorites},selected:{...defaults.selected,...raw.selected},
    destinations:{...defaults.destinations,...raw.destinations},
    recommendation:['conservative','balanced','information'].includes(raw.recommendation)?raw.recommendation:'conservative'};}catch{return structuredClone(defaults);}}
  let prefs=load(), tripOverride=null, customDestination='', routeOrigin='', data=null, lastClientFetch='', loadError='', busy=false;
  let camera=null, cameraIndex=0, manuallySelectedDirection=false;
  // The camera is a cross-origin iframe; zoom/pan the visible bridge frame, never its internal DOM.
  const bridgeZoom={scale:1,x:0,y:0,pointer:null};
  const urlParams=new URLSearchParams(location.search);
  const explicitDirection=urlParams.has('direction');
  if(['us','ca'].includes(urlParams.get('direction'))) prefs.direction=urlParams.get('direction');
  if(['tunnel','ambassador','gordie','ghib'].includes(urlParams.get('crossing'))) tripOverride=urlParams.get('crossing')==='ghib'?'gordie':urlParams.get('crossing');
  if(urlParams.has('destination')){customDestination=(urlParams.get('destination')||'').slice(0,180);prefs.destinationChoice='custom';}
  if(urlParams.has('origin'))routeOrigin=(urlParams.get('origin')||'').slice(0,180);
  if(['nexus','standard'].includes(urlParams.get('mode')))prefs.nexus=urlParams.get('mode')==='nexus';
  function preferredId(){return prefs.favorites[prefs.direction]||prefs.selected[prefs.direction]|| (prefs.direction==='us'?'tunnel':'gordie');}
  function activeId(){return tripOverride||preferredId();}
  function destination(){return prefs.destinationChoice==='custom'?customDestination:(prefs.destinations[prefs.destinationChoice]||'');}
  function save(){const value={...prefs,destinationChoice:prefs.destinationChoice==='custom'?'work':prefs.destinationChoice};try{localStorage.setItem(STORAGE_KEY,JSON.stringify(value));}catch{}}
  function applyTheme(){const dark=prefs.theme==='dark'||(prefs.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.body.dataset.theme=dark?'dark':'light';document.querySelector('meta[name="theme-color"]').content=dark?'#101a24':'#f4f7fa';}
  function setText(id,value){$(id).textContent=value;}
  function render(){
    applyTheme();
    $('tripSelect').value=prefs.destinationChoice;
    $('toUS').setAttribute('aria-pressed',String(prefs.direction==='us'));
    $('toCA').setAttribute('aria-pressed',String(prefs.direction==='ca'));
    setText('preferredLabel',tripOverride&&tripOverride!==preferredId()?'For this trip':'Your default');
    const evaluation=D.evaluate(data,prefs.direction,activeId(),prefs.nexus,prefs.recommendation);
    const home=evaluation.home;
    setText('crossingRole',tripOverride&&tripOverride!==preferredId()?'SELECTED FOR THIS TRIP':'PREFERRED CROSSING');
    setText('heroName',home.name);
    // Present the applicable inspection category first, while keeping both
    // regular and NEXUS visible. CA-bound NEXUS wait is explicitly unknown.
    const nxLanes=prefs.direction==='us'?home.port?.nexus?.lanes_open:null;
    const nexusMetric={label:`NEXUS · ${prefs.direction==='us'?'CBP':'not reported'}`,
      reading:prefs.direction==='us'?home.nexus:{kind:'unavailable'},
      note:prefs.direction==='ca'?(home.dwt?.lane_counts?.nexus!=null?`${home.dwt.lane_counts.nexus} operator-listed lanes · Wait unavailable`:'Canada-bound NEXUS wait not reported'):
        D.usable(home.nexus)&&Number.isInteger(nxLanes)?`${nxLanes} ${nxLanes===1?'lane':'lanes'} reported`:
        home.nexus.kind==='closed'?'Lane reported closed':home.nexus.kind==='stale'?'Reading too old':'Wait not available'};
    const lanes=home.port?.standard?.lanes_open;
    const regularMetric={label:`Regular · ${prefs.direction==='us'?'CBP':'CBSA'}`,reading:home.standard,
      note:D.usable(home.standard)?Number.isInteger(lanes)?`${lanes} ${lanes===1?'lane':'lanes'} reported`:`Reported ${fmtAge(home.standard.age)}`:
        home.standard.kind==='closed'?'Lane reported closed':home.standard.kind==='stale'?'Reading too old':'Wait not available'};
    const leadNexus=prefs.nexus&&prefs.direction==='us';
    const lead=leadNexus?nexusMetric:regularMetric;
    const secondary=leadNexus?regularMetric:nexusMetric;
    $('primaryLabel').closest('.metric').classList.add('primary-metric');
    $('regularLabel').closest('.metric').classList.remove('primary-metric');
    setText('primaryLabel',lead.label);setText('primaryValue',fmtWait(lead.reading));
    setText('primaryUnit',waitUnit(lead.reading));setText('primaryNote',lead.note);
    setText('regularLabel',secondary.label);setText('regularValue',fmtWait(secondary.reading));
    setText('regularUnit',waitUnit(secondary.reading));setText('regularNote',secondary.note);
    $('operatorLine').hidden=!home.dwt;
    if(home.dwt){const c=home.dwt.lane_counts;setText('operatorLine',`Tunnel operator · ${c.nexus??'—'} NEXUS lanes listed · ${c.car??'—'} car lanes listed · ${home.dwt.travel_time_category?'Travel category '+home.dwt.travel_time_category+' min':''} · Reported ${fmtAge(D.age(home.dwt.observation_at,Date.now()))}`);}
    setText('findingHeading',evaluation.headline);setText('findingDetail',evaluation.detail);
    $('finding').dataset.level=evaluation.kind;
    $('findingIcon').querySelector('use').setAttribute('href',evaluation.kind==='normal'?'#i-check':evaluation.kind==='closed'||evaluation.kind==='consider'||evaluation.kind==='caution'?'#i-alert':'#i-info');
    $('resetTrip').hidden=!tripOverride||tripOverride===preferredId();
    setText('navigateText',destination().trim()?'Preview route':'Set destination');
    setText('heroFreshness',D.usable(home.primary)?`${home.primaryType==='nexus'?'NEXUS':'Regular'} report ${fmtAge(home.primary.age)} · ${prefs.direction==='us'?'CBP':'CBSA'}`:'No current inspection reading');
    renderAlternatives(evaluation);
    renderDataStatus();renderEvents();renderDetails();renderDiagnostics();
  }
  function renderAlternatives(result){
    const alt=result.alternatives;
    $('alternatives').innerHTML=alt.map(c=>{
      const isNx=prefs.nexus&&prefs.direction==='us'&&c.primaryType==='nexus';
      const source=prefs.direction==='us'?'CBP':'CBSA';
      const note=c.portClosed?'Port reported closed':D.usable(c.primary)?`${isNx?'NEXUS':'Regular'} inspection · ${source}`:c.primary.kind==='stale'?'Inspection reading stale':'Inspection wait unavailable';
      return `<button type="button" class="alternative" data-crossing="${c.id}" aria-label="Select ${esc(c.name)} for this trip"><span class="alt-caption"><h3>${esc(c.name)}</h3><svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg></span><span class="alt-wait">${c.portClosed?'Closed':fmtWait(c.primary)} <small>${!c.portClosed&&D.usable(c.primary)?'min':''}</small></span><span class="alt-sub">${esc(note)}</span></button>`;
    }).join('');
    $('alternatives').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{tripOverride=button.dataset.crossing;render();scrollTo({top:0,behavior:'smooth'});}));
  }
  function renderDataStatus(){
    const source=data?.sources?.[prefs.direction==='us'?'cbp':'cbsa'];
    const freshness=D.age(data?.generated_at,Date.now());
    const result=D.evaluate(data,prefs.direction,activeId(),prefs.nexus,prefs.recommendation);
    let level='unknown',line='Official reports unavailable';
    if(busy&&!data)line='Checking official sources…';
    else if(source?.status==='ok'&&freshness<=150){
      const count=result.crossings.filter(c=>D.usable(c.standard)).length;
      level=count===3?'ok':'caution';line=`${prefs.direction==='us'?'CBP':'CBSA'} · ${count}/3 usable crossing reports · Snapshot ${fmtAge(freshness)}`;
    }else if(data&&freshness>150){level='caution';line=`Snapshot stale (${fmtAge(freshness)}). Official readings may be outdated.`;}
    else if(loadError){level='caution';line='Latest report unavailable';}
    $('dataBar').dataset.level=level;setText('dataStatus',line);
  }
  function renderEvents(){
    const source=data?.sources?.ontario511;
    const list=data?.supplemental?.ontario511_events||[];
    const fresh=source?.status==='ok'&&D.age(source.retrieved_at,Date.now())<=150&&D.age(data.generated_at,Date.now())<=150;
    $('alertsSection').hidden=!fresh||list.length===0;
    if(!fresh)return;
    $('advisories').innerHTML=list.slice(0,3).map(e=>`<div class="alert-row"><strong>${esc(e.roadway)}${e.is_full_closure?' · Closure reported':''}</strong><div class="subtle">${esc(e.description||e.type)}${e.direction?' · '+esc(e.direction):''}</div></div>`).join('');
  }
  const detailLine=(name,value)=>`<div class="detail-line"><span>${esc(name)}</span><strong>${esc(value??'—')}</strong></div>`;
  function fieldWait(c,key,label){
    const reading=c[key];const raw=c.port?.[key];
    let value=reading?.kind==='closed'?'Closed':reading?.kind==='not_applicable'?'Not applicable':D.usable(reading)?`${reading.minutes} min`:'Unavailable';
    if(reading?.kind==='stale')value='Stale';
    const lane=raw?.lanes_open;
    if(Number.isInteger(lane)&&D.usable(reading))value+=` · ${lane} lanes reported`;
    return detailLine(label,value);
  }
  function renderDetails(){
    const x=D.IDS.map(id=>D.crossing(data,prefs.direction,id,prefs.nexus,Date.now()));
    $('detailsBody').innerHTML=x.map(c=>{
      let content=fieldWait(c,'standard','Regular wait');
      if(prefs.direction==='us'){
        content+=fieldWait(c,'nexus','NEXUS wait')+fieldWait(c,'ready','Ready Lane');
        content+=fieldWait(c,'commercial','Commercial')+fieldWait(c,'fast','FAST');
        content+=fieldWait(c,'pedestrian','Pedestrian');
        content+=detailLine('Passenger max lanes',c.port?.passenger_max_lanes);
        content+=detailLine('Commercial max lanes',c.port?.commercial_max_lanes);
        if(c.port?.published_port_hours)content+=detailLine('Published port hours',c.port.published_port_hours);
        if(c.port?.port_status)content+=detailLine('Port status',c.port.port_status);
        if(c.port?.notice)content+=detailLine('CBP notice',c.port.notice);
      }else{
        content+=fieldWait(c,'commercial','Commercial wait');
        content+=detailLine('NEXUS inspection wait','Not supplied by CBSA');
        const groups=data?.supplemental?.cbsa_nexus_hours?.[c.id]?.groups||[];
        const schedules=groups.flatMap(g=>(g.rows||[]).map(r=>`${r.label||g.label}: ${r.start||''}${r.start&&r.end?'–':''}${r.end||''}${r.custom?' '+r.custom:''}`));
        const scheduleFresh=data?.sources?.cbsa_hours?.status==='ok' && D.age(data.sources.cbsa_hours.retrieved_at,Date.now())<2880;
        content+=`<p class="subtle">Published Canada-bound NEXUS hours (schedule, not live): ${scheduleFresh&&schedules.length?esc(schedules.join(' · ')):'Unavailable or not verified'}. <a href="${CBSA_HOURS_URL}" target="_blank" rel="noopener noreferrer">CBSA directory</a></p>`;
      }
      if(c.id==='tunnel'&&c.dwt){content+=detailLine('DWT listed NEXUS lanes',c.dwt.lane_counts.nexus)+detailLine('DWT listed car lanes',c.dwt.lane_counts.car)+detailLine('DWT listed truck lanes',c.dwt.lane_counts.truck)+detailLine('Operator travel-time category',c.dwt.travel_time_category?c.dwt.travel_time_category+' min':'Not reported')+detailLine('Operator observation',fmtClock(c.dwt.observation_at));}
      if(c.id==='tunnel'&&c.dwtStale)content+='<p class="subtle">DWT operator observation is stale; lane counts hidden.</p>';
      content+=detailLine('Standard wait observed',c.port?.standard?.observation_at?fmtClock(c.port.standard.observation_at):'Unknown');
      return `<article class="detail-crossing"><h3>${esc(c.name)}</h3>${content}</article>`;
    }).join('')+`<p class="subtle">Inspection estimates and operator travel-time categories describe different measurements; they are not added together. Road events shown above describe the Windsor-Essex vicinity, not a validated route impact.</p>`;
  }
  function renderDiagnostics(){
    const sources=data?.sources||{};
    $('diagnosticText').innerHTML=[`<p>Build: RC1.4 · Schema: ${esc(data?.schema||'No snapshot')}</p>`,`<p>Generated: ${esc(data?.generated_at||'Unavailable')} · Browser fetch: ${esc(lastClientFetch||'Not yet')}</p>`,...Object.entries(sources).map(([k,v])=>`<p><strong>${esc(k.toUpperCase())}</strong> · ${esc(v.status||'?')} · ${esc(v.coverage===undefined?'':v.coverage+' records')} · Retrieved ${esc(v.retrieved_at||'unknown')}${v.error?' · '+esc(v.error):''}<br><a href="${esc(v.url||'#')}" target="_blank" rel="noopener noreferrer">Official source</a></p>`),
    '<p>MDOT RIDE requires MiLogin for Business. Ontario 511 event ingestion requires a developer key. Supplemental feed failure never fabricates a delay or closure.</p>'].join('');
  }
  async function refresh(){
    if(busy)return;
    busy=true;renderDataStatus();const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),13000);
    try{const response=await fetch(`./data/live.json?ts=${Date.now()}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error(`HTTP ${response.status}`);
      const payload=await response.json();if(!['nexus-live-v2','nexus-live-v1'].includes(payload.schema)||!payload.sources||!payload.directions)throw Error('Unrecognized snapshot');
      data=payload;loadError='';lastClientFetch=new Date().toISOString();
    }catch(e){loadError=safeText(e.message||e);}finally{clearTimeout(timeout);busy=false;render();}
  }
  function setDirection(dir,manual){prefs.direction=dir;tripOverride=null;if(manual)manuallySelectedDirection=true;save();render();}
  function locationFeedback(text){setText('locationStatus',text);}
  function detectDirection(explicit){
    if(!navigator.geolocation||manuallySelectedDirection)return;
    $('locateDirection').disabled=true;
    navigator.geolocation.getCurrentPosition(pos=>{
      $('locateDirection').disabled=false;
      const side=D.countrySide(pos.coords.latitude,pos.coords.longitude,pos.coords.accuracy);
      if(!side){locationFeedback('Location uncertain · direction unchanged');return;}
      setDirection(side==='ca'?'us':'ca',false);
      locationFeedback(side==='ca'?'Canada detected · to USA':'USA detected · to Canada');
    },err=>{$('locateDirection').disabled=false;if(explicit)locationFeedback(err.code===1?'Location not permitted':'Location unavailable');},{enableHighAccuracy:false,maximumAge:300000,timeout:7000});
  }
  function autoLocation(){if(explicitDirection||!navigator.permissions?.query)return;navigator.permissions.query({name:'geolocation'}).then(p=>{if(p.state==='granted'&&!manuallySelectedDirection)detectDirection(false);}).catch(()=>{});}
  function openSettings(){
    $('preferredUs').value=prefs.favorites.us||prefs.selected.us||'tunnel';
    $('preferredCa').value=prefs.favorites.ca||prefs.selected.ca||'gordie';
    $('nexusInput').checked=prefs.nexus;$('recommendationInput').value=prefs.recommendation;
    $('homeInput').value=prefs.destinations.home;$('workInput').value=prefs.destinations.work;$('themeInput').value=prefs.theme;
    $('settingsDialog').showModal();
  }
  function setTrip(value){prefs.destinationChoice=value;if(value==='custom'){customDestination=customDestination||'';openRoute();}else save();render();}
  function openRoute(){$('routeCrossingLabel').textContent=`Selected crossing: ${NAMES[activeId()]}`;$('originRoute').value=routeOrigin;$('destinationRoute').value=destination().trim();$('routeDialog').showModal();}
  function buildShareUrl(){const u=new URL(location.href);u.search='';u.hash='';u.searchParams.set('direction',prefs.direction);u.searchParams.set('crossing',activeId());u.searchParams.set('mode',prefs.nexus?'nexus':'standard');if(routeOrigin)u.searchParams.set('origin',routeOrigin);if(destination())u.searchParams.set('destination',destination());return u.toString();}
  function showMaps(){const dest=destination().trim();if(!dest){openRoute();return;}
    const u=new URL('https://www.google.com/maps/dir/');u.searchParams.set('api','1');u.searchParams.set('travelmode','driving');u.searchParams.set('destination',dest);if(routeOrigin)u.searchParams.set('origin',routeOrigin);u.searchParams.set('waypoints',CROSSINGS[activeId()].waypoint);
    window.open(u.toString(),'_blank','noopener,noreferrer');
  }
  function resetBridgeZoom(){
    Object.assign(bridgeZoom,{scale:1,x:0,y:0,pointer:null});
    $('cameraFrame').style.transform='';
    $('cameraZoomSurface').classList.remove('is-zoomed','is-dragging');
    $('cameraZoomSurface').setAttribute('aria-pressed','false');
    $('cameraZoomSurface').setAttribute('aria-label','Zoom bridge camera');
    setText('cameraZoomHintText','Tap to zoom');
  }
  function showBridgeZoom(enable){
    resetBridgeZoom();
    $('cameraZoomSurface').hidden=!enable;
    $('cameraZoomHint').hidden=!enable;
  }
  function clampBridgePan(){
    const stage=$('cameraStage');
    const maxX=stage.clientWidth*(bridgeZoom.scale-1)/2;
    const maxY=stage.clientHeight*(bridgeZoom.scale-1)/2;
    bridgeZoom.x=Math.max(-maxX,Math.min(maxX,bridgeZoom.x));
    bridgeZoom.y=Math.max(-maxY,Math.min(maxY,bridgeZoom.y));
  }
  function applyBridgeZoom(){
    clampBridgePan();
    $('cameraFrame').style.transform=bridgeZoom.scale===1?'':`translate(${bridgeZoom.x}px,${bridgeZoom.y}px) scale(${bridgeZoom.scale})`;
    const zoomed=bridgeZoom.scale>1;
    $('cameraZoomSurface').classList.toggle('is-zoomed',zoomed);
    $('cameraZoomSurface').setAttribute('aria-pressed',String(zoomed));
    $('cameraZoomSurface').setAttribute('aria-label',zoomed?'Pan zoomed bridge camera; tap to reset':'Zoom bridge camera');
    setText('cameraZoomHintText',zoomed?'Drag to pan · Tap to reset':'Tap to zoom');
  }
  function toggleBridgeZoom(clientX,clientY){
    if($('cameraZoomSurface').hidden)return;
    if(bridgeZoom.scale>1){resetBridgeZoom();return;}
    const rect=$('cameraStage').getBoundingClientRect();
    bridgeZoom.scale=2;
    bridgeZoom.x=(rect.left+rect.width/2-clientX)*(bridgeZoom.scale-1);
    bridgeZoom.y=(rect.top+rect.height/2-clientY)*(bridgeZoom.scale-1);
    applyBridgeZoom();
  }
  function unloadCamera(){
    showBridgeZoom(false);
    $('cameraFrame').removeAttribute('src');
    $('cameraFrame').hidden=true;
  }
  function closeCamera(){unloadCamera();camera=null;if($('cameraDialog').open)$('cameraDialog').close();}
  function activateCamera(index){
    if(!camera)return;
    cameraIndex=index;unloadCamera();
    const view=camera.views[index];
    $('cameraViews').querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
    if(!view){
      $('cameraFallback').hidden=false;
      setText('cameraFallbackText','No verified embeddable inspection camera. Open the official approach-camera map.');
      $('cameraReload').hidden=true;
      return;
    }
    $('cameraFallback').hidden=true;
    $('cameraFrame').hidden=false;
    $('cameraFrame').src=view.embed;
    const isBridge=camera.kind==='bridge';
    showBridgeZoom(isBridge);
    $('cameraReload').hidden=false;
    $('cameraReload').lastChild.textContent=isBridge?' Reload camera':' Reload video';
    // Do not cut off a slow-starting Dacast player with our own timer. The
    // publisher controls any provider-side viewing interval or restrictions.
  }
  function openCamera(id){
    closeCamera();camera=CAMERAS[id]?.[prefs.direction];if(!camera)return;
    camera.kind=id==='ambassador'?'bridge':id==='tunnel'?'video':'links';
    setText('cameraTitle',NAMES[id]);setText('cameraDescription',`${prefs.direction==='us'?'Canada → USA':'USA → Canada'} · Official camera view`);
    setText('cameraProvider',camera.provider);$('cameraOfficial').href=camera.official;
    $('cameraViews').innerHTML=camera.views.map((v,i)=>`<button type="button" data-index="${i}" aria-pressed="${i===0}">${esc(v.title)}</button>`).join('');
    $('cameraViews').hidden=camera.views.length<2;
    $('cameraViews').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>activateCamera(Number(b.dataset.index))));
    $('cameraDialog').showModal();activateCamera(0);
  }
  const zoomSurface=$('cameraZoomSurface');
  zoomSurface.addEventListener('pointerdown',e=>{
    if(e.button!==0||zoomSurface.hidden)return;
    bridgeZoom.pointer={id:e.pointerId,x:e.clientX,y:e.clientY,startX:bridgeZoom.x,startY:bridgeZoom.y,moved:false};
    zoomSurface.setPointerCapture(e.pointerId);
  });
  zoomSurface.addEventListener('pointermove',e=>{
    const p=bridgeZoom.pointer;
    if(!p||p.id!==e.pointerId||bridgeZoom.scale<=1)return;
    const dx=e.clientX-p.x,dy=e.clientY-p.y;
    if(Math.hypot(dx,dy)>6)p.moved=true;
    if(p.moved){
      bridgeZoom.x=p.startX+dx;bridgeZoom.y=p.startY+dy;
      zoomSurface.classList.add('is-dragging');applyBridgeZoom();
    }
  });
  zoomSurface.addEventListener('pointerup',e=>{
    const p=bridgeZoom.pointer;
    if(!p||p.id!==e.pointerId)return;
    bridgeZoom.pointer=null;
    zoomSurface.classList.remove('is-dragging');
    if(!p.moved)toggleBridgeZoom(e.clientX,e.clientY);
  });
  zoomSurface.addEventListener('pointercancel',()=>{bridgeZoom.pointer=null;zoomSurface.classList.remove('is-dragging');});
  zoomSurface.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();const r=$('cameraStage').getBoundingClientRect();toggleBridgeZoom(r.left+r.width/2,r.top+r.height/2);}
    if(bridgeZoom.scale>1&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      e.preventDefault();const step=24;
      bridgeZoom.x+=e.key==='ArrowLeft'?step:e.key==='ArrowRight'?-step:0;
      bridgeZoom.y+=e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0;
      applyBridgeZoom();
    }
    if(e.key==='Escape'&&bridgeZoom.scale>1){e.stopPropagation();resetBridgeZoom();}
  });
  window.addEventListener('resize',()=>{if(bridgeZoom.scale>1)applyBridgeZoom();});
  $('settingsButton').addEventListener('click',openSettings);
  $('closeSettings').addEventListener('click',()=>$('settingsDialog').close());
  $('settingsForm').addEventListener('submit',e=>{e.preventDefault();prefs.favorites.us=$('preferredUs').value;prefs.favorites.ca=$('preferredCa').value;prefs.nexus=$('nexusInput').checked;
    prefs.recommendation=$('recommendationInput').value;prefs.destinations.home=$('homeInput').value.trim().slice(0,180);prefs.destinations.work=$('workInput').value.trim().slice(0,180);prefs.theme=$('themeInput').value;
    tripOverride=null;save();$('settingsDialog').close();render();});
  $('toUS').addEventListener('click',()=>setDirection('us',true));$('toCA').addEventListener('click',()=>setDirection('ca',true));
  $('locateDirection').addEventListener('click',()=>{manuallySelectedDirection=false;detectDirection(true);});
  $('tripSelect').addEventListener('change',e=>setTrip(e.target.value));
  $('navigateButton').addEventListener('click',()=>showMaps());
  $('heroCamera').addEventListener('click',()=>openCamera(activeId()));
  $('heroDetails').addEventListener('click',()=>{$('allConditions').open=true;$('allConditions').scrollIntoView({behavior:'smooth',block:'start'});});
  $('compareButton').addEventListener('click',()=>{$('allConditions').open=true;$('allConditions').scrollIntoView({behavior:'smooth',block:'start'});});
  $('dataDetailsButton').addEventListener('click',()=>{$('allConditions').open=true;$('allConditions').scrollIntoView({behavior:'smooth',block:'start'});});
  $('resetTrip').addEventListener('click',()=>{tripOverride=null;render();});
  $('refreshButton').addEventListener('click',refresh);
  $('closeRoute').addEventListener('click',()=>$('routeDialog').close());
  $('routeForm').addEventListener('submit',e=>{e.preventDefault();routeOrigin=$('originRoute').value.trim().slice(0,180);const dest=$('destinationRoute').value.trim().slice(0,180);if(!dest){$('destinationRoute').focus();return;}
    if(prefs.destinationChoice==='custom'){customDestination=dest;}else{prefs.destinations[prefs.destinationChoice]=dest;save();}
    $('routeDialog').close();render();showMaps();});
  $('copyLink').addEventListener('click',async()=>{routeOrigin=$('originRoute').value.trim().slice(0,180);const dest=$('destinationRoute').value.trim().slice(0,180);if(prefs.destinationChoice==='custom')customDestination=dest;else prefs.destinations[prefs.destinationChoice]=dest;
    const link=buildShareUrl();try{await navigator.clipboard.writeText(link);setText('copyLink','Copied');}catch{window.prompt('Copy this trip link:',link);}setTimeout(()=>setText('copyLink','Copy trip link'),1700);});
  $('closeCamera').addEventListener('click',closeCamera);
  $('cameraReload').addEventListener('click',()=>activateCamera(cameraIndex));
  $('cameraDialog').addEventListener('close',()=>{unloadCamera();camera=null;});
  for(const id of ['settingsDialog','routeDialog','cameraDialog'])$(id).addEventListener('click',e=>{if(e.target===$(id))$(id).close();});
  if(matchMedia('(prefers-color-scheme: dark)').addEventListener)matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(prefs.theme==='system')applyTheme();});
  render();autoLocation();refresh();
  setInterval(()=>{if(!document.hidden)refresh();},120000);
  setInterval(()=>{if(!document.hidden){renderDataStatus();const current=D.crossing(data,prefs.direction,activeId(),prefs.nexus,Date.now());setText('heroFreshness',D.usable(current.primary)?`${current.primaryType==='nexus'?'NEXUS':'Regular'} report ${fmtAge(current.primary.age)} · ${prefs.direction==='us'?'CBP':'CBSA'}`:'No current inspection reading');}},60000);
})();
