(function(){
'use strict';
const D=window.NexusDecision;
const IDS=['ambassador','tunnel','gordie'];
const NAMES={ambassador:'Ambassador Bridge',tunnel:'Detroit–Windsor Tunnel',gordie:'Gordie Howe International Bridge'};
const SHORT_NAMES={ambassador:'Ambassador',tunnel:'Tunnel',gordie:'Gordie Howe'};
const $=id=>document.getElementById(id);
const key='nexus-m1-sort';
const categories={passenger:[['regular','Regular'],['nexus','NEXUS'],['ready','Ready']],commercial:[['regular','Regular'],['fast','FAST']]};
const store={data:null,sort:'fixed',vehicle:'passenger',lane:'regular',selected:null,direction:'ca',lastFetch:null,error:null,busy:false,noticesExpanded:false};
try{const v=localStorage.getItem(key);if(['fixed','ca','us'].includes(v))store.sort=v}catch{}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=s=>s&&Number.isFinite(Date.parse(s))?new Date(s).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Unavailable';
const age=s=>D.age(s,Date.now());
const primary=dir=>dir==='ca'?'cbsa':'cbp';
const rawKey=()=>store.lane==='regular'?(store.vehicle==='passenger'?'standard':'commercial'):store.lane;
const source=dir=>store.data?.sources?.[primary(dir)];
function classify(id,dir){
 const src=source(dir),port=store.data?.directions?.[dir]?.[id],raw=port?.[rawKey()];
 const srcAge=age(src?.retrieved_at),snapAge=age(store.data?.generated_at);
 const goodSource=src?.status==='ok'&&srcAge<=20&&snapAge<=20;
 const retained=src?.status==='error'&&src?.retained_previous===true;
 const unavailable=reason=>({kind:'unavailable',text:'--',minutes:null,raw,src,reason});
 // A recent agency-reported full-port closure overrides an otherwise valid
 // numeric booth reading, but is not proof of live physical gate operation.
 if(goodSource&&/^\s*(temporarily\s+)?closed\b/i.test(port?.port_status||''))
   return {kind:'closed',text:'Closed',minutes:null,raw,src,
    reason:'Recent official source reports this direction closed. Check the operator before travel.'};
 if(store.vehicle==='passenger'&&store.lane==='nexus'&&dir==='ca')
   return {kind:'unpublished',text:'--',minutes:null,raw,src,reason:'CBSA does not publish separate Canada-bound NEXUS inspection waits. Published hours are not live lane operation.'};
 if(!raw)return unavailable('No category-specific official wait is published for this crossing and direction.');
 if(src?.status!=='ok'&&!retained)return unavailable('The official source is unavailable; no live wait can be verified.');
 if(raw.status==='not_applicable'){
   return goodSource?{kind:'unsupported',text:'N/A',minutes:null,raw,src,reason:'This category is marked not applicable in the recent official report.'}:unavailable('Category support cannot be verified from a recent official report.');
 }
 const reported=D.reading(raw,store.data,Date.now());
 if(reported.kind==='closed'&&goodSource&&(!raw.observation_at||age(raw.observation_at)<=20))return {kind:'closed',text:'Closed',minutes:null,raw,src,reason:'Source-reported closure; verify before travel.'};
 if(raw.status==='closed')return unavailable('Earlier closure report; current lane operation is unverified.');
 if(!Number.isInteger(reported.minutes))return unavailable('No valid timestamped wait for this lane category.');
 if(!goodSource||retained||!['current','aging'].includes(reported.kind))
   return {kind:'stale',text:reported.minutes+' min',minutes:reported.minutes,raw,src,reason:'Historical report, not a current wait.'};
 return {kind:'current',text:reported.minutes+' min',minutes:reported.minutes,raw,src,reason:'Recent official inspection report; not a full-trip ETA.'};
}
function sortIds(){
 if(store.sort==='fixed')return [...IDS];
 const dir=store.sort;
 return [...IDS].sort((a,b)=>{
   const x=classify(a,dir),y=classify(b,dir);
   const good=z=>z.kind==='current';
   if(good(x)!==good(y))return good(x)?-1:1;
   if(good(x)&&x.minutes!==y.minutes)return x.minutes-y.minutes;
   return IDS.indexOf(a)-IDS.indexOf(b);
 });
}
function cell(id,dir){
 const v=classify(id,dir);
 const sourceAge=v.raw?.observation_at&&Number.isFinite(age(v.raw.observation_at))?Math.round(age(v.raw.observation_at)):null;
 // The operator's count is independent of the unpublished CBSA NEXUS wait.
 // Do not show it for other crossings, vehicles, lanes, or an official port closure.
 const dwt=id==='tunnel'&&dir==='ca'&&v.kind==='unpublished'
   ?D.dwtNexusLane?.(store.data,id,dir,store.vehicle,store.lane,Date.now()):null;
 const operatorCurrent=dwt?.kind==='current'||dwt?.kind==='reported_zero';
 const laneCount=operatorCurrent
   ?'<span class="lanes">'+dwt.count+' '+(dwt.count===1?'lane':'lanes')+' · DWT</span>'
   :v.kind==='current'&&dir==='us'&&Number.isInteger(v.raw?.lanes_open)&&v.raw.lanes_open>=0
    ?'<span class="lanes">'+v.raw.lanes_open+' '+(v.raw.lanes_open===1?'lane':'lanes')+'</span>':'';
 const sub=v.kind==='stale'?'Old report'+(sourceAge!==null?' · '+sourceAge+'m':''):
   v.kind==='closed'?'Source-reported closure':v.kind==='unsupported'?'Not applicable':
   v.kind==='unpublished'?(operatorCurrent?'Wait not published':'Not published'):v.kind==='unavailable'?'Unavailable':null;
 const operatorLabel=operatorCurrent?', DWT reports '+dwt.count+' NEXUS '+(dwt.count===1?'lane':'lanes')+' open':'';
 const category=store.vehicle+' '+(store.lane==='regular'?'Regular':store.lane.toUpperCase());
 const label=NAMES[id]+', to '+(dir==='ca'?'Canada':'USA')+', '+category+', '+(dir==='ca'?'CBSA':'CBP')+' inspection report: '+v.text+', '+(sub||'recent report')+operatorLabel+'. Open details.';
 const visual=Number.isInteger(v.minutes)&&['current','stale'].includes(v.kind)
   ?'<span class="wait-number">'+escape(v.minutes)+'</span><span class="wait-unit"> min</span>'
   :escape(v.text);
 return '<div class="wait-wrap" role="cell"><button class="wait-cell" type="button" data-crossing="'+id+'" data-direction="'+dir+'" aria-label="'+escape(label)+'"><span class="wait-value" data-kind="'+v.kind+'">'+visual+'</span>'+laneCount+(sub?'<span class="cell-note">'+escape(sub)+'</span>':'')+'</button></div>';
}
/* Selected D2-07: show all material agency notices without a permanent Alerts tab.
 * This uses recent source retrieval + snapshot timestamps, not an invented
 * agency observation time. Notice wording must remain "source reports".
 * NEXUS schedule countdown thresholds remain Proposed and are not enabled.
 */
function collectNotices(data,now=Date.now()){
 if(!data||D.age(data.generated_at,now)>20)return [];
 const notices=[];
 for(const id of IDS)for(const dir of ['ca','us']){
  const agency=dir==='ca'?'CBSA':'CBP',src=data.sources?.[dir==='ca'?'cbsa':'cbp'];
  const port=data.directions?.[dir]?.[id];
  if(!port||src?.status!=='ok'||D.age(src.retrieved_at,now)>20)continue;
  const prefix=NAMES[id]+' · '+(dir==='ca'?'Canada':'USA');
  if(/^\s*(temporarily\s+)?closed\b/i.test(port.port_status||'')){
   notices.push({id,dir,type:'closure',priority:0,
    text:prefix+' · '+agency+' reports port closed'});
  }else if(D.noticeKind(port.notice)==='operational'){
   notices.push({id,dir,type:'advisory',priority:1,
    text:prefix+' · '+agency+' operational advisory'});
  }
 }
 notices.sort((a,b)=>a.priority-b.priority||
  IDS.indexOf(a.id)-IDS.indexOf(b.id)||
  (a.dir===b.dir?0:a.dir==='ca'?-1:1));
 return notices;
}
function renderNotices(){
 const all=collectNotices(store.data);
 const first=all[0]||null;
 $('notices').hidden=!first;
 if(!first){
  store.noticesExpanded=false;
  $('noticeText').textContent='';
  $('noticesMore').hidden=true;
  $('noticesList').hidden=true;
  $('noticesList').innerHTML='';
  return;
 }
 $('noticeText').textContent=first.text;
 $('noticeOpen').dataset.crossing=first.id;
 $('noticeOpen').dataset.direction=first.dir;
 const remaining=all.slice(1);
 const more=$('noticesMore');
 more.hidden=!remaining.length;
 more.textContent=(store.noticesExpanded?'Hide':'Show')+' '+remaining.length+' more '+(remaining.length===1?'notice':'notices');
 more.setAttribute('aria-expanded',String(store.noticesExpanded&&!!remaining.length));
 $('noticesList').hidden=!store.noticesExpanded||!remaining.length;
 $('noticesList').innerHTML=remaining.length&&store.noticesExpanded?
  remaining.map(n=>'<button type="button" class="notice-list-button" data-crossing="'+n.id+
   '" data-direction="'+n.dir+'">'+escape(n.text)+' <span aria-hidden="true">›</span></button>').join('')
  :'';
}
function render(){
 $('caHeading').innerHTML='<span class="country-flag" aria-hidden="true">🇨🇦</span><span>To Canada</span>'+(store.sort==='ca'?' <span class="sort-arrow" aria-hidden="true">↓</span>':'');
 $('usHeading').innerHTML='<span class="country-flag" aria-hidden="true">🇺🇸</span><span>To USA</span>'+(store.sort==='us'?' <span class="sort-arrow" aria-hidden="true">↓</span>':'');
 $('sortToggle').setAttribute('aria-label','Sort crossings; current order: '+({fixed:'crossing order',ca:'lowest Canada wait',us:'lowest USA wait'}[store.sort]));
 document.querySelectorAll('[data-sort]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.sort===store.sort)));
 $('crossingRows').innerHTML=sortIds().map(id=>'<div class="crossing-row" role="row"><span class="crossing-name" role="rowheader" aria-label="'+escape(NAMES[id])+'">'+escape(SHORT_NAMES[id])+'</span>'+cell(id,'ca')+cell(id,'us')+'</div>').join('');
 const s=store.data?.sources||{},snap=age(store.data?.generated_at);
 const sourceRecent=!!store.data&&snap<=20&&['cbp','cbsa'].every(k=>s[k]?.status==='ok'&&age(s[k].retrieved_at)<=20);
 const readings=IDS.flatMap(id=>['ca','us'].map(dir=>classify(id,dir)));
 const historicalCount=readings.filter(v=>v.kind==='stale').length;
 const missingCount=readings.filter(v=>v.kind==='unavailable').length;
 const exceptions=readings.some(v=>['stale','closed','unavailable'].includes(v.kind));
 const healthy=sourceRecent&&!exceptions&&!store.error;
 const noData=!store.data||!Number.isFinite(snap);
 $('statusDot').dataset.state=healthy?'ok':noData?'error':'warn';
 const ageLabel=(key,name)=>{
  const src=s[key],last=src?.status==='ok'?src?.retrieved_at:src?.last_success_at;
  const minutes=age(last);
  if(src?.status!=='ok')return name+' unavailable'+(Number.isFinite(minutes)?' (last success '+Math.round(minutes)+'m ago)':'');
  return Number.isFinite(minutes)?name+' checked '+Math.round(minutes)+'m ago':name+' check age unavailable';
 };
 const freshness=ageLabel('cbsa','CBSA')+' · '+ageLabel('cbp','CBP')+
   (snap>20?' · Snapshot overdue':'')+
   (historicalCount?' · '+historicalCount+' older '+(historicalCount===1?'report':'reports'):'')+
   (missingCount?' · '+missingCount+' unavailable':'');
 $('summary').textContent=store.error?freshness+' · '+store.error:freshness;
 $('sourceDetails').setAttribute('aria-label','Official source freshness: '+freshness+'. Open diagnostics');
 renderNotices();

 renderDiagnostics();
 if($('detailDialog').open&&store.selected)renderDetail();
}
function renderDiagnostics(){
 const s=store.data?.sources||{};
 $('diagnosticBody').innerHTML='<p>Snapshot published: '+escape(stamp(store.data?.generated_at))+'</p><p>Browser retrieved: '+escape(stamp(store.lastFetch))+'</p>'+Object.entries(s).map(([k,v])=>'<p><strong>'+escape(k.toUpperCase())+'</strong>: '+escape(v.status||'unknown')+' · retrieval '+escape(stamp(v.retrieved_at))+' · last success '+escape(stamp(v.last_success_at||v.retrieved_at))+(v.cache_reused?' · cached':'')+'</p>').join('')+'<p>Source retrieval does not establish observation freshness. Missing data is never zero.</p>';
}

function renderDetail(){
 const id=store.selected,dir=store.direction,v=classify(id,dir);
 $('detailTitle').textContent=NAMES[id];
 $('detailCa').setAttribute('aria-pressed',String(dir==='ca'));
 $('detailUs').setAttribute('aria-pressed',String(dir==='us'));
 $('detailCategory').textContent=(store.vehicle==='passenger'?'Passenger':'Commercial')+' · '+categories[store.vehicle].find(x=>x[0]===store.lane)[1]+' · Into '+(dir==='ca'?'Canada':'USA');
 $('detailWait').textContent=v.text;
 $('detailWait').dataset.kind=v.kind;
 $('detailNote').textContent=v.reason;
 const p=store.data?.directions?.[dir]?.[id];
 const freshNotice=v.src?.status==='ok'&&age(v.src.retrieved_at)<=20&&age(store.data?.generated_at)<=20;
 const alerts=[];
 if(freshNotice&&/^\s*(temporarily\s+)?closed\b/i.test(p?.port_status||''))alerts.push('Official port status: '+p.port_status);
 if(freshNotice&&D.noticeKind(p?.notice)==='operational')alerts.push('Official advisory: '+p.notice);
 $('detailAlert').hidden=!alerts.length;
 $('detailAlert').textContent=alerts.join(' · ');
 $('detailProvenance').innerHTML='<p>Official source: '+escape(dir==='ca'?'CBSA':'CBP')+'</p><p>Source status: '+escape(v.src?.status||'unavailable')+'</p><p>Observation: '+escape(stamp(v.raw?.observation_at))+'</p><p>Retrieved: '+escape(stamp(v.src?.retrieved_at))+'</p><p>Snapshot published: '+escape(stamp(store.data?.generated_at))+'</p>';
 const sched=dir==='ca'&&store.vehicle==='passenger'&&store.lane==='nexus'&&D.nextNexusSchedule?D.nextNexusSchedule(store.data,id,'ca',Date.now()):null;
 $('detailSchedule').hidden=!sched;
 if(sched){
  const event=sched.event==='closes'?'scheduled closing':sched.event==='opens'?'scheduled opening':'next transition';
  const description=sched.kind==='unknown'
   ?'Canada-bound NEXUS hours are unavailable or ambiguous in the published CBSA schedule.'
   :'CBSA published Canada-bound NEXUS hours: '+(sched.kind==='within'?'within a possible service window':'outside published service windows')+
     (sched.next?' · next '+event+' '+sched.next+'.':'.');
  $('detailSchedule').textContent=description+' Published hours are not proof of live lane operation; exceptions may apply.';
 }
 const operator=D.dwtNexusLane?.(store.data,id,dir,store.vehicle,store.lane,Date.now());
 const operatorSection=$('detailDwt');
 operatorSection.hidden=!(id==='tunnel'&&dir==='ca'&&store.vehicle==='passenger'&&store.lane==='nexus');
 if(!operatorSection.hidden){
  const current=operator?.kind==='current'||operator?.kind==='reported_zero';
  const lead=current
   ?'DWT reports '+operator.count+' NEXUS '+(operator.count===1?'lane':'lanes')+
    ' open (operator-reported). This count is not a NEXUS inspection wait.'
   :'Current DWT NEXUS lane count unavailable. '+(operator?.reason||'No valid report.');
  $('detailDwtReport').textContent=lead+
   ' DWT observed: '+stamp(operator?.observationAt)+
   ' · DWT retrieved: '+stamp(operator?.retrievedAt)+
   ' · Nexus snapshot published: '+stamp(operator?.snapshotAt)+
   '. CBSA general passenger waits are separate; no Canada-bound NEXUS inspection wait is published by the current CBSA source.';
 }
 $('cameraViewer').href='./classic-board.html';
}
function openDetail(id,dir='ca'){
 store.openedFrom={id,dir};
 store.selected=id;store.direction=dir;renderDetail();
 $('detailDialog').showModal();$('detailTitle').focus();
}
function closeDialog(id){
 $(id).close();
 if(id==='detailDialog'&&store.openedFrom){
  const {id:crossing,dir}=store.openedFrom;
  $('crossingRows').querySelector('button[data-crossing="'+crossing+'"][data-direction="'+dir+'"]')?.focus();
 }
 if(id==='settingsDialog')store.settingsTrigger?.focus?.();
}
function updateLanes(){
 const sel=$('laneSelect'),allowed=categories[store.vehicle];
 sel.innerHTML=allowed.map(([k,label])=>'<option value="'+k+'">'+label+'</option>').join('');
 if(!allowed.some(x=>x[0]===store.lane))store.lane='regular';
 sel.value=store.lane;
}
async function refresh(){
 if(store.busy)return;store.busy=true;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),13000);
 try{
  const res=await fetch('./data/live.json?ts='+Date.now(),{cache:'no-store',signal:controller.signal});
  if(!res.ok)throw Error('HTTP '+res.status);
  const next=await res.json();
  if(!['nexus-live-v2','nexus-live-v1'].includes(next.schema)||!next.sources||!next.directions||!Number.isFinite(Date.parse(next.generated_at)))throw Error('Invalid published snapshot');
  if(!store.data||Date.parse(next.generated_at)>=Date.parse(store.data.generated_at))store.data=next;
  store.lastFetch=new Date().toISOString();store.error=null;
 }catch(e){store.error=e.name==='AbortError'?'Request timed out':'Snapshot fetch failed';}
 finally{clearTimeout(timer);store.busy=false;render();}
}

function syncLargeText(){
 if(!Number.isFinite(window.innerWidth)||typeof getComputedStyle!=='function')return;
 const rootSize=parseFloat(getComputedStyle(document.documentElement).fontSize)||16;
 document.documentElement.dataset.largeText=window.innerWidth/rootSize<17?'true':'false';
}


function init(){
 syncLargeText();
 window.addEventListener('resize',syncLargeText);
 updateLanes();
 try{const t=localStorage.getItem('nexus-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch{}
 $('themeToggle').setAttribute('aria-label','Switch to '+((document.documentElement.dataset.theme||(window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light'))==='dark'?'light':'dark')+' mode');
 $('themeToggle').addEventListener('click',()=>{
  const active=document.documentElement.dataset.theme||(window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light');
  const next=active==='dark'?'light':'dark';
  document.documentElement.dataset.theme=next;
  try{localStorage.setItem('nexus-theme',next)}catch{}
  $('themeToggle').setAttribute('aria-label','Switch to '+(next==='dark'?'light':'dark')+' mode');
 });
 $('sortToggle').addEventListener('click',()=>{$('sortMenu').hidden=!$('sortMenu').hidden;$('sortToggle').setAttribute('aria-expanded',String(!$('sortMenu').hidden))});
 $('sortMenu').addEventListener('click',e=>{
  const b=e.target.closest('[data-sort]');if(!b)return;
  store.sort=b.dataset.sort;try{localStorage.setItem(key,store.sort)}catch{}
  $('sortMenu').hidden=true;$('sortToggle').setAttribute('aria-expanded','false');render();
 });
 $('vehicleSelect').addEventListener('change',e=>{store.vehicle=e.target.value;store.lane='regular';updateLanes();render()});
 $('laneSelect').addEventListener('change',e=>{store.lane=e.target.value;render()});
 $('crossingRows').addEventListener('click',e=>{const b=e.target.closest('[data-crossing]');if(b)openDetail(b.dataset.crossing,b.dataset.direction||'ca')});
 $('noticeOpen').addEventListener('click',e=>{const {crossing:id,direction:dir}=e.currentTarget.dataset;if(id)openDetail(id,dir||'ca')});
 $('noticesMore').addEventListener('click',()=>{store.noticesExpanded=!store.noticesExpanded;renderNotices()});
 $('noticesList').addEventListener('click',e=>{const b=e.target.closest('button[data-crossing][data-direction]');if(b)openDetail(b.dataset.crossing,b.dataset.direction)});
 $('sourceDetails').addEventListener('click',e=>{store.settingsTrigger=e.currentTarget;$('settingsDialog').showModal();$('settingsTitle').focus()});
 $('settingsOpen').addEventListener('click',e=>{store.settingsTrigger=e.currentTarget;$('settingsDialog').showModal();$('settingsTitle').focus()});
 $('detailClose').addEventListener('click',()=>closeDialog('detailDialog'));
 $('settingsClose').addEventListener('click',()=>closeDialog('settingsDialog'));
 $('detailCa').addEventListener('click',()=>{store.direction='ca';renderDetail()});
 $('detailUs').addEventListener('click',()=>{store.direction='us';renderDetail()});
 $('resetSort').addEventListener('click',()=>{store.sort='fixed';try{localStorage.removeItem(key)}catch{}render()});
 $('refresh').addEventListener('click',refresh);
 document.addEventListener('click',e=>{if(!e.target.closest('.sort-wrap')){$('sortMenu').hidden=true;$('sortToggle').setAttribute('aria-expanded','false')}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('sortMenu').hidden=true;$('sortToggle').setAttribute('aria-expanded','false')}});
 render();refresh();
 setInterval(()=>{if(!document.hidden)refresh()},60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
 setInterval(()=>{if(!document.hidden)render()},60000);
}
init();
})();