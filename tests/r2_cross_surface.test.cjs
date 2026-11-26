'use strict';
// Repeat the 21-case production audit against the exact R1 base and R2 adapters.
// No initialization, network or camera loading.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const NOW=Date.parse('2026-11-25T12:00:00Z');
class Clock extends Date{static now(){return NOW}}
const ago=m=>new Date(NOW-m*60000).toISOString();
function load(root){
 const c=vm.createContext({Date:Clock,Intl,console,localStorage:{getItem(){return null}},document:{documentElement:{dataset:{}}}});c.window=c;
 vm.runInContext(fs.readFileSync(path.join(root,'decision.js'),'utf8'),c);
 let m=fs.readFileSync(path.join(root,'dashboard.js'),'utf8');
 m=m.replace(/\ninit\(\);\s*\}\)\(\);\s*$/, '\nwindow.M={store,classify,displayModel,countFor,sortIds};\n})();');
 vm.runInContext(m,c);
 let b=fs.readFileSync(path.join(root,'board.js'),'utf8');b=b.slice(0,b.indexOf('  const cameraZoomSurface='));
 vm.runInContext(b+'\nwindow.C={set(d,dir){data=d;direction=dir},entry,operatorNexusLaneCount};})();',c);
 return c;
}
const before=load(process.argv[2]||'.'),after=load('.');
function payload(){const r={status:'reported',minutes:12,lanes_open:2,observation_at:ago(5)};return {generated_at:ago(5),sources:{cbp:{status:'ok',retrieved_at:ago(5),last_success_at:ago(5)},cbsa:{status:'ok',retrieved_at:ago(5),last_success_at:ago(5)},dwt:{status:'ok',retrieved_at:ago(5),last_success_at:ago(5)}},directions:{us:{tunnel:{standard:{...r},nexus:{...r}}},ca:{tunnel:{standard:{...r}}}},supplemental:{dwt:{ca:{observation_at:ago(5),lane_counts:{nexus:2,car:3}}}}};}
const raw=p=>p.directions.us.tunnel.standard;
const cases=[
 ['fresh zero',p=>raw(p).minutes=0,'current'],
 ['obs20',p=>raw(p).observation_at=ago(20),'current'],
 ['check20',p=>Object.assign(p.sources.cbp,{retrieved_at:ago(20),last_success_at:ago(20)}),'current'],
 ['snapshot20',p=>p.generated_at=ago(20),'current'],
 ['obs21',p=>raw(p).observation_at=ago(21),'stale'],
 ['obs120',p=>raw(p).observation_at=ago(120),'unavailable'],
 ['obs121',p=>raw(p).observation_at=ago(121),'unavailable'],
 ['check121',p=>Object.assign(p.sources.cbp,{retrieved_at:ago(121),last_success_at:ago(121)}),'unavailable'],
 ['retained121',p=>Object.assign(p.sources.cbp,{status:'error',retained_previous:true,last_success_at:ago(121)}),'unavailable'],
 ['retained10',p=>Object.assign(p.sources.cbp,{status:'error',retained_previous:true,last_success_at:ago(10)}),'stale'],
 ['missing obs',p=>delete raw(p).observation_at,'unavailable'],
 ['undated closure',p=>{Object.assign(raw(p),{status:'closed',minutes:null});delete raw(p).observation_at},'closure_unverified'],
 ['old closure',p=>Object.assign(raw(p),{status:'closed',minutes:null,observation_at:ago(40)}),'closure_unverified'],
 ['port closure',p=>p.directions.us.tunnel.port_status='Closed','closure_unverified'],
 ['old N/A',p=>{Object.assign(raw(p),{status:'not_applicable',minutes:null});Object.assign(p.sources.cbp,{retrieved_at:ago(60),last_success_at:ago(60)})},'unavailable'],
 ['101 lanes',p=>raw(p).lanes_open=101,'current'],
 ['future obs',p=>raw(p).observation_at=ago(-3),'unavailable']
];
function probe(c,p){
 c.M.store.data=p;c.M.store.vehicle='passenger';c.M.store.lane='regular';c.C.set(p,'us');
 const m=c.M.classify('tunnel','us','regular'),b=c.C.entry(raw(p),'regular','tunnel');
 return {main:m.kind,mainText:m.text,count:c.M.countFor(m),classic:b.kind,classicText:b.display+(b.unit?' '+b.unit:''),classicLanes:b.lanes};
}
const evidence=[];
for(const [name,mutate,expected] of cases){
 const p=payload();mutate(p);const old=probe(before,p),v=probe(after,p);
 assert.equal(v.main,expected,name);
 if(expected==='current'||expected==='stale'){
  assert.equal(v.classicText,v.mainText,name+' text parity');assert.equal(v.classic,expected==='stale'?'historical':'current');
  assert.equal(v.classicLanes,v.count===null?'Lanes not reported':v.count+' lanes reported');
 }else if(expected==='closure_unverified')assert.equal(v.classicText,'Closure unverified');
 else assert.equal(v.classic,'unavailable');
 evidence.push({name,baseline:old,candidate:v});
}
for(const [name,mutate,expected] of [
 ['DWT zero',p=>p.supplemental.dwt.ca.lane_counts.nexus=0,0],
 ['DWT 21',p=>p.supplemental.dwt.ca.lane_counts.nexus=21,null],
 ['DWT 20m',p=>p.supplemental.dwt.ca.observation_at=ago(20),2],
 ['DWT retained ok',p=>p.sources.dwt.retained_previous=true,null]]){
 const p=payload();mutate(p);before.C.set(p,'ca');after.C.set(p,'ca');
 const old=before.C.operatorNexusLaneCount('tunnel',NOW),v=after.C.operatorNexusLaneCount('tunnel',NOW);
 assert.equal(v,expected,name);assert.equal(after.NexusDecision.dwtNexusLane(p,'tunnel','ca','passenger','nexus',NOW).count,expected);
 evidence.push({name,baseline:old,candidate:v});
}
fs.mkdirSync('qa-artifacts',{recursive:true});fs.writeFileSync('qa-artifacts/r2-classifier-differential.json',JSON.stringify(evidence,null,2));
console.log('21 R1 baseline and R2 differential cases passed.');
