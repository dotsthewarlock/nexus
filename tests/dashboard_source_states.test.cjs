'use strict';
// Synthetic, deterministic source-state acceptance tests for the *root* dashboard.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const D=require('../decision.js');
const original=fs.readFileSync('dashboard.js','utf8');
const injected=original.replace(/\ninit\(\);\n\}\)\(\);\s*$/,
  "\nwindow.__sourceQA={store,classify,cell,sortIds,collectNotices,render};\n})();");
assert.notEqual(injected,original,'Dashboard test shim must find existing init()');

const nodes=new Map();
function node(id){
  if(!nodes.has(id))nodes.set(id,{
    dataset:{},textContent:'',innerHTML:'',hidden:false,open:false,
    setAttribute(k,v){this[k]=String(v)},
    getAttribute(k){return this[k]},
    addEventListener(){},focus(){}
  });
  return nodes.get(id);
}
const ctx={window:{NexusDecision:D},
  document:{documentElement:{dataset:{largeText:'false'}},getElementById:node,querySelectorAll(){return []}},
  localStorage:{getItem(){return null}},Date,Intl,Math,Number,console};
vm.runInNewContext(injected,ctx,{filename:'dashboard.js'});
const qa=ctx.window.__sourceQA;
const ago=m=>new Date(Date.now()-m*60000).toISOString();
const reading=(minutes=0,minutesAgo=2,more={})=>({
  status:'reported',minutes,observation_at:ago(minutesAgo),lanes_open:2,...more
});
function snapshot(){
  return {schema:'nexus-live-v2',generated_at:ago(1),
    sources:{cbsa:{status:'ok',retrieved_at:ago(1)},cbp:{status:'ok',retrieved_at:ago(1)},
      dwt:{status:'ok',retrieved_at:ago(1)}},
    directions:{
      ca:{ambassador:{standard:reading(8)},tunnel:{standard:reading(6)},gordie:{standard:reading(4)}},
      us:{ambassador:{standard:reading(0),nexus:reading(3),ready:{status:'not_applicable'}},
        tunnel:{standard:reading(9),nexus:reading(7)},
        gordie:{standard:reading(11),nexus:reading(10)}}
    },
    supplemental:{dwt:{ca:{source:'DWT',observation_at:ago(2),lane_counts:{nexus:2,car:2}},
      us:{source:'DWT',observation_at:ago(2),lane_counts:{nexus:1}}}}
  };
}
function reset(){qa.store.data=snapshot();qa.store.vehicle='passenger';
  qa.store.lane='regular';qa.store.sort='fixed';qa.store.error=null;return qa.store.data;}
let s=reset();
assert.equal(qa.classify('ambassador','us').text,'0 min','reported zero is valid');
assert.match(qa.cell('ambassador','us'),/0 min/);
assert.equal(qa.classify('tunnel','ca').kind,'current');
assert.doesNotMatch(qa.cell('tunnel','ca'),/2 lanes/,'CBSA Regular must not inherit operator NEXUS');
s.directions.us.ambassador.standard.minutes=0;
s.directions.us.ambassador.standard.status='unavailable';
assert.equal(qa.classify('ambassador','us').text,'--','numeric zero without reported status is missing');
s=reset();s.directions.us.ambassador.standard.minutes=null;
assert.equal(qa.classify('ambassador','us').text,'--','null is never zero');
s=reset();s.directions.us.ambassador.standard.observation_at=ago(42);
assert.equal(qa.classify('ambassador','us').kind,'stale');
assert.match(qa.cell('ambassador','us'),/Old report/);
s=reset();s.directions.us.ambassador.standard.observation_at=ago(125);
assert.equal(qa.classify('ambassador','us').text,'--','expired observation is not current');
s=reset();s.directions.us.ambassador.standard.observation_at=ago(2).slice(0,-1);
assert.equal(qa.classify('ambassador','us').text,'--',
  'a recent timezone-less timestamp must not be interpreted in browser-local time');
s=reset();s.sources.cbp.retrieved_at=ago(31);
assert.equal(qa.classify('ambassador','us').kind,'stale',
  'recent observation does not overcome old retrieval');
assert.match(qa.cell('ambassador','us'),/Old report/);
s=reset();s.generated_at=ago(35);
assert.notEqual(qa.classify('ambassador','us').kind,'current',
  'newly fetched browser JSON cannot make published old data current');
