const assert = require('node:assert/strict');
const D = require('../decision.js');
const t = Date.parse('2026-11-18T19:00:00Z'); // Wednesday, 14:00 EST
const iso = n => new Date(n).toISOString();
const ago = (n, now=t) => iso(now - n * 60000);
const lane = (minutes, n=5) => ({minutes,status:'reported',observation_at:ago(n),lanes_open:1});
const port = (regular,nexus=regular) => ({standard:lane(regular),nexus:lane(nexus),port_status:'Open'});
function snapshot(us={tunnel:port(15,5),ambassador:port(20,8),gordie:port(20,7)},
  ca={tunnel:{standard:lane(4)},ambassador:{standard:lane(10)},gordie:{standard:lane(2)}}) {
  const stamp=ago(5);
  return {schema:'nexus-live-v2',generated_at:stamp,sources:{cbp:{status:'ok',retrieved_at:stamp},
    cbsa:{status:'ok',retrieved_at:stamp}},directions:{us,ca},supplemental:{dwt:{}}};
}
function evalUs(data,mode='conservative', now=t) {return D.evaluate(data,'us','tunnel',true,mode,now);}
let checks=0;
function check(value,expected,description) {assert.deepEqual(value,expected,description);checks++;}
let r=evalUs(snapshot());
check(r.kind,'normal','safe baseline');check(r.suggested,null,'no switch');check(r.home.primaryType,'nexus','NEXUS primary');
let high=snapshot();high.directions.us.tunnel=port(50,40);high.directions.us.gordie=port(10,5);
r=evalUs(high);check(r.suggested,'gordie','comparable difference supports inspection suggestion');
assert.match(r.headline,/35 min shorter inspection wait/);checks++;
let minor=snapshot();minor.directions.us.tunnel=port(30,21);minor.directions.us.gordie=port(15,10);
check(evalUs(minor).suggested,null,'conservative threshold');
check(evalUs(minor,'balanced').suggested,'ambassador','balanced threshold');
check(evalUs(high,'information').suggested,null,'info-only');
let mismatch=snapshot();mismatch.directions.us.tunnel=port(50,40);mismatch.directions.us.gordie=port(5,2);
mismatch.directions.us.ambassador.nexus.observation_at=ago(13);
mismatch.directions.us.tunnel.nexus.observation_at=ago(1);
mismatch.directions.us.gordie.nexus.observation_at=ago(13);
check(evalUs(mismatch).suggested,null,'aging candidate excluded');
check(evalUs(mismatch).kind,'caution','missing comparable evidence surfaces an incomplete comparison');
mismatch.directions.us.gordie.nexus.observation_at=ago(9.5);
check(evalUs(mismatch).suggested,null,'observation age gap excludes comparison');
mismatch.directions.us.gordie.nexus.observation_at=ago(6);
check(evalUs(mismatch).suggested,'gordie','comparable observation ages');
let notice=structuredClone(high);
notice.directions.us.tunnel.notice='A Ready Lane is available from 11am-2pm Monday through Friday. More at https://www.cbp.gov/travel';
check(D.noticeKind(notice.directions.us.tunnel.notice),'informational','Ready Lane hours are informational');
check(evalUs(notice).suggested,'gordie','routine notice must not block comparison');
notice.directions.us.tunnel.notice='Port construction: lane closures and detour in effect';
check(D.noticeKind(notice.directions.us.tunnel.notice),'operational','relevant closure notice');
check(D.noticeKind('Ready Lane available on schedule; emergency closure in effect'),'operational','do not dismiss actual closures in Ready Lane notices');
check(evalUs(notice).kind,'caution','operational advisory surfaces');
check(evalUs(notice).suggested,null,'safety first during operational advisory');
let closed=snapshot();closed.directions.us.tunnel.port_status='Closed';
check(evalUs(closed).kind,'closed','confirmed port closure');
check(evalUs(closed).suggested,'gordie','fresh alternate for confirmed closure');
check(evalUs(closed,'information').suggested,null,'no suggestions in information mode');
let nxClosed=snapshot();nxClosed.directions.us.tunnel.nexus={status:'closed',minutes:null,observation_at:null};
check(evalUs(nxClosed).kind,'caution','lane closed report even without lane timestamp');
check(evalUs(nxClosed).home.primaryType,'regular','standard fallback');
const ca=D.evaluate(snapshot(),'ca','tunnel',true,'conservative',t);
check(ca.home.primaryType,'regular','CA has only regular wait');
check(ca.home.nexus.kind,'unavailable','CA separate NEXUS not fabricated');
let aging=snapshot();aging.directions.us.tunnel.nexus.observation_at=ago(15);
check(evalUs(aging).home.nexus.kind,'aging','aging 10-20');
check(evalUs(aging).suggested,null,'aging reading cannot recommend');
let stale=snapshot();stale.directions.us.tunnel.nexus.observation_at=ago(35);
check(evalUs(stale).home.nexus.kind,'stale','20-60 stale');
check(evalUs(stale).headline,'NEXUS conditions unverified','do not silently compare regular waits if NEXUS readings stale');
check(evalUs(stale).home.nexus.minutes,5,'stale value preserved labeled');
check(D.usable(evalUs(stale).home.nexus),false,'stale never eligible');
stale.directions.us.tunnel.nexus.observation_at=ago(61);
check(evalUs(stale).home.nexus.kind,'old','>60 old, not current');
check(evalUs(stale).suggested,null,'old NEXUS observation never recommends');
stale.directions.us.tunnel.nexus.observation_at=ago(121);
check(evalUs(stale).home.nexus.kind,'unavailable','>120 expires');
let snapOld=snapshot();snapOld.generated_at=ago(40);
check(evalUs(snapOld).home.primary.kind,'stale','old snapshot stale even with recent source readings');
check(evalUs(snapOld).suggested,null,'old snapshot never recommends');
snapOld.generated_at=ago(65);
check(evalUs(snapOld).home.primary.kind,'old','snapshot older than an hour makes report OLD');
check(evalUs(snapOld).suggested,null,'old snapshot never recommends');
snapOld.generated_at=ago(121);
check(evalUs(snapOld).home.primary.kind,'unavailable','snapshot >120 minutes hides wait');
let failedSource=snapshot();failedSource.sources.cbp.status='error';
check(evalUs(failedSource).home.primary.kind,'unavailable','failed official source cannot retain current values');
check(evalUs(failedSource).suggested,null,'no suggestions from failed source');
let oldSource=snapshot();oldSource.sources.cbp.retrieved_at=ago(25);
check(evalUs(oldSource).home.nexus.kind,'stale','old source retrieval makes even recent reported wait stale');
check(evalUs(oldSource).suggested,null,'no cross-port advice from overdue source');
oldSource.sources.cbp.retrieved_at=ago(65);
check(evalUs(oldSource).home.nexus.kind,'old','old source collection cannot validate a recent observation');
let retained=snapshot();retained.sources.cbp={status:'error',retrieved_at:ago(1),last_success_at:ago(38),retained_previous:true};
check(evalUs(retained).home.nexus.kind,'old','failed source with verified previous report displays as OLD');
check(evalUs(retained).suggested,null,'cached report cannot recommend');
check(evalUs(retained).home.nexus.minutes,5,'cached previous number retains provenance');
retained.directions.us.tunnel.nexus={status:'closed',minutes:null,observation_at:null};
check(evalUs(retained).home.nexus.kind,'unavailable','do not carry forward an old closed NEXUS status');
retained.sources.cbp.last_success_at=ago(121);
check(evalUs(retained).home.standard.kind,'unavailable','expired source fallback rejected');
let future=snapshot();future.directions.us.tunnel.nexus.observation_at=iso(t+5*60000);
check(evalUs(future).home.nexus.kind,'unavailable','future observation rejected');
future=snapshot();future.generated_at=iso(t+5*60000);
check(evalUs(future).home.primary.kind,'unavailable','future snapshot rejected');
check(D.age(iso(t+30*1000),t),0,'30s clock skew tolerated');
check(D.age(iso(t+3*60000),t),Infinity,'excess future timestamp invalid');
let dwt=snapshot();dwt.supplemental.dwt.us={observation_at:ago(5),lane_counts:{nexus:1,car:2},travel_time_category:'< 20'};
dwt.sources.dwt={status:'ok',retrieved_at:ago(5)};
check(D.crossing(dwt,'us','tunnel',true,t).dwt.lane_counts.nexus,1,'fresh operator counts');
dwt.supplemental.dwt.us.observation_at=ago(27);
check(D.crossing(dwt,'us','tunnel',true,t).dwt,null,'old operator values not displayed');
check(D.countrySide(42.265,-83.05,70),'ca','Windsor');check(D.countrySide(42.48,-83.2,70),'us','Detroit');
check(D.countrySide(42.34,-83.055,70),null,'waterfront ambiguous');
function hours(now,rows){
 const snap=snapshot();const stamp=iso(now-5*60000);snap.generated_at=stamp;
 snap.sources.cbsa_hours={status:'ok',retrieved_at:stamp};
 snap.supplemental.cbsa_nexus_hours={tunnel:{groups:[{label:'Dedicated NEXUS lanes towards Canada',rows}]}};
 return snap;
}
const schedule=[{label:'Monday to Friday (except Holidays)',start:'07:00',end:'22:00'},
 {label:'Weekends and Holidays',start:'11:00',end:'19:00'}];
