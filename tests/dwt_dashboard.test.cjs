'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const D=require('../decision.js');
const now=Date.parse('2026-11-20T12:00:00Z');
const stamp=(m,n=now)=>new Date(n-m*60000).toISOString();
const fresh=()=>({
 schema:'nexus-live-v2',generated_at:stamp(1),
 sources:{cbsa:{status:'ok',retrieved_at:stamp(2)},cbp:{status:'ok',retrieved_at:stamp(2)},
  dwt:{status:'ok',retrieved_at:stamp(2)}},
 directions:{ca:{tunnel:{standard:{status:'reported',minutes:0,observation_at:stamp(2)}}},
  us:{tunnel:{nexus:{status:'closed',minutes:null,observation_at:stamp(2)}}}},
 supplemental:{dwt:{ca:{source:'DWT',observation_at:stamp(2),lane_counts:{nexus:2,car:2}},
  us:{source:'DWT',observation_at:stamp(2),lane_counts:{nexus:1}}}}
});
const check=(s,id='tunnel',dir='ca',vehicle='passenger',lane='nexus')=>
 D.dwtNexusLane(s,id,dir,vehicle,lane,now);
let s=fresh();
assert.equal(check(s).kind,'current');
assert.equal(check(s).count,2);
assert.equal(check(s).source,'DWT');
assert.equal(check(s,'tunnel','us').count,null,'DWT USA count must never replace CBP');
assert.equal(check(s,'ambassador').count,null);
assert.equal(check(s,'gordie').count,null);
assert.equal(check(s,'tunnel','ca','commercial','nexus').count,null);
assert.equal(check(s,'tunnel','ca','passenger','regular').count,null);
assert.equal(s.directions.ca.tunnel.standard.minutes,0,'CBSA genuine zero preserved');
assert.equal(s.directions.us.tunnel.nexus.status,'closed','CBP closure preserved');
s=fresh();s.supplemental.dwt.ca.lane_counts.nexus=0;
assert.equal(check(s).kind,'reported_zero');
assert.equal(check(s).count,0,'zero is not missing or closed');
for(const bad of [null,undefined,true,false,-1,1.25,999,'2','',NaN]) {
 s=fresh();s.supplemental.dwt.ca.lane_counts.nexus=bad;
 assert.equal(check(s).kind,'invalid','invalid lane count: '+String(bad));
 assert.equal(check(s).count,null);
}
s=fresh();delete s.supplemental.dwt.ca;
assert.equal(check(s).kind,'unavailable','wrong-direction count cannot fill Canada');
for(const m of [19,20,21,992]){
 s=fresh();s.supplemental.dwt.ca.observation_at=stamp(m);
 assert.equal(check(s).kind,m<=20?'current':'stale','observation age '+m);
 assert.equal(check(s).count,m<=20?2:null);
}
for(const field of ['retrieved_at','generated_at']){
 s=fresh();const entry=field==='retrieved_at'?s.sources.dwt:s;
 entry[field]=stamp(25);
 assert.equal(check(s).kind,'stale',field+' age is independent');
}
s=fresh();s.sources.dwt.status='error';s.sources.dwt.retained_previous=true;
assert.equal(check(s).kind,'stale','failed cached source not current');
s=fresh();s.sources.dwt.cache_reused=true;s.sources.dwt.retrieved_at=stamp(25);
assert.equal(check(s).kind,'stale','cached data preserves original retrieval');
for(const badDate of [null,'invalid','2026-11-20T11:58:00','2026-03-08T02:30:00']){
 s=fresh();s.supplemental.dwt.ca.observation_at=badDate;
 assert.equal(check(s).kind,'invalid','require timezone-aware observation');
}
s=fresh();s.supplemental.dwt.ca.observation_at=stamp(-3);
assert.equal(check(s).kind,'stale','implausibly future observation rejected');
s=fresh();s.supplemental.dwt.ca.observation_at='2026-11-01T01:30:00';
assert.equal(check(s).kind,'invalid','DST fall-back local time rejected');
s=fresh();s.supplemental.dwt.ca.observation_at='2026-03-08T02:30:00';
assert.equal(check(s).kind,'invalid','DST spring-forward local time rejected');
s=fresh();s.supplemental.dwt.ca.observation_at='2026-11-01T05:30:00Z';
s.generated_at='2026-11-01T05:32:00Z';s.sources.dwt.retrieved_at='2026-11-01T05:32:00Z';
assert.equal(D.dwtNexusLane(s,'tunnel','ca','passenger','nexus',Date.parse('2026-11-01T05:34:00Z')).kind,'current','first fall-back occurrence with UTC offset');
s.supplemental.dwt.ca.observation_at='2026-11-01T06:30:00Z';
s.generated_at='2026-11-01T06:32:00Z';s.sources.dwt.retrieved_at='2026-11-01T06:32:00Z';
assert.equal(D.dwtNexusLane(s,'tunnel','ca','passenger','nexus',Date.parse('2026-11-01T06:34:00Z')).kind,'current','second fall-back occurrence with UTC offset');
s=fresh();
assert.equal(D.crossing(s,'ca','tunnel',true,now).dwt!==null,true);
s.sources.dwt.status='error';
assert.equal(D.crossing(s,'ca','tunnel',true,now).dwt,null,'legacy decision classification may not upgrade source error');
s=fresh();s.sources.dwt.retrieved_at=stamp(25);
assert.equal(D.crossing(s,'ca','tunnel',true,now).dwt,null,'legacy decision classification must check retrieval age');

