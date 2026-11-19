'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const js=fs.readFileSync('board.js','utf8');
const css=fs.readFileSync('board.css','utf8');
const workflow=fs.readFileSync('.github/workflows/publish.yml','utf8');
new vm.Script(js);
for(const id of ['intoUs','intoCa','crossingRows','statusDot','summary','diagnosticBody','cameraDialog','cameraFrame','closeCamera','cameraRetry'])
 assert.ok(html.includes('id="'+id+'"'), 'missing '+id);
assert.ok(html.includes('Into USA')&&html.includes('Into Canada'));
assert.ok(!html.includes('Destination preset')&&!html.includes('Preview route')&&!html.includes('PREFERRED CROSSING'));
assert.ok(!html.includes('tripSelect')&&!html.includes('navigateButton'));
assert.ok(js.includes("const IDS=['ambassador','tunnel','gordie'];"));
assert.ok(js.includes("id==='gordie'?'disabled'"),'Gordie Howe camera must be disabled');
assert.ok(js.includes("if(id==='gordie'||!CAMERAS[id])return;"),'Gordie Howe must not load camera');
assert.ok(js.includes("direction==='ca'&&category==='nexus'"),'Canada NEXUS waits unavailable');
assert.ok(js.includes("fetch('./data/live.json?ts='"),'must use published snapshot');
assert.ok(js.includes("'nexus-live-v2'"),'must accept collector schema');
assert.ok(js.includes("source()?.retrieved_at"),'must check source retrieval age');
assert.ok(js.includes("D.reading(raw,data,Date.now())"),'must retain source-age classification');
assert.ok(js.includes("Count")===false||js.includes("lanes"),'lane counts should be on board');
assert.ok(js.includes("Number.isInteger(raw?.lanes_open)"),'do not fabricate missing lanes');
assert.ok(js.includes("if(raw.status==='closed')")||js.includes("raw.status==='closed'"),'explicit closure status');
assert.ok(js.includes('lastFetch')&&js.includes('renderDiagnostics()'));
assert.ok(js.includes('removeAttribute(\'src\')'),'camera must unload on close');
assert.ok(css.includes('grid-template-columns')&&css.includes('@media (max-width: 720px)'));
assert.ok(html.includes('board.js?v=board4')&&html.includes('board.css?v=board4'));
assert.ok(workflow.includes('cp board.css board.js legacy.html site/'), 'board and legacy page must be published');
assert.ok(workflow.includes('cp index.html styles.css app.js decision.js camera-diagnostics.html site/'), 'original camera scripts must remain deployed');
console.log('Border-status board static checks passed: direction, three rows, lanes, unavailable semantics, cameras, deployment.');


// Exercise the real data formatter using the existing production decision module.
// Only synthetic data are used; no network or official source is contacted.
const D=require('../decision.js');
const nodes=new Map();
function node(id) {
  if(!nodes.has(id))nodes.set(id,{
    id, dataset:{},textContent:'',innerHTML:'',
    addEventListener(){},setAttribute(){},
    querySelectorAll(){return []},removeAttribute(){},showModal(){},close(){}
  });
  return nodes.get(id);
}
const document={
  hidden:false,
  getElementById:node,
  addEventListener(){}
};
const sandbox={
  document,
  window:{NexusDecision:D,addEventListener(){}},
  localStorage:{getItem(){return null},setItem(){}},
  AbortController,
  requestAnimationFrame(){},
  setInterval(){},
  setTimeout(){return 0},
  clearTimeout(){},
  fetch(){return new Promise(()=>{})},
  Intl,Date,Number,Math,Error,Promise
};
const instrumented=js.replace("  render();refresh();",
  "  window.__boardTest={entry,render,setData:(x)=>{data=x;busy=false;loadError='';},setDirection:(x)=>{direction=x;render();}};\n  render();refresh();");
