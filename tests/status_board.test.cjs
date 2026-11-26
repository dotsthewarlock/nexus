'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync('classic-board.html','utf8');
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
assert.ok(js.includes("D.classifyReading(data,port,direction"),'must use shared source-age classification');
assert.ok(js.includes("Count")===false||js.includes("lanes"),'lane counts should be on board');
assert.ok(js.includes("v.count===null"),'do not fabricate missing lanes');
assert.ok(js.includes("v.kind==='closure_unverified'"),'explicit closure status');
assert.ok(js.includes('lastFetch')&&js.includes('renderDiagnostics()'));
assert.ok(js.includes('removeAttribute(\'src\')'),'camera must unload on close');
assert.ok(css.includes('grid-template-columns')&&css.includes('@media (max-width: 720px)'));
assert.ok(html.includes('board.js?v=r2-v08-1')&&html.includes('board.css?v=board7'));
assert.ok(!html.includes('cameraNexusWait">—')&&!html.includes('cameraRegularWait">—'));
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
  "  window.__boardTest={entry,render,scheduleMoment,setData:(x)=>{data=x;busy=false;loadError='';},setDirection:(x)=>{direction=x;render();}};\n  render();refresh();");
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
assert.equal(zero.display,'0','fresh official zero remains numeric');
assert.equal(zero.unit,'min','official zero retains minutes');
assert.equal(zero.lanes,'2 lanes reported');
const ui=node('crossingRows').innerHTML;
assert.equal((ui.match(/class="crossing-row"/g)||[]).length,3,'exactly 3 crossing cards');
assert.equal((ui.match(/class="reading-main"/g)||[]).length,6,'exactly 2 waits per crossing');
assert.ok(ui.includes('>0 <small>min</small>'),'Numeric zero visible on board');
assert.ok(!ui.includes('class="reading-hint" data-state="current">Updated 5m ago'),'routine observation age should not take a separate visible line');
assert.ok(!ui.includes('CBP · Last report'),'duplicate per-row retrieval status was removed');
assert.ok(html.includes('id="aboutReadings"'),'general caveats belong in progressive disclosure');
assert.ok(html.includes('Technical diagnostics'));
assert.ok(!html.includes('board-footer'),'remove redundant persistent legend');
assert.equal((ui.match(/data-camera="gordie"/g)||[]).length,1);
assert.ok(/data-camera="gordie"[^>]*disabled/.test(ui),'GH camera disabled');

// 20-minute boundary means historical, not a broken-looking placeholder.
let old=api.entry(lane(0,21,2),'regular');
assert.equal(old.display,'0','historic zero remains numeric but is no longer No Delay');
assert.equal(old.unit,'min');
assert.match(old.status,/^Reported 21m ago/);
assert.equal(old.historical,true);
assert.equal(old.lanes,'Lanes not reported');
assert.equal(api.entry(lane(6,20,2),'regular').display,'6','Exact 20m covered by deterministic model fixture');
assert.equal(api.entry(lane(6,19,2),'regular').display,'6','19-minute observation remains current');
assert.equal(api.entry(lane(6,19,2),'regular').historical,false);
api.render();
assert.match(node('crossingRows').innerHTML,/>0 <small>min<\/small>/);

// A source/snapshot check older than 20 minutes cannot upgrade an observation.
// Valid last-known reports remain marked as historical until expiry.
data.sources.cbp.retrieved_at=stamp(25);api.setData(data);
let olderFetch=api.entry(lane(6,1),'regular');
assert.equal(olderFetch.display,'6');
assert.equal(olderFetch.historical,true);
data.sources.cbp.retrieved_at=stamp(0);
data.generated_at=stamp(25);api.setData(data);
assert.equal(api.entry(lane(6,1),'regular').display,'6','older snapshot becomes historical');
assert.equal(api.entry(lane(6,1),'regular').historical,true);
data.generated_at=stamp(0);