const at=(str)=>Date.parse(str);
let wed=at('2026-11-18T13:00:00Z');
check(D.publishedNexusWindow(hours(wed,schedule),'tunnel','ca',wed),'within_possible_window','weekday within');
let satNight=at('2026-11-21T02:00:00Z'); // Friday 9 PM EST: still weekday
check(D.publishedNexusWindow(hours(satNight,schedule),'tunnel','ca',satNight),'within_possible_window','Friday 9 PM allowed');
let sat=at('2026-11-22T02:00:00Z'); // Saturday 9 PM EST
check(D.publishedNexusWindow(hours(sat,schedule),'tunnel','ca',sat),'outside_all_published_windows','weekend 9 PM outside');
let satDay=at('2026-11-21T21:00:00Z'); // Saturday 4 PM EST
check(D.publishedNexusWindow(hours(satDay,schedule),'tunnel','ca',satDay),'within_possible_window','weekend 4 PM within');
let holiday=at('2026-12-25T14:00:00Z'); // Friday 9 AM Christmas
check(D.publishedNexusWindow(hours(holiday,schedule),'tunnel','ca',holiday),'outside_all_published_windows','Christmas weekday uses holiday hours');
let holidayNoon=at('2026-12-25T17:00:00Z');
check(D.publishedNexusWindow(hours(holidayNoon,schedule),'tunnel','ca',holidayNoon),'within_possible_window','Christmas noon within');
let holidayObs=at('2026-12-28T14:00:00Z');
check(D.publishedNexusWindow(hours(holidayObs,schedule),'tunnel','ca',holidayObs),'unknown','observed holiday ambiguity');
let futureYear=at('2028-01-04T14:00:00Z');
check(D.publishedNexusWindow(hours(futureYear,schedule),'tunnel','ca',futureYear),'unknown','year with unverified holiday calendar');
const overnight=[{label:'Monday to Friday',start:'22:00',end:'02:00'}];
let wedEarly=at('2026-11-18T06:00:00Z'); // Tue 1 AM
check(D.publishedNexusWindow(hours(wedEarly,overnight),'tunnel','ca',wedEarly),'within_possible_window','Tue overnight spill');
let sunEarly=at('2026-11-22T06:00:00Z'); // Sun 1 AM
check(D.publishedNexusWindow(hours(sunEarly,overnight),'tunnel','ca',sunEarly),'outside_all_published_windows','no Sat-to-Sun overnight weekday window');
check(D.publishedNexusWindow(hours(wed,schedule),'tunnel','us',wed),'unknown','NEXUS CA hours not valid USA bound');

