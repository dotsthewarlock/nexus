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
 const laneCount=v.kind==='current'&&dir==='us'&&Number.isInteger(v.raw?.lanes_open)&&v.raw.lanes_open>=0
   ?'<span class="lanes">'+v.raw.lanes_open+' '+(v.raw.lanes_open===1?'lane':'lanes')+'</span>':'';
 const sub=v.kind==='stale'?'Old report'+(sourceAge!==null?' · '+sourceAge+'m':''):
   v.kind==='closed'?'Source-reported closure':v.kind==='unsupported'?'Not applicable':
   v.kind==='unpublished'?'Not published':v.kind==='unavailable'?'Unavailable':null;
 return '<div class="wait-wrap" role="cell"><button class="wait-cell" type="button" data-crossing="'+id+'" data-direction="'+dir+'" aria-label="'+escape(NAMES[id]+', into '+(dir==='ca'?'Canada':'USA')+', '+v.text+', '+(sub||'recent report'))+'"><span class="wait-value" data-kind="'+v.kind+'">'+escape(v.text)+'</span>'+laneCount+(sub?'<span class="cell-note">'+escape(sub)+'</span>':'')+'</button></div>';
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
 $('caHeading').textContent='Canada'+(store.sort==='ca'?' ↓':'');
 $('usHeading').textContent='USA'+(store.sort==='us'?' ↓':'');
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

