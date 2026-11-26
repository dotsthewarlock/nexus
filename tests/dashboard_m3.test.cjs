'use strict';
// Synthetic M3 G1-G5 acceptance coverage: no upstream network and no production waits.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const D=require('../decision.js');
const original=fs.readFileSync('dashboard.js','utf8');
const injected=original.replace(/\ninit\(\);\n\}\)\(\);\s*$/,
 "\nwindow.__m3qa={store,classify,displayModel,cell,sortIds,render,renderDetail,updateLanes};\n})();");
assert.notEqual(original,injected,'M3 test shim must find init');
const nodes=new Map();
const node=id=>{
 if(!nodes.has(id))nodes.set(id,{
  dataset:{},hidden:false,open:false,textContent:'',innerHTML:'',value:'',
  setAttribute(k,v){this[k]=String(v)},getAttribute(k){return this[k]},
  addEventListener(){},focus(){}
 });
 return nodes.get(id);
};
const dom={documentElement:{dataset:{largeText:'false'}},getElementById:node,querySelectorAll(){return[]}};
const ctx={window:{NexusDecision:D},document:dom,localStorage:{getItem(){return null}},Date,Intl,Math,Number,console};
vm.runInNewContext(injected,ctx,{filename:'dashboard.js'});
const qa=ctx.window.__m3qa;
const at=m=>new Date(Date.now()-m*60000).toISOString();
const sample=(mins,count=2,observed=2,extra={})=>({status:'reported',minutes:mins,
 observation_at:at(observed),lanes_open:count,...extra});
function fixture(){
 return {schema:'nexus-live-v2',generated_at:at(1),
  sources:{cbp:{status:'ok',retrieved_at:at(1)},cbsa:{status:'ok',retrieved_at:at(1)},
   dwt:{status:'ok',retrieved_at:at(1)}},
  directions:{
   us:{
    ambassador:{nexus:sample(5,2),standard:sample(14,4),ready:{status:'not_applicable'}},
    tunnel:{nexus:sample(8,1),standard:sample(10,3)},
    gordie:{nexus:sample(3,1),standard:sample(12,2)}
   },
   ca:{
    ambassador:{standard:sample(12,null)},
    tunnel:{standard:sample(7,null)},
    gordie:{standard:sample(10,null)}
   }
  },
  supplemental:{dwt:{ca:{source:'DWT',observation_at:at(2),lane_counts:{nexus:2,car:3}}}}
 };
}
function reset(){qa.store.data=fixture();qa.store.vehicle='passenger';qa.store.lane='nexus';
 qa.store.sort='fixed';qa.store.error=null;dom.documentElement.dataset.largeText='false';
 return qa.store.data;}
let s=reset();
assert.equal(qa.store.lane,'nexus','first-use default must be NEXUS');
assert.equal(qa.displayModel('ambassador','us').paired,true);
assert.equal(qa.displayModel('ambassador','ca').canadaGeneral,true);
let us=qa.cell('ambassador','us'),ca=qa.cell('ambassador','ca');
assert.match(us,/pair-amount">5<\/span>.*pair-amount">14<\/span>/,
 'NEXUS and Regular source numbers remain independently ordered');
