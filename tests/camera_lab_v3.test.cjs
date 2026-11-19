'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('camera-lab-v3.html','utf8');
const workflow=fs.readFileSync('.github/workflows/publish.yml','utf8');
const app=fs.readFileSync('app.js','utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(scripts.length,3,'the diagnostic must have three well-defined inline scripts');
for(const src of scripts)new vm.Script(src,{filename:'camera-lab-v3.html'});
const modes=['parser-ui','parser-legacy','dynamic-ui','api-default','api-sized','iframe-ui','iframe-legacy','direct-same','direct-new'];
for(const name of modes)assert.ok(html.includes("id:'"+name+"'"),'case missing '+name);
for(const id of ['4aea1c45-d402-3690-afae-fe635942da82','794566d4-a75e-3cd1-6f95-2d60e54f2fdb','5408b5c3-f8d1-f34b-a18a-9943047905b6']){
 assert.ok(html.includes(id),'missing stream '+id);
 assert.ok(app.includes(id),'stream differs from production');
}
for(const id of ['stream','tests','playerStage','playerMount','result','next','stop','copy','reset','events','report']){
 assert.ok(html.includes('id="'+id+'"'),'control missing '+id);
}
assert.ok(html.includes('window.dacast(contentId()'),'explicit Dacast JS API test missing');
for(const event of ['onReady','onPlay','onError'])assert.ok(html.includes(event));
assert.ok(html.includes('document.write(markup)'),'parser-time embed missing');
assert.ok(html.includes("document.documentElement.classList.add('case-active')"),'player cannot start hidden');
assert.ok(html.includes('sessionStorage.setItem(STORE'),'persistence absent');
assert.ok(html.includes("target='_blank'"),'new-tab test missing');
assert.ok(html.includes('location.assign(directUrl())'),'same-tab test missing');
assert.ok(!/XMLHttpRequest|\.m3u8|\.mpd|serviceWorker|document\.cookie/.test(html),'do not extract media or create proxies');
assert.ok(workflow.includes('cp camera-lab-v3.html site/'),'new page not deployed');
assert.ok(workflow.includes('node tests/camera_lab_v3.test.cjs'),'diagnostic not tested in CI');
assert.ok(workflow.includes('cp index.html styles.css app.js decision.js camera-diagnostics.html site/'),'original camera deploy command changed');
console.log('Camera Lab 3 static checks passed: 9 variants, JS syntax, isolation and staging.');
