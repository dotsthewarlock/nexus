'use strict';
const assert=require('node:assert/strict'),D=require('../decision.js');
const now=Date.parse('2026-11-25T12:00:00Z'),stamp=m=>new Date(now-m*60000).toISOString();
const fixture=()=>({generated_at:stamp(1),sources:{cbp:{status:'ok',retrieved_at:stamp(1),last_success_at:stamp(1)},cbsa:{status:'ok',retrieved_at:stamp(1)}},
directions:{us:{ambassador:{standard:{status:'reported',minutes:0,lanes_open:2,observation_at:stamp(1)},nexus:{status:'reported',minutes:3,lanes_open:1,observation_at:stamp(1)}}},ca:{ambassador:{standard:{status:'reported',minutes:7,observation_at:stamp(1)}}}}});
const classify=s=>D.classify(s,'ambassador','us','passenger','regular',now);
const raw=s=>s.directions.us.ambassador.standard;
for(const clock of ['observation','retrieval','lastSuccess','publication']){
 for(const ms of [1199999,1200000,1200001,7199999,7200000,7200001]){
  const s=fixture(),ts=new Date(now-ms).toISOString();
  if(clock==='observation')raw(s).observation_at=ts;
  if(clock==='retrieval')s.sources.cbp.retrieved_at=ts;
  if(clock==='lastSuccess')s.sources.cbp.last_success_at=ts;
  if(clock==='publication')s.generated_at=ts;
  const v=classify(s),expected=ms<=1200000?'current':ms<7200000?'stale':'unavailable';
  assert.equal(v.kind,expected,clock+' '+ms);
  assert.equal(v.count,expected==='current'?2:null);assert.equal(v.sortEligible,expected==='current');
  assert.equal(v.minutes,expected==='unavailable'?null:0);
 }
}
for(const bad of [null,'2026-11-25T12:00:00','bad',stamp(-3)]){
 const s=fixture();raw(s).observation_at=bad;assert.equal(classify(s).minutes,null);
}
let s=fixture();s.sources.cbp.status='error';s.sources.cbp.retained_previous=true;
assert.equal(classify(s).kind,'stale');delete s.sources.cbp.last_success_at;assert.equal(classify(s).minutes,null);
s=fixture();s.sources.cbp.retained_previous=true;assert.equal(classify(s).kind,'stale');
s=fixture();s.directions.us.ambassador.source='CBSA';assert.equal(classify(s).state,'invalid');
s=fixture();raw(s).source='DWT';assert.equal(classify(s).state,'invalid');
s=fixture();raw(s).lanes_open=101;assert.equal(classify(s).count,null);
raw(s).lanes_open=0;assert.equal(classify(s).count,0);
raw(s).status='closed';assert.equal(classify(s).kind,'closed');delete raw(s).observation_at;
assert.equal(classify(s).kind,'closure_unverified');
s=fixture();s.directions.us.ambassador.port_status='Closed';
assert.equal(classify(s).state,'port_closure_unverified');assert.equal(classify(s).sortEligible,false);assert.equal(classify(s).minutes,null);
assert.equal(D.classify(s,'ambassador','ca','passenger','regular',now).minutes,7);
assert.equal(D.presentation(s,'ambassador','ca','passenger','nexus',now).parts[0].v.minutes,7);
assert.equal(D.classify(s,'ambassador','ca','passenger','nexus',now).state,'unpublished');
assert.deepEqual(D.orderedCrossings(s,'fixed','passenger','nexus','gordie',now),['gordie','ambassador','tunnel']);
assert.deepEqual(D.orderedCrossings(s,'us','passenger','nexus','gordie',now),['ambassador','tunnel','gordie']);
const mem=new Map(),storage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v)};
assert.equal(D.readPreferences(storage).lane,'nexus');
D.savePreference(storage,'nexus-vehicle','commercial');D.savePreference(storage,'nexus-lane','nexus');
assert.equal(D.readPreferences(storage).lane,'regular');assert.equal(D.readPreferences(storage).invalid,true);
D.savePreference(storage,'nexus-lane','fast');D.savePreference(storage,'nexus-favorite','gordie');
assert.equal(D.readPreferences(storage).lane,'fast');assert.equal(D.readPreferences(storage).favorite,'gordie');
assert.equal(D.readPreferences({getItem(){throw Error('blocked')}}).lane,'nexus');
assert.equal(D.savePreference({setItem(){throw Error('blocked')}},'x','y'),false);
console.log('R2 model exact clock boundaries, zero/count, closure, retained data, sorting and preference fixtures passed.');
