const assert=require('node:assert/strict');
const D=require('../decision.js');
const t=Date.parse('2026-11-18T19:00:00Z');
const stamp=new Date(t-5*60000).toISOString();
const lane=n=>({minutes:n,status:'reported',observation_at:stamp,lanes_open:1});
const p=(regular,nexus=regular)=>({standard:lane(regular),nexus:lane(nexus),port_status:'Open'});
function snapshot(us={tunnel:p(15,5),ambassador:p(20,8),gordie:p(20,7)}, ca={tunnel:{standard:lane(4)},ambassador:{standard:lane(10)},gordie:{standard:lane(2)}}){
 return {schema:'nexus-live-v2',generated_at:stamp,directions:{us,ca},supplemental:{dwt:{}}};
}
let r=D.evaluate(snapshot(),'us','tunnel',true,'conservative',t);
assert.equal(r.kind,'normal');assert.equal(r.suggested,null);assert.equal(r.home.primaryType,'nexus');
let high=snapshot();high.directions.us.tunnel=p(50,40);high.directions.us.gordie=p(10,5);
r=D.evaluate(high,'us','tunnel',true,'conservative',t);
assert.equal(r.kind,'consider');assert.equal(r.suggested,'gordie');assert.match(r.headline,/35 min shorter inspection/);
let minor=snapshot();minor.directions.us.tunnel=p(30,21);minor.directions.us.gordie=p(15,10);
assert.equal(D.evaluate(minor,'us','tunnel',true,'conservative',t).suggested,null);
assert.equal(D.evaluate(minor,'us','tunnel',true,'balanced',t).suggested,'ambassador');
assert.equal(D.evaluate(high,'us','tunnel',true,'information',t).suggested,null);
let closed=snapshot();closed.directions.us.tunnel.port_status='Closed';
r=D.evaluate(closed,'us','tunnel',true,'conservative',t);assert.equal(r.kind,'closed');assert.equal(r.suggested,'gordie');
let nexusClosed=snapshot();nexusClosed.directions.us.tunnel.nexus={status:'closed',minutes:null,observation_at:null};
r=D.evaluate(nexusClosed,'us','tunnel',true,'conservative',t);
assert.equal(r.kind,'caution');assert.equal(r.home.primaryType,'regular');assert.equal(r.home.nexusReportedClosed,true);
const ca=D.evaluate(snapshot(),'ca','tunnel',true,'conservative',t);
assert.equal(ca.home.nexus.kind,'unavailable');assert.equal(ca.home.primaryType,'regular');
let stale=snapshot();stale.generated_at=new Date(t-4*3600000).toISOString();
r=D.evaluate(stale,'us','tunnel',true,'conservative',t);assert.equal(r.kind,'unknown');assert.equal(r.home.primary.minutes,null);
assert.equal(D.reading({status:'reported',minutes:0,observation_at:stamp},snapshot(),t).minutes,0);
assert.equal(D.reading(null,snapshot(),t).minutes,null);
assert.equal(D.reading({status:'closed'},snapshot(),t).kind,'closed');
assert.equal(D.reading({status:'not_applicable'},snapshot(),t).kind,'not_applicable');
let notice=snapshot();notice.directions.us.tunnel.notice='Construction near the crossing';
assert.equal(D.evaluate(notice,'us','tunnel',true,'conservative',t).headline,'Official crossing notice');
let dwt=snapshot();dwt.supplemental.dwt.us={observation_at:stamp,lane_counts:{nexus:1,car:2},travel_time_category:'< 20'};
assert.equal(D.crossing(dwt,'us','tunnel',true,t).dwt.lane_counts.nexus,1);
dwt.supplemental.dwt.us.observation_at=new Date(t-2*3600000).toISOString();
assert.equal(D.crossing(dwt,'us','tunnel',true,t).dwt,null);
assert.equal(D.countrySide(42.265,-83.05,70),'ca');  // Windsor
assert.equal(D.countrySide(42.24,-83.12,70),'ca');  // LaSalle
assert.equal(D.countrySide(42.48,-83.2,70),'us');  // Detroit suburbs
assert.equal(D.countrySide(42.62,-83.15,70),'us'); // Troy
assert.equal(D.countrySide(42.34,-83.055,70),null); // Downtown waterfront uncertainty
assert.equal(D.countrySide(42.265,-83.05,8000),null);
let hours=snapshot();hours.sources={cbsa_hours:{status:'ok',retrieved_at:stamp}};
hours.supplemental.cbsa_nexus_hours={tunnel:{groups:[{label:'Dedicated NEXUS lanes towards Canada',rows:[{start:'07:00',end:'22:00'}]}]}};
assert.equal(D.publishedNexusWindow(hours,'tunnel','ca',t),'within_possible_window');
const morning=Date.parse('2026-11-18T08:00:00Z');
const mStamp=new Date(morning-5*60000).toISOString();
hours.generated_at=mStamp;hours.sources.cbsa_hours.retrieved_at=mStamp;
hours.directions.ca.tunnel.standard.observation_at=mStamp;
assert.equal(D.publishedNexusWindow(hours,'tunnel','ca',morning),'outside_all_published_windows');
assert.equal(D.evaluate(hours,'ca','tunnel',true,'conservative',morning).headline,'Outside published NEXUS hours');
console.log('RC1.4 decision engine: 21 scenario assertions passed');