assert.match(us,/2 \/ 4 lanes/,'category-specific lane counts shown without adding them');
assert.match(us,/NEXUS 5 minutes.*Regular 14 minutes/,'one accessible label must identify both categories');
assert.doesNotMatch(us,/6 lanes/,'no invented physical sum');
assert.match(ca,/wait-number">12<\/span>/,'Canada shows only CBSA general passenger reading');
assert.match(ca,/CBSA general passenger/,'Canada wait is not presented as NEXUS wait');
assert.doesNotMatch(ca,/pair-inline|pair-stacked/,'Canada does not invent a paired NEXUS wait');
assert.match(qa.cell('tunnel','ca'),/2 NEXUS lanes/,
 'fresh DWT supplemental lane count is separately attributed');
assert.doesNotMatch(qa.cell('ambassador','ca'),/NEXUS lanes/);
assert.doesNotMatch(qa.cell('gordie','ca'),/NEXUS lanes/);
assert.doesNotMatch(us,/DWT/,'DWT cannot override CBP USA');
qa.render();
assert.match(node('caHeading').innerHTML,/General passenger/);assert.match(node('usHeading').innerHTML,/NEXUS \/ Regular/);
assert.equal((node('crossingRows').innerHTML.match(/class="wait-cell"/g)||[]).length,6);
assert.match(node('summary').textContent,/CBSA checked.*CBP checked/);
qa.store.selected='ambassador';qa.store.direction='us';qa.renderDetail();
assert.equal(node('detailWait').textContent,'5 / 14 min');
assert.match(node('detailProvenance').innerHTML,/NEXUS.*Regular/s);
assert.match(node('detailProvenance').innerHTML,/Physical additivity is unverified/);

// G1: Regular, Ready, Commercial FAST are strict and never borrow paired values.
qa.store.lane='regular';us=qa.cell('ambassador','us');
assert.match(us,/wait-number">14<\/span>/);
assert.doesNotMatch(us,/pair-inline|pair-stacked/);
qa.render();assert.match(node('usHeading').innerHTML,/Regular/);assert.doesNotMatch(node('usHeading').innerHTML,/NEXUS \/ Regular/);
qa.store.lane='ready';
assert.equal(qa.classify('ambassador','us').kind,'unsupported');
assert.equal(qa.classify('tunnel','us').kind,'unavailable');
assert.doesNotMatch(qa.cell('tunnel','us'),/wait-number">10<\/span>/);
qa.store.vehicle='commercial';qa.store.lane='fast';
assert.equal(qa.classify('ambassador','us').kind,'unavailable');
assert.doesNotMatch(qa.cell('ambassador','us'),/5 \/ 14/);
assert.doesNotMatch(qa.cell('tunnel','ca'),/NEXUS lanes/);
qa.updateLanes();assert.equal(qa.store.lane,'fast');
qa.store.lane='nexus';qa.updateLanes();
assert.equal(qa.store.lane,'regular','inapplicable NEXUS selection resets to commercial Regular');

// G2: missing NEXUS leaves the Regular half valid and explicitly not interchangeable.
s=reset();delete s.directions.us.ambassador.nexus;us=qa.cell('ambassador','us');
assert.match(us,/pair-amount[^>]*>--<\/span>.*pair-amount[^>]*>14<\/span>/);
assert.match(us,/NEXUS unavailable/);
assert.match(us,/4 Regular lanes/);
assert.equal(qa.classify('ambassador','us','nexus').kind,'unavailable');
assert.equal(qa.classify('ambassador','us','regular').kind,'current');
s=reset();s.directions.us.ambassador.nexus.observation_at=at(43);
us=qa.cell('ambassador','us');
assert.match(us,/NEXUS old report/);
assert.match(us,/pair-amount[^>]*data-age-state="old">5<\/span>.*pair-amount[^>]*>14<\/span>/,
 'old official NEXUS value is visible with explicit historical styling');
assert.match(us,/NEXUS 5 minutes, historical report/,'accessible history is not called current');
assert.doesNotMatch(us,/2 \/ 4 lanes/,'old NEXUS count must not appear as current');
s=reset();s.directions.us.ambassador.standard.observation_at=at(50);
assert.match(qa.cell('ambassador','us'),/Regular old report/);
assert.match(qa.cell('ambassador','us'),/2 NEXUS lanes/);
s=reset();s.directions.us.ambassador.nexus.minutes=0;
assert.match(qa.cell('ambassador','us'),/pair-amount">0<\/span>.*pair-amount">14<\/span>/,
 'official NEXUS zero remains valid zero');
s=reset();s.directions.us.ambassador.nexus.minutes=null;
assert.match(qa.cell('ambassador','us'),/NEXUS unavailable/);
s=reset();s.sources.cbp.retrieved_at=at(36);
assert.notEqual(qa.classify('ambassador','us','nexus').kind,'current');
assert.notEqual(qa.classify('ambassador','us','regular').kind,'current');
assert.match(qa.cell('ambassador','us'),/Both historical · source not current/);
s=reset();s.sources.cbp.status='error';s.sources.cbp.retained_previous=true;
assert.notEqual(qa.classify('ambassador','us','nexus').kind,'current');
assert.doesNotMatch(qa.cell('ambassador','us'),/2 \/ 4 lanes/,'retained source is not recent lanes');
s=reset();s.directions.us.ambassador.nexus.status='closed';
s.directions.us.ambassador.nexus.minutes=null;
us=qa.cell('ambassador','us');
assert.match(us,/NEXUS source-reported closed/,'scoped NEXUS closure is not full port closure');
assert.match(us,/pair-amount[^>]*>--<\/span>.*pair-amount[^>]*>14<\/span>/);
s=reset();s.directions.us.ambassador.port_status='Closed';
assert.match(qa.cell('ambassador','us'),/Source-reported port closure/);
assert.doesNotMatch(qa.cell('ambassador','us'),/pair-inline/);
s=reset();s.supplemental.dwt.ca.observation_at=at(992);
assert.doesNotMatch(qa.cell('tunnel','ca'),/NEXUS lanes/);
s=reset();s.supplemental.dwt.ca.lane_counts.nexus=0;
assert.match(qa.cell('tunnel','ca'),/0 NEXUS lanes/);
s.supplemental.dwt.ca.lane_counts.nexus=1;
assert.match(qa.cell('tunnel','ca'),/1 NEXUS lane<\/span>/);
assert.doesNotMatch(qa.cell('tunnel','ca'),/1 \/ \d+ lanes/,'unverified Cars count must never become Regular');
s.supplemental.dwt.ca.lane_counts.nexus=0;
assert.doesNotMatch(qa.cell('tunnel','ca'),/Source-reported port closure/);

// Realistic stale-only feed: sorting cannot rank and must visibly say why.
s=reset();qa.store.sort='ca';
for(const id of ['ambassador','tunnel','gordie'])s.directions.ca[id].standard.observation_at=at(51);
qa.render();
assert.equal(qa.sortIds().join(','),'ambassador,tunnel,gordie');
assert.match(node('sortStatus').textContent,/Sorting paused/);
assert.equal(node('sortStatus').hidden,false);
assert.doesNotMatch(node('caHeading').innerHTML,/sort-arrow/);
assert.match(node('sortToggle').textContent,/paused/);
qa.store.sort='us';
for(const id of ['ambassador','tunnel','gordie']){
 s.directions.us[id].nexus.observation_at=at(51);
 s.directions.us[id].standard.observation_at=at(51);
}
qa.render();
assert.match(node('sortStatus').textContent,/Sorting paused/);
assert.match(qa.cell('tunnel','us'),/Both old reports/);
assert.match(qa.cell('tunnel','us'),/data-age-state="old"/);
assert.equal(qa.sortIds().join(','),'ambassador,tunnel,gordie');

// G3: sort by selected NEXUS only; Canada uses CBSA general. Rows move intact.
s=reset();qa.store.sort='us';
assert.equal(qa.sortIds().join(','),'gordie,ambassador,tunnel');
s.directions.us.ambassador.standard.minutes=0;
assert.equal(qa.sortIds().join(','),'gordie,ambassador,tunnel',
 'Regular zero must not displace a slower selected NEXUS wait');
s.directions.us.gordie.nexus.observation_at=at(40);
assert.equal(qa.sortIds().join(','),'ambassador,tunnel,gordie',
 'stale selected category sorts last despite fresh Regular reading');
qa.store.sort='ca';
assert.equal(qa.sortIds().join(','),'tunnel,gordie,ambassador',
 'Canada NEXUS focus sorts by eligible CBSA general passenger wait');
qa.store.lane='regular';qa.store.sort='us';
assert.equal(qa.sortIds().join(','),'ambassador,tunnel,gordie',
 'Regular category sort takes Regular values instead of Nexus');

// G5: reflow three-digit pairs or enlarged fonts rather than shrink or swap values.
s=reset();s.directions.us.ambassador.nexus.minutes=120;
s.directions.us.ambassador.standard.minutes=135;
assert.match(qa.cell('ambassador','us'),/pair-stacked-row/);
dom.documentElement.dataset.largeText='true';
assert.match(qa.cell('tunnel','us'),/pair-stacked-row/);
console.log('M3 G1-G5 fixtures passed: paired categories, one Canada general wait, zero/missing/stale/closure, DWT, nonadditive counts, Settings sorting and large values.');