// Errors without retained-last-success provenance cannot display numeric waits.
data.sources.cbp.status='error';api.setData(data);
assert.equal(api.entry(lane(6,1),'regular').display,'Unavailable');
data.sources.cbp.status='error';
data.sources.cbp.retained_previous=true;
data.sources.cbp.last_success_at=stamp(25);api.setData(data);
const retained=api.entry(lane(6,1),'regular');
assert.equal(retained.display,'6');
assert.equal(retained.historical,true);
data.sources.cbp.status='ok';delete data.sources.cbp.retained_previous;
delete data.sources.cbp.last_success_at;api.setData(data);

// Live closure is distinct from a historical / undated closure.
const closure={status:'closed',observation_at:stamp(6),lanes_open:null};
assert.equal(api.entry(closure,'nexus').display,'Closed');
assert.equal(api.entry({...closure,observation_at:stamp(30)},'nexus').display,'Closure unverified');
assert.equal(api.entry({...closure,observation_at:null},'nexus').display,'Closure unverified');

// Canada-bound NEXUS wait/count are unsupported, not broken or accidentally zero.
api.setDirection('ca');
const caNexus=api.entry(lane(0,1,3),'nexus');
assert.equal(caNexus.display,'Hours unverified');
assert.equal(caNexus.lanes,'Lanes not verified');
assert.ok(node('crossingRows').innerHTML.includes('Hours unverified'));
api.setDirection('us');

// Undated source values and fully expired reports must never show numbers.
data.directions.us.ambassador.nexus={status:'closed',lanes_open:null,observation_at:null};
api.setData(data);
assert.equal(api.entry(data.directions.us.ambassador.nexus,'nexus').display,'Closure unverified');
assert.match(api.entry(data.directions.us.ambassador.nexus,'nexus').status,/Report time unknown/);
data.directions.us.ambassador.standard=lane(0,26,2);
api.setData(data);api.render();
assert.doesNotMatch(node('crossingRows').innerHTML,/lanes (last report)/);
assert.match(node('crossingRows').innerHTML,/Reported 26m ago/);
assert.doesNotMatch(node('crossingRows').innerHTML,/>—</,'never render dash placeholders');
const expired=api.entry(lane(5,125,2),'regular');
assert.equal(expired.display,'Unavailable');
assert.match(expired.status,/Last report/);
assert.equal(expired.lanes,'Lanes not reported');
assert.equal(api.entry({status:'reported',minutes:8,lanes_open:2},'regular').display,'Unavailable');
assert.equal(api.entry(null,'regular').display,'Not reported');
assert.equal(api.entry({status:'not_applicable',observation_at:stamp(1)},'regular').display,'Not applicable');

// The compact status shows last successful *official* retrieval, not when the
// browser downloaded GitHub's JSON or when the agency measured a wait.
data=payload();
data.sources.cbp.retrieved_at=stamp(3);
data.sources.cbp.last_success_at=stamp(3);
api.setData(data);
api.render();
assert.match(node('summary').textContent,/Checked 3m ago · CBP/);
assert.equal(node('statusDot').dataset.state,'ok');
assert.match(node('diagnosticBody').innerHTML,/Official CBP last successful check/);
assert.match(node('diagnosticBody').innerHTML,/Browser downloaded snapshot/);

// Recent agency retrieval with a much older observation means *reporting* delay.
data.directions.us.tunnel.standard=lane(12,135,2);
api.setData(data);api.render();
assert.equal(node('statusDot').dataset.state,'warn');
assert.match(node('summary').textContent,/Older report/);
assert.match(node('crossingRows').innerHTML,/Report 2h/);
assert.equal((node('crossingRows').innerHTML.match(/crossing-report-warning/g)||[]).length,1);

// CBSA has its own direction and its unpublished NEXUS fields never trigger
// warnings about the age of an observation CBSA does not provide.
api.setDirection('ca');
assert.equal(node('statusDot').dataset.state,'ok');
assert.match(node('summary').textContent,/CBSA/);
api.setDirection('us');

