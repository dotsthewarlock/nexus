'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('camera-modal-viability.html','utf8');
const app=fs.readFileSync('app.js','utf8');
const workflow=fs.readFileSync('.github/workflows/publish.yml','utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(scripts.length,1,'single standalone application script expected');
new vm.Script(scripts[0],{filename:'camera-modal-viability.html'});
for(const id of ['camera','videoDialog','handoffDialog','videoStage','tryModal','tryPopup','tryHandoff','pipLink','handoffLink','resultM1','resultP2','resultH3','resultV4','notes','copy','reset','report']){
 assert.ok(html.includes('id="'+id+'"'),'expected control missing: '+id);
}
for(const id of ['4aea1c45-d402-3690-afae-fe635942da82','794566d4-a75e-3cd1-6f95-2d60e54f2fdb','5408b5c3-f8d1-f34b-a18a-9943047905b6']){
 assert.ok(html.includes(id),'diagnostic stream missing');
 assert.ok(app.includes(id),'stream diverged from production');
}
const js=scripts[0];
assert.ok(js.includes("frame.referrerPolicy='no-referrer'"),'modal must test specifically new referrer-policy variable');
assert.ok(js.includes("videoDialog.showModal()"),'native in-page modal is required');
assert.ok(js.includes("videoDialog.addEventListener('close',"),'iframe must be unloaded on close');
assert.ok(js.includes("unloadVideo()"),'unload on close is required');
assert.ok(js.includes("popup=yes,width=480,height=320,noopener,noreferrer"),'safe standalone popup test is required');
assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'),'functional new-tab fallback is required');
assert.ok(js.includes('handoffDialog.showModal()'),'handoff must open a real modal');
assert.ok(js.includes('sessionStorage.setItem(STORE'),'per-tab results persistence required');
assert.ok(js.includes('results[currentCamera()]'),'camera-scoped reports required');
assert.ok(js.includes('Iframe load and window.open results are NOT proof of video playback.'),'manual-only playback reporting required');
assert.ok(!/\.m3u8|\.mpd|XMLHttpRequest|fetch\s*\(|serviceWorker|document\.cookie|credentialless/.test(js),'no proxy, extraction or speculative auth changes');
assert.ok(workflow.includes('node tests/camera_modal_viability.test.cjs'),'workflow missing regression test');
assert.ok(workflow.includes('cp camera-modal-viability.html site/'),'workflow missing new page');
assert.ok(workflow.includes('cp index.html styles.css app.js decision.js camera-diagnostics.html site/'),'legacy production publishing command changed');
console.log('DWT modal viability checks passed: isolated modal, popup, handoff and native PiP trials.');