const html=fs.readFileSync('index.html','utf8');
const dashboard=fs.readFileSync('dashboard.js','utf8');
assert.match(html,/id="detailDwt"/);
assert.match(html,/id="detailDwtReport"/);
assert.match(html,/decision\.js\?v=rc149-dwt1/);
assert.match(html,/dashboard\.js\?v=m6-dwt1/);
new vm.Script(dashboard);
const instrumented=dashboard.replace(/\ninit\(\);\n\}\)\(\);\s*$/,
 "\nwindow.__dwtTest={store,cell,renderDetail,classify};\n})();");
assert.notEqual(instrumented,dashboard);
const elements=new Map();
const element=id=>{
 if(!elements.has(id))elements.set(id,{
  dataset:{},textContent:'',innerHTML:'',hidden:false,
  setAttribute(){},focus(){},addEventListener(){}
 });
 return elements.get(id);
};
const ctx={window:{NexusDecision:D},document:{getElementById:element},
 localStorage:{getItem(){return null}},Date,Math,Number,Intl,console};
vm.runInNewContext(instrumented,ctx,{filename:'dashboard.js'});
const ui=ctx.window.__dwtTest;
const nowUI=Date.now(),liveStamp=min=>stamp(min,nowUI);
s=fresh();s.generated_at=liveStamp(1);s.sources.dwt.retrieved_at=liveStamp(1);
s.sources.cbsa.retrieved_at=liveStamp(1);s.sources.cbp.retrieved_at=liveStamp(1);
s.supplemental.dwt.ca.observation_at=liveStamp(1);
ui.store.data=s;ui.store.selected='tunnel';ui.store.direction='ca';ui.store.lane='nexus';
ui.renderDetail();
assert.equal(element('detailDwt').hidden,false);
assert.match(element('detailDwtReport').textContent,/DWT operator lists 2 NEXUS lanes/);
assert.match(element('detailDwtReport').textContent,/not confirmation of open customs booths/);
assert.match(element('detailDwtReport').textContent,/DWT observed:/);
assert.match(element('detailDwtReport').textContent,/DWT retrieved:/);
assert.match(element('detailDwtReport').textContent,/Nexus snapshot published:/);
assert.equal(ui.classify('tunnel','ca').text,'--','DWT must not become a Canada NEXUS wait');
assert.doesNotMatch(ui.cell('tunnel','ca'),/2 NEXUS lanes/,'unknown physical lane semantics: detail only');
s.supplemental.dwt.ca.observation_at=liveStamp(992);ui.renderDetail();
assert.doesNotMatch(element('detailDwtReport').textContent,/lists 2 NEXUS lanes/,'stale real-world pattern suppressed');
assert.match(element('detailDwtReport').textContent,/unavailable/);
s.supplemental.dwt.ca.observation_at=liveStamp(1);
s.supplemental.dwt.ca.lane_counts.nexus=0;ui.renderDetail();
assert.match(element('detailDwtReport').textContent,/lists 0 NEXUS lanes/);
ui.store.vehicle='commercial';ui.store.lane='regular';ui.renderDetail();
assert.equal(element('detailDwt').hidden,true);
ui.store.vehicle='passenger';ui.store.lane='regular';ui.renderDetail();
assert.equal(element('detailDwt').hidden,true);
ui.store.lane='nexus';ui.store.selected='ambassador';ui.renderDetail();
assert.equal(element('detailDwt').hidden,true);
ui.store.selected='tunnel';ui.store.direction='us';ui.renderDetail();
assert.equal(element('detailDwt').hidden,true);
console.log('DWT operator provenance, direction, category, zero, malformed, source-age, DST and root detail tests passed');