const namedLanes=[
 {label:'Lane One\\nMonday to Friday\\n(except Holidays)',start:'07:00',end:'00:00'},
 {label:'Lane One\\nWeekends and Holidays',start:'08:00',end:'22:00'},
 {label:'Lane Two\\nMonday to Friday\\n(except holidays)',start:'14:00',end:'21:00'},
 {label:'Lane Three\\nMonday to Friday\\n(except holidays)',start:'15:00',end:'19:00'}
];
function ambassadorHours(atTime,rows=namedLanes){
 const s=hours(atTime,rows);
 s.supplemental.cbsa_nexus_hours={
  ambassador:{groups:[{label:'Dedicated NEXUS lanes towards Canada',rows}]}
 };
 return s;
}
const abAt=(str)=>{const when=at(str);return D.scheduledNexusLaneCount(
  ambassadorHours(when),'ambassador','ca',when);};
check(abAt('2026-11-19T17:00:00Z'),1,'Ambassador weekday noon: Lane One scheduled');
check(abAt('2026-11-19T21:00:00Z'),3,'Ambassador weekday 4 PM: three distinct lanes scheduled');
check(abAt('2026-11-20T01:00:00Z'),2,'Ambassador weekday 8 PM: two lanes scheduled');
check(abAt('2026-11-20T04:00:00Z'),1,'Ambassador weekday 11 PM: Lane One only');
check(abAt('2026-11-19T11:00:00Z'),null,'before the published lane schedule');
check(abAt('2026-11-21T21:00:00Z'),1,'weekend lane one is counted once');
check(abAt('2026-11-22T04:00:00Z'),null,'after weekend schedule closes');
check(abAt('2026-12-25T17:00:00Z'),1,'holiday uses lane-one holiday schedule');
check(abAt('2026-12-28T17:00:00Z'),null,'ambiguous observed holiday has no estimated count');
check(abAt('2026-03-08T18:00:00Z'),1,'DST weekend schedule uses Windsor local time');
const unknownWhen=at('2028-01-04T17:00:00Z');
check(D.scheduledNexusLaneCount(ambassadorHours(unknownWhen),'ambassador','ca',unknownWhen),
  null,'unverified holiday-calendar year never claims scheduled lanes');
const unnumbered=[...namedLanes,{label:'Monday to Friday',start:'07:00',end:'22:00'}];
check(D.scheduledNexusLaneCount(ambassadorHours(wed,unnumbered),'ambassador','ca',wed),
  null,'unnumbered CBSA lane hours cannot be counted');
check(D.scheduledNexusLaneCount(ambassadorHours(wed),'gordie','ca',wed),
  null,'Gordie Howe lane count not derivable from crossing-hours schedule');
check(D.scheduledNexusLaneCount(ambassadorHours(wed),'ambassador','us',wed),
  null,'Canada-bound schedule must never be assigned to the USA direction');
const outdatedAb=ambassadorHours(wed);
outdatedAb.sources.cbsa_hours.retrieved_at=iso(wed-49*60*60000);
check(D.scheduledNexusLaneCount(outdatedAb,'ambassador','ca',wed),
  null,'outdated CBSA schedule cannot yield lane count');

console.log(`RC1.4.8 decision-engine checks passed: ${checks}`);
