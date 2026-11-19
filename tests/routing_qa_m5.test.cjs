'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Routing=require('../routing.js');
const D=require('../decision.js');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('dashboard.css','utf8');
const js=fs.readFileSync('dashboard.js','utf8');

for(const id of ['routeQaDetails','routeQaPlatform','routeQaGrid','routeQaExport','routeQaClear','routeQaReport','routeQaReportLabel','routeQaFeedback'])
 assert.ok(html.includes('id="'+id+'"'),id+' is missing from the Settings diagnostics');
assert.match(html,/dashboard\.js\?v=m5-routeqa/);
assert.match(html,/dashboard\.css\?v=m5-routeqa/);
assert.match(html,/Never test while driving/);
assert.match(html,/Nothing is sent to Nexus or GitHub automatically/);
assert.match(css,/\.route-qa-case/);
assert.match(css,/@media\(max-width:360px\)/);
assert.doesNotMatch(js,/navigator\.geolocation|window\.open\(/,'No GPS or scripted popup route handoff');
new vm.Script(js);

const injected=js.replace(/\ninit\(\);\n\}\)\(\);\s*$/,
 '\nwindow.__qaTest={routeQaKey,routeQaLinks,loadRouteQa,routeQaInput,renderRouteQa,routeQaReport,initRouteQa};\n})();');
assert.notEqual(injected,js,'Unable to instrument route QA fixture');
const backing={};
const storage={
 getItem:k=>Object.prototype.hasOwnProperty.call(backing,k)?backing[k]:null,
 setItem:(k,v)=>{backing[k]=String(v)},
 removeItem:k=>{delete backing[k]}
};
const nodes=new Map();
function el(id){
 if(!nodes.has(id))nodes.set(id,{
  id,open:false,hidden:false,value:'',innerHTML:'',textContent:'',
  events:{},addEventListener(type,fn){this.events[type]=fn},
  setAttribute(name,value){this[name]=String(value)},
  focus(){this.focused=true},select(){this.selected=true},
  showModal(){this.open=true}
 });
 return nodes.get(id);
}
const doc={getElementById:el};
const win={NexusDecision:D,NexusRouting:Routing,location:{search:''},confirm:()=>true};
vm.runInNewContext(injected,{window:win,document:doc,localStorage:storage,
 Date,Math,Number,Intl,URL,URLSearchParams,console},{filename:'dashboard.js'});
const api=win.__qaTest;
el('routeQaPlatform').value='android';
el('routeQaDetails').open=true;
api.initRouteQa();

const ids=['ambassador','tunnel','gordie'],directions=['ca','us'];
for(const id of ids)for(const dir of directions){
 const links=api.routeQaLinks(id,dir);
 assert.equal(links.guaranteed,false,'A named Maps waypoint never verifies crossing enforcement');
 const actual=new URL(links.actual);
 const fixed=new URL(links.preview);
 for(const link of [actual,fixed]){
  assert.equal(link.origin,'https://www.google.com');
  assert.equal(link.pathname,'/maps/dir/');
  assert.equal(link.searchParams.get('api'),'1');
  assert.equal(link.searchParams.get('travelmode'),'driving');
  assert.equal(link.searchParams.get('waypoints'),Routing.CROSSINGS[id].waypoint);
  assert.equal(link.searchParams.has('dir_action'),false,'Never automatically start navigation');
 }
 assert.equal(actual.searchParams.has('origin'),false,'Exact production-style link leaves origin unspecified');
 assert.equal(fixed.searchParams.get('origin'),
  dir==='us'?'Windsor, Ontario, Canada':'Detroit, Michigan, USA',
  'Fixed-origin preview uses a public city on the opposite side of border');
 assert.equal(fixed.searchParams.get('destination'),
  dir==='us'?'Detroit, Michigan, USA':'Windsor, Ontario, Canada');
 assert.equal(links.actual,Routing.prepare({crossing:id,direction:dir,
  destination:{country:dir,address:fixed.searchParams.get('destination')}}).url);
}
api.renderRouteQa();
assert.equal((el('routeQaGrid').innerHTML.match(/class="route-qa-case"/g)||[]).length,6);
assert.equal((el('routeQaGrid').innerHTML.match(/rel="noopener noreferrer"/g)||[]).length,12);
assert.match(el('routeQaGrid').innerHTML,/Nexus-style link/);
assert.match(el('routeQaGrid').innerHTML,/Fixed-origin preview/);
assert.doesNotMatch(el('routeQaGrid').innerHTML,/private.*home.*address/i);

const key=api.routeQaKey('android','tunnel','us');
api.routeQaInput({target:{dataset:{routeqaKey:key,routeqaField:'outcome'},value:'wrong_crossing'}});
api.routeQaInput({target:{dataset:{routeqaKey:key,routeqaField:'note'},value:'Opened a different crossing.'}});
assert.ok(backing['nexus-route-qa-v1']);
const saved=JSON.parse(backing['nexus-route-qa-v1']);
assert.equal(saved.version,1);
assert.equal(saved.results[key].outcome,'wrong_crossing');
assert.equal(saved.results[key].note,'Opened a different crossing.');
const report=api.routeQaReport();
assert.equal(report.cases.length,6);
assert.equal(report.platform,'android');
assert.equal(report.cases.find(x=>x.crossing==='tunnel'&&x.direction==='us').outcome,'wrong_crossing');
assert.match(report.status,/not independently verified/);
assert.equal(JSON.stringify(report).includes('Nexus-style link'),false,'Report excludes URLs');
assert.equal(JSON.stringify(report).includes('Windsor, Ontario'),false,'Report excludes test addresses');

const iosKey=api.routeQaKey('ios','tunnel','us');
el('routeQaPlatform').value='ios';
const iosReport=api.routeQaReport();
assert.equal(iosReport.cases.find(x=>x.crossing==='tunnel'&&x.direction==='us').outcome,'not_tested');
api.routeQaInput({target:{dataset:{routeqaKey:iosKey,routeqaField:'outcome'},value:'preview_correct'}});
el('routeQaPlatform').value='android';
assert.equal(api.routeQaReport().cases.find(x=>x.crossing==='tunnel'&&x.direction==='us').outcome,'wrong_crossing',
 'One device/platform result must not overwrite another platform');

const hostile='<img src=x onerror=alert(1)>';
api.routeQaInput({target:{dataset:{routeqaKey:key,routeqaField:'note'},value:hostile}});
api.renderRouteQa();
assert.doesNotMatch(el('routeQaGrid').innerHTML,/<img/,'User-supplied notes must be escaped');
assert.match(el('routeQaGrid').innerHTML,/&lt;img/);
api.routeQaInput({target:{dataset:{routeqaKey:key,routeqaField:'outcome'},value:'invalid_unrecognized'}});
assert.equal(api.routeQaReport().cases.find(x=>x.crossing==='tunnel'&&x.direction==='us').outcome,'wrong_crossing',
 'Unrecognized result categories rejected');

assert.equal(api.routeQaKey('android','ambassador','ca'),'android:ambassador:ca');
assert.throws(()=>api.routeQaKey('other','ambassador','ca'));
assert.throws(()=>api.routeQaKey('android','bluewater','ca'));

const wf=fs.readFileSync('.github/workflows/publish.yml','utf8');
assert.doesNotMatch(wf,/route-qa\.js|route-qa\.html/,'Existing staging remains unchanged');
assert.match(wf,/Audit scheduled collection cadence/);
console.log('Route QA lab checks passed: six paired links, Android/iOS isolation, safe local results and no workflow change.');
