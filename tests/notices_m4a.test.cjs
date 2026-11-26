'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const D=require('../decision.js');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('dashboard.css','utf8');
const source=fs.readFileSync('dashboard.js','utf8');
new vm.Script(source);
for(const id of ['notices','noticeOpen','noticeText','noticesMore','noticesList','detailSchedule'])
 assert.ok(html.includes('id="'+id+'"'),'Missing M4a UI id '+id);
assert.match(html,/noticesMore"[^>]*aria-expanded="false"[^>]*aria-controls="noticesList"/);
assert.match(html,/dashboard\.js\?v=r2-v08-1/);
assert.match(html,/dashboard\.css\?v=r2-v08-1/);
assert.match(css,/\.notice-list-button/);
assert.match(css,/\.notice-more/);
// The new code must not create an unapproved automatic two-hour NEXUS alert.
assert.doesNotMatch(source,/scheduled to close in 2h|NEXUS_THRESHOLD_MINUTES|nexusNoticeLead/);

const injected=source.replace(/\ninit\(\);\n\}\)\(\);\s*$/,
 "\nwindow.__m4qa={store,classify,collectNotices,renderNotices};\n})();");
assert.notEqual(injected,source,'Cannot test M4a without injection');
const nodes=new Map();
const node=id=>{
 if(!nodes.has(id))nodes.set(id,{
  dataset:{},hidden:false,textContent:'',innerHTML:'',attributes:{},
  setAttribute(k,v){this.attributes[k]=String(v)},
  getAttribute(k){return this.attributes[k]},
  addEventListener(){},focus(){}
 });
 return nodes.get(id);
};
const dom={getElementById:node};
const ctx={window:{NexusDecision:D},document:dom,localStorage:{getItem(){return null}},Date,Number,Math,Intl,console};
vm.runInNewContext(injected,ctx,{filename:'dashboard.js'});
const qa=ctx.window.__m4qa;
const stamp=min=>new Date(Date.now()-min*60000).toISOString();
const report=(mins=0)=>({status:'reported',minutes:mins,observation_at:stamp(2)});
const fixture=()=>({
 generated_at:stamp(1),
 sources:{cbp:{status:'ok',retrieved_at:stamp(2)},cbsa:{status:'ok',retrieved_at:stamp(2)}},
 directions:{
  ca:{ambassador:{standard:report(0),port_status:'Closed'},tunnel:{standard:report(4)},gordie:{standard:report(8)}},
  us:{ambassador:{standard:report(3)},tunnel:{standard:report(6),notice:'construction near crossing'},
      gordie:{standard:report(10),port_status:'Temporarily Closed'}}
 }
});
qa.store.data=fixture();
let notices=qa.collectNotices(qa.store.data);
assert.equal(notices.length,3,'Two official port closures and one operational advisory');
assert.equal(notices[0].type,'closure');
assert.equal(notices[0].id,'ambassador');
assert.equal(notices[0].dir,'ca');
assert.equal(notices[1].type,'closure');
assert.equal(notices[1].id,'gordie');
assert.equal(notices[1].dir,'us');
assert.equal(notices[2].id,'tunnel');
assert.equal(notices[2].dir,'us');
assert.equal(notices[2].type,'advisory');
assert.equal(qa.classify('ambassador','ca').text,'Closure unverified','undated source-reported port closure withholds conflicting zero');
assert.equal(qa.classify('gordie','us').kind,'closure_unverified');

qa.renderNotices();
assert.equal(node('notices').hidden,false);
assert.equal(node('noticeOpen').dataset.crossing,'ambassador');
assert.equal(node('noticeOpen').dataset.direction,'ca');
assert.match(node('noticeText').textContent,/CBSA reports port closed/);
assert.equal(node('noticesMore').hidden,false);
assert.match(node('noticesMore').textContent,/Show 2 more notices/);
assert.equal(node('noticesMore').getAttribute('aria-expanded'),'false');
assert.equal(node('noticesList').hidden,true);

qa.store.noticesExpanded=true;
qa.renderNotices();
assert.equal(node('noticesList').hidden,false);
assert.equal(node('noticesMore').getAttribute('aria-expanded'),'true');
assert.equal((node('noticesList').innerHTML.match(/class="notice-list-button"/g)||[]).length,2);
assert.match(node('noticesList').innerHTML,/data-crossing="tunnel" data-direction="us"/);
assert.match(node('noticesList').innerHTML,/data-crossing="gordie" data-direction="us"/);

let old=qa.store.data;
old.sources.cbsa.retrieved_at=stamp(35);
notices=qa.collectNotices(old);
assert.equal(notices.length,2,'Stale CBSA status must not present as current notice');
assert.notEqual(qa.classify('ambassador','ca').kind,'closed','stale CBSA status must not override numeric cell');
old.generated_at=stamp(35);
assert.equal(qa.collectNotices(old).length,0,'Stale published snapshot cannot create notices');
qa.renderNotices();
assert.equal(node('notices').hidden,true);
assert.equal(qa.store.noticesExpanded,false,'Expansion resets when no current notices remain');

// A routine timetable or non-operational message must never become a disruption.
old=fixture();
delete old.directions.ca.ambassador.port_status;
delete old.directions.us.gordie.port_status;
old.directions.us.tunnel.notice='Ready Lane available from 7 am to 9 pm';
assert.equal(qa.collectNotices(old).length,0);
// Source payloads are never interpolated as trusted HTML into the expandable list.
old.directions.us.tunnel.notice='construction <img src=x onerror=alert(1)>';
assert.equal(qa.collectNotices(old).length,1);
qa.store.data=old;
qa.store.noticesExpanded=true;
qa.renderNotices();
assert.doesNotMatch(node('noticesList').innerHTML,/<img/);
assert.doesNotMatch(node('noticeText').textContent,/<img/);
console.log('M4a notice tests passed: severity, multiple directions, source freshness, closure override, expandable list and safe wording.');