/* M3a: explicit, local destination selection; never infer destination side. */
let destinationRepo=null;
const tripChoice={ca:null,us:null};
const countryName=dir=>dir==='ca'?'Canada':'USA';
function resolvedDestination(dir){
 const selected=tripChoice[dir];
 if(selected?.type==='once')return {label:'One-time',address:selected.address,country:dir,source:'one-time'};
 if(selected?.type==='saved'){
  const item=destinationRepo?.find(selected.id);
  if(item?.country===dir)return {...item,source:'selected'};
  tripChoice[dir]=null;
 }
 const configured=destinationRepo?.defaultFor(dir);
 return configured?{...configured,source:'default'}:null;
}
function renderDestinationAction(){
 const dest=resolvedDestination(store.direction);
 $('detailDestination').textContent=dest
  ?dest.label+' · '+dest.address+' · '+countryName(store.direction)+(dest.source==='default'?' (your default)':'')
  :'No destination selected for trips into '+countryName(store.direction)+'.';
 $('chooseDestination').hidden=!!dest;
 $('changeDestination').hidden=!dest;
 let route=null,error=null;
 if(dest&&window.NexusRouting){
  try{route=window.NexusRouting.prepare({
   crossing:store.selected,direction:store.direction,destination:dest,vehicle:store.vehicle
  })}catch(e){error=String(e.message||'Unable to prepare directions')}
 }
 const link=$('openDirections');
 link.hidden=!route;
 if(route){
  link.href=route.url;
  link.setAttribute('aria-label','Open Google Maps directions to '+dest.label+'. Confirm route crosses at '+NAMES[store.selected]);
 }else link.removeAttribute('href');
 $('routeNotValidated').textContent=route
  ?route.guidance+' The map ETA is separate from official inspection waits.'
  :dest
   ?(error||'Directions are unavailable. Verify your destination and try again.')
   :'Choose a destination first. Nexus will not choose a destination without your input.';
}
function openDestinationPicker(){
 const dir=store.direction,items=destinationRepo?.forCountry(dir)||[];
 $('detailMain').hidden=true;
 $('destinationPicker').hidden=false;
 $('destinationPickerHeading').textContent='Choose destination · '+countryName(dir);
 $('destinationPickerCountry').textContent='Entering '+countryName(dir)+' at '+NAMES[store.selected]+'.';
 $('destinationPickerSaved').innerHTML=items.length?items.map(item=>
  '<button type="button" data-destination-id="'+escape(item.id)+'" aria-label="Use '+escape(item.label)+' for this trip into '+countryName(dir)+'">'+
  '<strong>'+escape(item.label)+'</strong><small>'+escape(item.address)+'</small></button>').join('')
  :'<p class="detail-note">No saved destinations marked for '+countryName(dir)+'. Add one in Settings or enter a one-time place below.</p>';
 $('oneTimeAddress').value='';
 $('destinationPickerHeading').focus();
}
function returnToCrossing(){
 $('destinationPicker').hidden=true;
 $('detailMain').hidden=false;
 renderDestinationAction();
 (resolvedDestination(store.direction)?$('changeDestination'):$('chooseDestination')).focus();
}
function useSavedDestination(id){
 const item=destinationRepo?.find(id);
 if(!item||item.country!==store.direction){
  $('destinationPickerCountry').textContent='This destination is not marked for '+countryName(store.direction)+'. Choose a compatible place.';
  return;
 }
 tripChoice[store.direction]={type:'saved',id};
 returnToCrossing();
}
function useOneTimeDestination(address){
 const dir=store.direction;
 const item=window.NexusDestinations.record({id:'one-time',kind:'custom',label:'One-time',country:dir,address});
 tripChoice[dir]={type:'once',address:item.address};
 returnToCrossing();
}
function messageDestination(text){
 $('destinationMessage').textContent=text||destinationRepo?.problem()||'';
}
function renderSavedDestinations(){
 if(!destinationRepo){
  $('savedDestinations').textContent='Destination storage is currently unavailable.';
  return;
 }
 const items=destinationRepo.items();
 $('savedDestinations').innerHTML=items.length?items.map(item=>{
  const selected=destinationRepo.defaultFor(item.country)?.id===item.id;
  const country=countryName(item.country);
  const defaultAction=selected?'clear-default':'default';
  const defaultText=selected?'Clear default':'Make default for '+country;
  return '<div class="saved-destination"><strong>'+escape(item.label)+'</strong> · '+country+
   '<p>'+escape(item.address)+'</p>'+
   (selected?'<p class="is-default">Default for '+country+'</p>':'')+
   '<div class="destination-actions">'+
   '<button type="button" data-dest-action="'+defaultAction+'" data-dest-id="'+escape(item.id)+'">'+defaultText+'</button>'+
   '<button type="button" data-dest-action="edit" data-dest-id="'+escape(item.id)+'">Edit '+escape(item.label)+'</button>'+
   '<button type="button" data-dest-action="remove" data-dest-id="'+escape(item.id)+'">Remove '+escape(item.label)+'</button>'+
   '</div></div>';
 }).join(''):'<p class="detail-note">No destinations saved. Add Home, Work or a custom place below.</p>';
 if(destinationRepo.problem())messageDestination(destinationRepo.problem());
}
function syncDestinationKind(){
 const custom=$('destinationKind').value==='custom';
 $('destinationLabelRow').hidden=!custom;
 $('destinationLabel').required=custom;
}
function resetDestinationForm(){
 $('destinationEditingId').value='';
 const kinds=['home','work','custom'];
 const used=new Set(destinationRepo?.items().map(x=>x.kind)||[]);
 $('destinationKind').value=kinds.find(k=>k==='custom'||!used.has(k))||'custom';
 $('destinationCountry').value='ca';
 $('destinationAddress').value='';
 $('destinationLabel').value='';
 $('destinationSave').textContent='Save destination';
 $('destinationCancel').hidden=true;
 syncDestinationKind();
}
function editDestination(id){
 const item=destinationRepo?.find(id);if(!item)return;
 $('destinationEditingId').value=item.id;
 $('destinationKind').value=item.kind;
 $('destinationCountry').value=item.country;
 $('destinationAddress').value=item.address;
 $('destinationLabel').value=item.kind==='custom'?item.label:'';
 $('destinationSave').textContent='Update destination';
 $('destinationCancel').hidden=false;
 syncDestinationKind();
 $('destinationAddress').focus();
}
function saveDestinationForm(event){
 event.preventDefault();
 if(!destinationRepo)return;
 const editing=$('destinationEditingId').value||null;
 try{
  const change=destinationRepo.upsert({
   kind:$('destinationKind').value,label:$('destinationLabel').value,
   country:$('destinationCountry').value,address:$('destinationAddress').value
  },editing);
  resetDestinationForm();
  renderSavedDestinations();
  messageDestination(change.persisted?change.item.label+' saved locally.':'Storage unavailable: destination is available only until this page closes.');
  if($('detailDialog').open)renderDestinationAction();
 }catch(error){messageDestination(error.message||'Unable to save destination');}
}
function savedDestinationAction(event){
 const button=event.target.closest('button[data-dest-action]');if(!button||!destinationRepo)return;
 const id=button.dataset.destId,item=destinationRepo.find(id);if(!item)return;
 try{
  const action=button.dataset.destAction;
  if(action==='edit'){editDestination(id);return}
  if(action==='remove'){
   destinationRepo.remove(id);
   if($('destinationEditingId').value===id)resetDestinationForm();
   for(const dir of ['ca','us'])if(tripChoice[dir]?.id===id)tripChoice[dir]=null;
   messageDestination(item.label+' removed.');
  }else if(action==='default'){
   destinationRepo.setDefault(item.country,id);
   messageDestination('Default for '+countryName(item.country)+' updated.');
  }else if(action==='clear-default'){
   destinationRepo.setDefault(item.country,null);
   messageDestination('Default for '+countryName(item.country)+' cleared.');
  }
  renderSavedDestinations();
  if(destinationRepo.problem())messageDestination(destinationRepo.problem());
  if($('detailDialog').open)renderDestinationAction();
 }catch(error){messageDestination(error.message||'Unable to update destination');}
}
function initDestinations(){
 let browserStorage=null;
 try{browserStorage=localStorage}catch{} // Storage access can throw in restricted browsing contexts.
 destinationRepo=window.NexusDestinations?.createStore?.(browserStorage)||null;
 resetDestinationForm();
 renderSavedDestinations();
 $('destinationKind').addEventListener('change',syncDestinationKind);
 $('destinationForm').addEventListener('submit',saveDestinationForm);
 $('destinationCancel').addEventListener('click',()=>{resetDestinationForm();messageDestination('Edit canceled.')});
 $('savedDestinations').addEventListener('click',savedDestinationAction);
 $('removeAllDestinations').addEventListener('click',()=>{$('removeAllConfirm').hidden=false;$('confirmRemoveAll').focus()});
 $('cancelRemoveAll').addEventListener('click',()=>{$('removeAllConfirm').hidden=true;$('removeAllDestinations').focus()});
 $('confirmRemoveAll').addEventListener('click',()=>{
  if(!destinationRepo)return;
  const persisted=destinationRepo.clear();
  for(const dir of ['ca','us'])if(tripChoice[dir]?.type==='saved')tripChoice[dir]=null;
  $('removeAllConfirm').hidden=true;
  resetDestinationForm();renderSavedDestinations();
  messageDestination(persisted?'All saved destinations and defaults removed.':'Destination storage unavailable; changes are not permanent.');
  $('removeAllDestinations').focus();
 });
 $('chooseDestination').addEventListener('click',openDestinationPicker);
 $('changeDestination').addEventListener('click',openDestinationPicker);
 $('destinationPickerSaved').addEventListener('click',event=>{
  const button=event.target.closest('button[data-destination-id]');
  if(button)useSavedDestination(button.dataset.destinationId);
 });
 $('oneTimeDestinationForm').addEventListener('submit',event=>{
  event.preventDefault();
  try{useOneTimeDestination($('oneTimeAddress').value)}
  catch(error){$('destinationPickerCountry').textContent=error.message||'Enter a valid one-time destination'}
 });
 $('destinationPickerBack').addEventListener('click',returnToCrossing);
 $('openDestinationSettings').addEventListener('click',()=>{
  $('detailDialog').close();store.settingsTrigger=$('settingsOpen');
  $('detailMain').hidden=false;$('destinationPicker').hidden=true;
  $('settingsDialog').showModal();
  $('settingsDestinationTitle').scrollIntoView?.({block:'start'});
  $('destinationKind').focus();
 });
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
 $('cameraViewer').href='./classic-board.html';
 renderDestinationAction();
}
function openDetail(id,dir='ca'){
 $('destinationPicker').hidden=true;$('detailMain').hidden=false;
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
 initDestinations();
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