assert.equal(qa.collectNotices(s).length,0,'old snapshot cannot activate alerts');
s=reset();s.sources.cbp.status='error';s.sources.cbp.retained_previous=true;s.sources.cbp.last_success_at=ago(10);
assert.equal(qa.classify('ambassador','us').kind,'stale','failed source only historical');
s=reset();s.sources.cbp.status='error';delete s.sources.cbp.retained_previous;
assert.equal(qa.classify('ambassador','us').text,'--','failed source without prior cannot claim wait');
s=reset();s.directions.us.ambassador.standard.status='closed';
s.directions.us.ambassador.standard.minutes=null;
assert.equal(qa.classify('ambassador','us').text,'Closed','recent official closure');
s.directions.us.ambassador.standard.observation_at=ago(44);
assert.equal(qa.classify('ambassador','us').text,'Closure unverified','old closure not live');
s=reset();s.directions.ca.tunnel.port_status='Temporarily Closed';
assert.equal(qa.classify('tunnel','ca').kind,'closure_unverified','undated port closure warns and withholds conflicting numeric');
assert.match(qa.cell('tunnel','ca'),/Source-reported port closure/);
s.sources.cbsa.retrieved_at=ago(35);
assert.notEqual(qa.classify('tunnel','ca').kind,'closed','unfresh port closure cannot override wait');
s=reset();qa.store.lane='ready';
assert.equal(qa.classify('ambassador','us').kind,'unsupported','verified N/A distinct from missing');
assert.equal(qa.classify('tunnel','us').kind,'unavailable','missing Ready distinct from N/A');
assert.equal(qa.classify('ambassador','ca').kind,'unavailable','no substitute regular for Ready');
s=reset();qa.store.lane='nexus';
assert.equal(qa.classify('ambassador','ca').kind,'unpublished','CBSA NEXUS inspection wait absent');
assert.equal(qa.classify('ambassador','us').text,'3 min','NEXUS uses its own CBP report');
assert.match(qa.cell('tunnel','ca'),/2 NEXUS lanes/);
assert.doesNotMatch(qa.cell('ambassador','ca'),/NEXUS lanes/);
assert.doesNotMatch(qa.cell('tunnel','us'),/NEXUS lanes/);
s.sources.dwt.retrieved_at=ago(25);
assert.doesNotMatch(qa.cell('tunnel','ca'),/NEXUS lanes/,'old fetch suppresses current DWT count');
s=reset();qa.store.lane='nexus';s.supplemental.dwt.ca.observation_at=ago(1095);
assert.doesNotMatch(qa.cell('tunnel','ca'),/NEXUS lanes/,'old underlying DWT observation suppressed');
s=reset();qa.store.lane='nexus';s.supplemental.dwt.ca.lane_counts.nexus=0;
assert.match(qa.cell('tunnel','ca'),/0 NEXUS lanes/,'open-lane zero is not a wait zero');
assert.doesNotMatch(qa.cell('tunnel','ca'),/Closed/,'0 NEXUS lanes is not a port closure');
s=reset();qa.store.vehicle='commercial';qa.store.lane='regular';
assert.doesNotMatch(qa.cell('tunnel','ca'),/NEXUS lanes/,'no commercial use of passenger NEXUS');
qa.store.lane='fast';
assert.equal(qa.classify('tunnel','ca').text,'--','no general-lane substitute for FAST');
s=reset();qa.store.sort='us';assert.equal(qa.sortIds().join(','),'ambassador,tunnel,gordie');
s.directions.us.ambassador.standard=null;
assert.equal(qa.sortIds().join(','),'tunnel,gordie,ambassador',
  'unavailable waits sort last, rows stay together');
s=reset();s.directions.ca.ambassador.port_status='Closed';
assert.equal(qa.collectNotices(s)[0].id,'ambassador');
s.sources.cbsa.retrieved_at=ago(40);
assert.equal(qa.collectNotices(s).length,0,'old report does not produce current closure notice');
s=reset();s.sources.cbsa.retrieved_at=ago(36);
qa.render();
assert.equal(node('statusDot').dataset.state,'warn');
assert.match(node('summary').textContent,/CBSA checked 36m ago/);
assert.equal((node('crossingRows').innerHTML.match(/class="crossing-row"/g)||[]).length,3);
assert.equal((node('crossingRows').innerHTML.match(/class="wait-cell"/g)||[]).length,6);
console.log('Source-state QA passed: zero, malformed, stale, failed, N/A, closure, DWT, category, sorting, notices, provenance.');
