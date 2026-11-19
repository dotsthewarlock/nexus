'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('camera-player-control-lab.html','utf8');
const app=fs.readFileSync('app.js','utf8');
const workflow=fs.readFileSync('.github/workflows/publish.yml','utf8');
const regression=fs.readFileSync('.github/workflows/tests.yml','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'expected exactly one diagnostic JS section');
assert.equal((html.match(/<script>/g)||[]).length,1);
new vm.Script(script,{filename:'camera-player-control-lab.html'});
for(const id of ['camera','case','open','dialog','stage','videoState','apiPlay','outcome','notes','copy','reset','report']){
 assert.ok(html.includes('id="'+id+'"'),'control missing: '+id);
}
for(const id of [
 '4aea1c45-d402-3690-afae-fe635942da82',
 '794566d4-a75e-3cd1-6f95-2d60e54f2fdb',
 '5408b5c3-f8d1-f34b-a18a-9943047905b6'
]){
 assert.ok(html.includes(id),'diagnostic missing camera');
 assert.ok(app.includes(id),'diagnostic source diverged from app');
}
for(const s of [
 "frame.referrerPolicy='no-referrer'",
 "frame.allow='autoplay; encrypted-media; fullscreen; picture-in-picture'",
 'dlg.showModal()',
 'dlg.addEventListener(\'close\'',
 'frame.contentWindow.document',
 'frame.dispatchEvent',
 'https://prod-player.dacast.com/js/player.js',
 'player.onReady(',
 'player.muteOn()',
 'player.play()',
 'player.onPlay(',
 'player.onError(',
 'sessionStorage.setItem(STORE',
 'NOT proof of video playback'
]){
 assert.ok(script.includes(s),'required diagnostic or caveat missing: '+s);
}
assert.ok(!/\.m3u8|\.mpd|XMLHttpRequest|fetch\s*\(|serviceWorker|document\.cookie/.test(script),'do not proxy, extract or access credentials');
assert.ok(html.includes('id="apiPlay" type="button" class="secondary" hidden'),'API Play must be hidden but not disabled by default');
assert.ok(!html.includes('id="apiPlay" type="button" class="secondary" disabled'),'API Play must not be permanently disabled');
for(const label of ['value="api_no_ready"','value="api_setup_failed"','id="apiStatus"']){
 assert.ok(html.includes(label),'API diagnostic control missing: '+label);
}
assert.ok(script.includes("$('apiPlay').hidden=false;"),'API Play must be visible on E/F immediately');
assert.ok(script.includes("$('apiPlay').disabled=false;"),'API Play must be enabled without requiring onReady');
assert.ok(script.includes('if(!activePlayer||typeof activePlayer.play!==\'function\')'),'missing explicit no-instance result');
assert.ok(!script.includes('if(!playerReady||!activePlayer)'),'API Play must never be gated by readiness');
assert.ok(script.includes("readyTimer=setTimeout("),'missing finite ready-event timeout');
assert.ok(script.includes("setApiPhase('setup_failed'"),'API setup failure must be logged separately');
assert.ok(regression.includes('node tests/camera_player_control.test.cjs'),'CI regression test absent');
assert.ok(workflow.includes('cp camera-player-control-lab.html site/'),'Pages staging absent');
console.log('DWT control lab checks passed: modal, interaction limits, documented API and publishing.');