assert.notEqual(instrumented,js,'missing board entry point');
vm.runInNewContext(instrumented,sandbox,{filename:'board.js'});
const api=sandbox.window.__boardTest;
const stamp=mins=>new Date(Date.now()-mins*60000).toISOString();
const lane=(minutes,age,count=2)=>({status:'reported',minutes,observation_at:stamp(age),lanes_open:count});
const payload=()=>({
  schema:'nexus-live-v2',generated_at:stamp(0),
  sources:{cbp:{status:'ok',retrieved_at:stamp(0)},cbsa:{status:'ok',retrieved_at:stamp(0)}},
  directions:{
    us:{
      ambassador:{standard:lane(0,5),nexus:lane(7,6,1)},
      tunnel:{standard:lane(10,8),nexus:lane(4,9,1)},
      gordie:{standard:lane(0,12),nexus:lane(0,12,1)}
    },
    ca:{ambassador:{standard:lane(0,8)},tunnel:{standard:lane(3,5)},gordie:{standard:lane(2,9)}}
  }
});
let data=payload();
api.setData(data);
api.render();
let zero=api.entry(data.directions.us.ambassador.standard,'regular');
assert.equal(zero.display,'No Delay','fresh official zero means No Delay');
assert.equal(zero.unit,'','No Delay must not append min');
assert.equal(zero.lanes,'2 lanes reported');
const ui=node('crossingRows').innerHTML;
assert.equal((ui.match(/class="crossing-row"/g)||[]).length,3,'exactly 3 crossing cards');
assert.equal((ui.match(/class="reading-main"/g)||[]).length,6,'exactly 2 waits per crossing');
assert.ok(ui.includes('No Delay'),'No Delay visible on board');
assert.ok(!ui.includes('Updated 5m ago'),'routine timestamps should not clutter the main board');
assert.ok(!ui.includes('CBP · Last report'),'duplicate per-row retrieval status was removed');
assert.ok(html.includes('id="aboutReadings"'),'general caveats belong in progressive disclosure');
assert.ok(html.includes('Technical diagnostics'));
assert.ok(!html.includes('board-footer'),'remove redundant persistent legend');
assert.equal((ui.match(/data-camera="gordie"/g)||[]).length,1);
assert.ok(/data-camera="gordie"[^>]*disabled/.test(ui),'GH camera disabled');

// Do not promote a historical observation even if the latest JSON was just published.
let old=api.entry(lane(0,21,2),'regular');
assert.equal(old.display,'—','old zero is not No Delay');
assert.match(old.status,/^Last update /,'historical report must show agency clock');
assert.equal(old.historical,true);
assert.match(old.lanes,/last reported/);
api.render();
assert.match(node('crossingRows').innerHTML,/No Delay/,'other fresh readings stay visible');
assert.equal(api.entry(lane(6,20,2),'regular').display,'—','20-minute boundary is not current');
assert.equal(api.entry(lane(6,19,2),'regular').display,'6','19-minute observation still visible');

// Source retrieval and site publication must ALSO be recent.
data.sources.cbp.retrieved_at=stamp(25);api.setData(data);
assert.equal(api.entry(lane(6,1),'regular').display,'—','overdue source cannot display current wait');
data.sources.cbp.retrieved_at=stamp(0);
data.generated_at=stamp(25);api.setData(data);
assert.equal(api.entry(lane(6,1),'regular').display,'—','overdue snapshot cannot display current wait');
data.generated_at=stamp(0);
data.sources.cbp.status='error';api.setData(data);
assert.equal(api.entry(lane(6,1),'regular').display,'—','failed source cannot display live wait');
data.sources.cbp.status='ok';api.setData(data);

// CBP closed is only current when dated and fresh; absent timestamps are not proof.
const closure={status:'closed',observation_at:stamp(6),lanes_open:null};
assert.equal(api.entry(closure,'nexus').display,'Closed');
assert.equal(api.entry({...closure,observation_at:stamp(30)},'nexus').display,'—');
assert.equal(api.entry({...closure,observation_at:null},'nexus').display,'—');

// Canada-bound NEXUS is not supplied; do not borrow Tunnel operator counts.
api.setDirection('ca');
let caNexus=api.entry(lane(0,1,3),'nexus');
assert.equal(caNexus.display,'—');
assert.equal(caNexus.lanes,'Lanes not reported');
const caUi=node('crossingRows').innerHTML;
assert.ok(caUi.includes('Not reported by CBSA'));

// Undated or stale closure stays visible as a caution, not a proven live closure.
api.setDirection('us');
data.directions.us.ambassador.nexus={status:'closed',lanes_open:null,observation_at:null};
api.setData(data);
const undated=api.entry(data.directions.us.ambassador.nexus,'nexus');
assert.equal(undated.display,'—','undated closure must not appear live');
assert.match(undated.status,/Closure reported.*time missing/);
api.render();
assert.match(node('crossingRows').innerHTML,/Closure reported/);
console.log('20-minute source-provenance, zero-delay, historical and 3-row UI behavior tests passed.');
