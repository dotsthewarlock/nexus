'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('camera-one-tap-lab.html','utf8');
const app=fs.readFileSync('app.js','utf8');
const workflow=fs.readFileSync('.github/workflows/publish.yml','utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length,1);
const js=scripts[0][1];new vm.Script(js);
for(const id of ['camera','size','zoom','x','y','delay','trigger','tile','player','load','unload','expand','arm','minimize','backdrop','playResult','expandResult','continuity','copy','report']){
 assert.ok(html.includes('id="'+id+'"'),'missing '+id);
}
for(const id of ['4aea1c45-d402-3690-afae-fe635942da82','794566d4-a75e-3cd1-6f95-2d60e54f2fdb','5408b5c3-f8d1-f34b-a18a-9943047905b6'])assert.ok(html.includes(id)&&app.includes(id));
assert.ok(html.includes('referrerpolicy="no-referrer"'));
assert.ok(js.includes("document.activeElement"));
assert.ok(js.includes("window.addEventListener('blur'"));
assert.ok(js.includes("setTimeout(()=>{pending=null;if(loaded&&!expanded)expand(true,'iframe focus');},delay)"));
assert.ok(js.includes("$('tile').classList.toggle('expanded',next)"));
assert.ok(!js.includes("appendChild("),'iframe must never be reparented');
assert.ok(!/\.m3u8|\.mpd|XMLHttpRequest|fetch\s*\(|document\.cookie/.test(js));
for(const id of ['preset','applyPreset','saveTrial','clearTrials','trialSummary','saveState']){
 assert.ok(html.includes('id="'+id+'"'),'missing permutation UI: '+id);
}
for(const preset of ['A','B','C','D','E','F','G']){
 assert.ok(html.includes('<option value="'+preset+'"'),'missing preset '+preset);
}
for(const token of [
 'const PRESETS={',
 "function applyPreset(){",
 "function saveTrial(){",
 "function persistTrials(){",
 "function renderTrials(){",
 "sessionStorage.setItem(STORE",
 "'Saved trials for this camera:'",
 "cancelPending();",
 "armed=loaded&&p.trigger==='focus'",
 "trials[camera]=trials[camera].slice(-25)"
]){
 assert.ok(js.includes(token),'missing preset/diagnostic behaviour: '+token);
}
assert.ok(!js.includes("appendChild($('player')"),'zoom/expand must not move iframe');
assert.ok(workflow.includes('node tests/camera_one_tap.test.cjs'));
assert.ok(workflow.includes('cp camera-one-tap-lab.html site/'));
console.log('One-tap lab static checks passed.');
