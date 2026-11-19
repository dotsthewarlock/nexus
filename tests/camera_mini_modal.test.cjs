'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('camera-mini-modal-lab.html','utf8');
const app=fs.readFileSync('app.js','utf8');
const workflow=fs.readFileSync('.github/workflows/publish.yml','utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length,1,'one self-contained diagnostic script');
const js=scripts[0][1];
new vm.Script(js,{filename:'camera-mini-modal-lab.html'});
for(const id of ['camera','mode','load','unload','viewer','shade','expand','previewHit','closeExpanded','modalMinimize','frameHost','miniResult','expandResult','collapseResult','buttonResult','copy','reset','report']){
 assert.ok(html.includes('id="'+id+'"'),'missing UI control: '+id);
}
for(const id of ['4aea1c45-d402-3690-afae-fe635942da82','794566d4-a75e-3cd1-6f95-2d60e54f2fdb','5408b5c3-f8d1-f34b-a18a-9943047905b6']){
 assert.ok(html.includes(id)&&app.includes(id),'camera ID inconsistent with production');
}
assert.ok(js.includes("iframe.referrerPolicy='no-referrer'"),'working M1 policy not retained');
assert.ok(js.includes("iframe.allow='autoplay; encrypted-media; fullscreen; picture-in-picture'"),'M1 iframe permissions missing');
assert.ok(js.includes("frame=iframe;"),'single iframe reference must be kept');
assert.ok(js.includes("$('viewer').classList.toggle('expanded',expanded)"),'CSS-only expansion required');
assert.ok(js.includes("$('frameHost').appendChild(iframe)"),'single insertion into host required');
assert.ok(!js.includes("appendChild(frame)"),'must not move iframe between containers');
assert.ok(js.includes("$('frameHost').replaceChildren()"),'iframe must be unloaded explicitly');
assert.ok(js.includes("iframe.addEventListener('load'"),'reload detection required');
assert.ok(js.includes("sessionStorage.setItem(STORE"),'per-tab report persistence required');
assert.ok(!/\.m3u8|\.mpd|XMLHttpRequest|fetch\s*\(|document\.cookie|serviceWorker/.test(js),'no stream extraction or network proxy');
assert.ok(workflow.includes('node tests/camera_mini_modal.test.cjs'),'publishing CI test missing');
assert.ok(workflow.includes('cp camera-mini-modal-lab.html site/'),'diagnostic not staged in GitHub Pages');
console.log('DWT mini-modal lab passed: one iframe, CSS-only resize, explicit manual playback result and Pages staging.');