// A stalled collector is a separate warning, never blamed on agency cadence.
data.sources.cbp.last_success_at=stamp(48);
data.sources.cbp.retrieved_at=stamp(48);
api.setData(data);api.render();
assert.match(node('summary').textContent,/collection delayed/);
assert.doesNotMatch(node('summary').textContent,/Older report/);
assert.doesNotMatch(node('crossingRows').innerHTML,/class="crossing-report-warning"/);

// A failed official retrieval must not treat the failed attempt as successful.
data.sources.cbp.status='error';
data.sources.cbp.retrieved_at=stamp(1);
data.sources.cbp.last_success_at=stamp(48);
api.setData(data);api.render();
assert.match(node('summary').textContent,/CBP check failed · last successful check 48m ago/);
assert.equal(node('statusDot').dataset.state,'error');
assert.doesNotMatch(node('crossingRows').innerHTML,/class="crossing-report-warning"/);


// Canada-bound NEXUS cells use the official *schedule*, not a fabricated
// NEXUS inspection wait. All three crossings must have visible context even
// when the Gordie Howe camera is unavailable.
data=payload();
const allDayRows=[{label:'7 days per week',start:'00:00',end:'00:00'}];
const group=(rows)=>({groups:[{label:'Dedicated NEXUS lanes towards Canada',rows}]});
data.sources.cbsa_hours={status:'ok',retrieved_at:stamp(1)};
data.sources.dwt={status:'ok',retrieved_at:stamp(1)};
data.supplemental={
  cbsa_nexus_hours:{
    ambassador:group([{label:'Lane One\\n7 days per week',start:'00:00',end:'00:00'}]),
    tunnel:group(allDayRows),
    gordie:group(allDayRows)
  },
  dwt:{ca:{observation_at:stamp(1),lane_counts:{nexus:2}}}
};
api.setData(data);api.setDirection('ca');
const caBoard=node('crossingRows').innerHTML;
assert.equal((caBoard.match(/Within scheduled hours/g)||[]).length>=3,true,
  'all three crossings have published schedule context');
assert.ok(caBoard.includes('1 lane scheduled'),'Ambassador count must be explicitly scheduled');
assert.ok(caBoard.includes('2 NEXUS lanes listed (operator)'),'Tunnel count must be operator-attributed');
assert.equal(api.entry(null,'nexus','gordie').lanes,'Lanes not verified',
  'Gordie Howe NEXUS count unavailable, not assumed zero');
assert.match(api.entry(null,'nexus','tunnel').status,/wait not published/,
  'no separate NEXUS wait is invented');

data.sources.dwt.retrieved_at=stamp(25);api.setData(data);
assert.equal(api.entry(null,'nexus','tunnel').lanes,'Lanes not verified',
  'stale operator counts are not displayed');
data.sources.cbsa_hours.retrieved_at=stamp(3000);api.setData(data);
assert.equal(api.entry(null,'nexus','ambassador').display,'Hours unverified');
assert.equal(api.entry(null,'nexus','tunnel').display,'Hours unverified');
assert.equal(api.entry(null,'nexus','gordie').display,'Hours unverified');
data.sources.cbsa_hours.retrieved_at=stamp(1);
data.sources.cbsa_hours.status='error';api.setData(data);
assert.equal(api.entry(null,'nexus','ambassador').display,'Hours unverified',
  'retained schedule must not imply live operation');
data.sources.cbsa_hours.status='ok';
data.supplemental.cbsa_nexus_hours={};api.setData(data);
assert.equal(api.entry(null,'nexus','gordie').display,'Hours unverified',
  'missing schedule must never default to open');
api.setDirection('us');
assert.equal(api.entry(lane(3,5,1),'nexus').display,'3','US-bound waits unchanged');

// Compact formatting works with actual en-CA meridiem, midnight and tomorrow.
assert.equal(api.scheduleMoment('Today 10:00 p.m. ET',true),'10 PM');
assert.equal(api.scheduleMoment('Tomorrow 12:00 a.m. ET',true),'midnight');
assert.equal(api.scheduleMoment('Tomorrow 8:00 a.m. ET',false),'tomorrow 8 AM');

console.log('20-minute source-provenance, zero-delay, historical and 3-row UI behavior tests passed.');
