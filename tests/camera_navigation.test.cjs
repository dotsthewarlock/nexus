'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('camera-navigation-lab.html','utf8');
const app=fs.readFileSync('app.js','utf8');
const workflow=fs.readFileSync('.github/workflows/publish.yml','utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(scripts.length,1,'one self-contained script expected');
new vm.Script(scripts[0],{filename:'camera-navigation-lab.html'});
const code=scripts[0];
for(const token of ["id:'A'","id:'B'","id:'C'","id:'D'","id:'E'","id:'F'","id:'G'","id:'H'","id:'I'","id:'J'"]){
  assert.ok(code.includes(token),'test missing '+token);
}
for(const id of ['camera','case','launchLink','launchButton','outcome','notes','saveNext','save','results','copy','reset','report']){
  assert.ok(html.includes('id="'+id+'"'),'element missing '+id);
}
for(const id of ['4aea1c45-d402-3690-afae-fe635942da82','794566d4-a75e-3cd1-6f95-2d60e54f2fdb','5408b5c3-f8d1-f34b-a18a-9943047905b6']){
 assert.ok(code.includes(id),'diagnostic missing stream '+id);
 assert.ok(app.includes(id),'stream not present in production');
}
assert.ok(code.includes("rel:'noreferrer'"),'same-tab referrer test missing');
assert.ok(code.includes("policy:'no-referrer'"),'explicit referrer-policy test missing');
assert.ok(code.includes("rel:'noopener noreferrer'"),'known-working control missing');
assert.ok(code.includes("rel:'noopener'"),'new-tab with referrer test missing');
assert.ok(code.includes("window.open(cameraUrl(),'_blank','noopener,noreferrer')"),'window-open test missing');
assert.ok(code.includes('location.assign(cameraUrl())'),'existing H control missing');
assert.ok(code.includes('sessionStorage.setItem(STORE'),'results persistence missing');
assert.ok(code.includes("results={};launchCount=0;selected='A'"),'camera change must clear outcomes');
assert.ok(!/fetch\s*\(|XMLHttpRequest|\.m3u8|\.mpd|serviceWorker|document\.cookie|<iframe/i.test(code),'no media/proxy internals');
assert.ok(workflow.includes('cp camera-navigation-lab.html site/'),'new diagnostic not deployed');
assert.ok(workflow.includes('node tests/camera_navigation.test.cjs'),'new test not wired into workflow');
assert.ok(workflow.includes('cp index.html styles.css app.js decision.js camera-diagnostics.html site/'),'original diagnostic staging preserved');
console.log('DWT navigation matrix checks passed: 10 cases; JavaScript syntax; camera parity; safe staging.');
