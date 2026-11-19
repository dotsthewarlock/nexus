'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('camera-alternatives.html','utf8');
const app=fs.readFileSync('app.js','utf8');
const workflow=fs.readFileSync('.github/workflows/publish.yml','utf8');
const selectors=['resultE','resultF','resultG','jsTest','sameTab','newTab','camera','copy','report'];
for(const id of selectors)assert.match(html,new RegExp('id="'+id+'"'));
for(const id of ['4aea1c45-d402-3690-afae-fe635942da82','794566d4-a75e-3cd1-6f95-2d60e54f2fdb','5408b5c3-f8d1-f34b-a18a-9943047905b6']){
  assert.ok(html.includes(id),'diagnostic missing '+id);
  assert.ok(app.includes(id),'production source missing '+id);
}
assert.ok(html.includes('prod-player.dacast.com/js/player.js?contentId='));
assert.ok(html.includes('location.assign(direct())'));
assert.ok(html.includes('sessionStorage'));
assert.ok(html.includes('target="_blank"'));
assert.ok(!/fetch\s*\(|XMLHttpRequest|serviceWorker|document\.cookie|proxy/i.test(html.match(/<script>([\s\S]*?)<\/script>/)?.[1]||''),'diagnostic must not fetch or proxy camera content');
assert.ok(workflow.includes('camera-alternatives.html site/'),'diagnostic must be staged for Pages');
const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(js,'inline diagnostic code expected');
new (require('node:vm').Script)(js);
console.log('DWT alternatives diagnostic source and JavaScript syntax checks passed.');
