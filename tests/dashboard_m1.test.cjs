'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const D=require('../decision.js');
const html=fs.readFileSync('index.html','utf8'),css=fs.readFileSync('dashboard.css','utf8'),js=fs.readFileSync('dashboard.js','utf8');
new vm.Script(js);
for(const id of ['crossingRows','caHeading','usHeading','sortToggle','sortMenu','vehicleSelect','laneSelect','themeToggle','settingsDialog','detailDialog','detailCa','detailUs','detailProvenance','detailAlert','diagnosticBody','notices','sourceDetails'])
 assert.ok(html.includes('id="'+id+'"'),'missing dashboard control '+id);
for(const label of ['To Canada','To USA','Passenger','Commercial','Nexus <span class="brand-tail">- Commuter'])assert.ok(html.includes(label));
assert.match(html,/class="mode-pill pill-vehicle"/);
assert.match(html,/class="mode-pill pill-lane"/);
assert.match(css,/\.wait-unit/);
assert.match(html,/dashboard\.js\?v=m3-foundation1/);
assert.match(html,/dashboard\.css\?v=m3-foundation1/);
assert.match(js,/const IDS=\['ambassador','tunnel','gordie'\]/);
assert.match(js,/D\.reading\(raw,store\.data,Date\.now\(\)\)/);
assert.match(js,/good\(x\)!==good\(y\)/);
assert.match(js,/store\.sort='fixed'/);
assert.match(js,/raw\.status==='not_applicable'/);
assert.match(js,/src\?\.status!=='ok'/);
assert.match(js,/Number\.isInteger\(v\.raw\?\.lanes_open\)/);
assert.match(js,/\.showModal\(\)/);
assert.match(css,/grid-template-columns/);
assert.match(css,/@media\(max-width:360px\)/);
assert.match(css,/prefers-reduced-motion/);
assert.match(css,/data-large-text="true"/,'large text must reflow table and controls');
assert.match(js,/function syncLargeText\(\)/,'font scaling must update responsive layout');
assert.match(js,/window\.addEventListener\('resize',syncLargeText\)/,'font scaling must update on resize');
assert.match(css,/\.settings-screen\{position:fixed/);
assert.match(fs.readFileSync('.github/workflows/publish.yml','utf8'),/cp dashboard\.css dashboard\.js classic-board\.html site\//);
assert.match(fs.readFileSync('classic-board.html','utf8'),/id="cameraDialog"/);

const injected=js.replace(/\ninit\(\);\n\}\)\(\);\s*$/,"\nwindow.__m1Test={store,classify,sortIds,cell,render,openDetail};\n})();");
assert.notEqual(injected,js,'Dashboard test access injection failed');
const nodes=new Map();
const node=id=>{
 if(!nodes.has(id))nodes.set(id,{
  id,dataset:{},textContent:'',innerHTML:'',hidden:false,open:false,
  setAttribute(name,value){this[name]=value},getAttribute(name){return this[name]},
  addEventListener(){},focus(){},close(){this.open=false},showModal(){this.open=true}
 });
 return nodes.get(id);
};
const dom={
 getElementById:node,
 querySelectorAll(){return[]}
};
const context={window:{NexusDecision:D},document:dom,localStorage:{getItem(){return null}},Date,Math,Number,Intl,console};
vm.runInNewContext(injected,context,{filename:'dashboard.js'});
const api=context.window.__m1Test;
const ago=min=>new Date(Date.now()-min*60000).toISOString();
const sample=(mins,age=3,lanes=2)=>({status:'reported',minutes:mins,observation_at:ago(age),lanes_open:lanes});
const payload=()=>({
 schema:'nexus-live-v2',generated_at:ago(1),
 sources:{cbp:{status:'ok',retrieved_at:ago(1)},cbsa:{status:'ok',retrieved_at:ago(1)}},
 directions:{
  us:{ambassador:{standard:sample(0)},tunnel:{standard:sample(9)},gordie:{standard:sample(3)}},
  ca:{ambassador:{standard:sample(20)},tunnel:{standard:sample(0)},gordie:{standard:sample(6)}}
 }
});
api.store.data=payload();
assert.equal(api.classify('ambassador','us').text,'0 min','valid zero must remain 0 min');
assert.equal(api.classify('tunnel','ca').kind,'current');
assert.equal(api.classify('ambassador','ca').minutes,20);
assert.equal(api.classify('ambassador','us').kind,'current');
assert.match(api.cell('ambassador','us'),/0 min/);
assert.match(api.cell('ambassador','us'),/2 lanes/);
assert.doesNotMatch(api.cell('ambassador','ca'),/2 lanes/,'CBSA lane counts must not be inferred');
api.store.lane='nexus';
assert.equal(api.classify('ambassador','ca').kind,'unpublished','CBSA NEXUS is not reported');
assert.equal(api.classify('ambassador','ca').text,'--');
assert.equal(api.classify('ambassador','us').kind,'unavailable','no general-lane fallback for missing NEXUS');
assert.doesNotMatch(api.cell('ambassador','us'),/2 lanes/);
api.store.lane='regular';
api.store.data.directions.us.ambassador.standard={status:'not_applicable',minutes:null,observation_at:ago(1)};
assert.equal(api.classify('ambassador','us').kind,'unsupported','explicit agency not applicable only');
assert.equal(api.classify('ambassador','us').text,'N/A');
api.store.data.directions.us.ambassador.standard={status:'closed',minutes:null,observation_at:ago(1)};
assert.equal(api.classify('ambassador','us').kind,'closed');
assert.equal(api.classify('ambassador','us').text,'Closed');
api.store.data.directions.us.ambassador.standard={status:'closed',minutes:null,observation_at:ago(31)};
assert.equal(api.classify('ambassador','us').kind,'unavailable','aged closure must not remain current');
api.store.data.directions.us.ambassador.standard=sample(5,31);
assert.equal(api.classify('ambassador','us').kind,'stale');
assert.match(api.cell('ambassador','us'),/Old report/);
api.store.data.directions.us.ambassador.standard=sample(0);
api.store.sort='us';
assert.equal(api.sortIds().join(','),'ambassador,gordie,tunnel','sort by USA entire row');
api.store.sort='ca';
assert.equal(api.sortIds().join(','),'tunnel,gordie,ambassador','sort by Canada entire row');
api.store.data.directions.ca.tunnel.standard=null;
assert.equal(api.sortIds().join(','),'gordie,ambassador,tunnel','missing data sorts last');
api.store.data=payload();
api.store.data.sources.cbsa.status='error';
assert.equal(api.classify('tunnel','ca').text,'--','source outage not zero');
api.store.data=payload();
api.store.data.directions.us.ambassador.standard=sample(4,64);
api.render();
assert.equal(node('statusDot').dataset.state,'warn','recent fetch with stale observation must not show green');
assert.match(node('summary').textContent,/older report/,'footer must identify stale measurement separately from checked time');
api.store.data=payload();
api.store.data.sources.cbp.retrieved_at=ago(31);
assert.equal(api.classify('ambassador','us').kind,'stale','recent observation cannot override stale fetch');
api.store.data=payload();
api.store.error='Snapshot fetch failed';
api.render();
assert.equal(node('statusDot').dataset.state,'warn','refresh failure must not show green based on cached recent snapshot');
assert.match(node('summary').textContent,/Snapshot fetch failed/,'refresh failure should be visible');
api.store.error=null;
api.store.data.directions.ca.ambassador.port_status='Closed';
api.store.sort='fixed';
api.render();
assert.match(node('noticeText').textContent,/Ambassador Bridge.*Canada.*CBSA reports port closed/);
assert.equal(node('noticeOpen').dataset.direction,'ca','notice must preserve affected country direction');
assert.equal(api.classify('ambassador','ca').kind,'closed','recent reported full-port closure must override numeric wait');
assert.equal(node('noticesMore').hidden,true,'no more affordance for a single notice');
assert.equal((node('crossingRows').innerHTML.match(/class="crossing-row"/g)||[]).length,3);
assert.equal((node('crossingRows').innerHTML.match(/class="wait-cell"/g)||[]).length,6);
assert.match(node('crossingRows').innerHTML,/aria-label="Gordie Howe International Bridge">Gordie Howe<\/span>/,'short visible name must retain full spoken name');
assert.match(node('summary').textContent,/CBSA checked.*CBP checked/,'source summary must disclose separate source check ages');
assert.doesNotMatch(node('crossingRows').innerHTML,/data-crossing="ambassador" aria-label="Details/,'crossing title must not silently open Canada');
console.log('M1 dashboard fixture tests passed: zero, both directions, lanes, unsupported, missing, stale, closure, sort, notices.');
