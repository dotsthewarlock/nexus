// RC1.4.6 preserves RC1.4.5 camera source regression checks. The provider playback requires device QA.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('styles.css','utf8');
for(const id of ['4aea1c45-d402-3690-afae-fe635942da82','794566d4-a75e-3cd1-6f95-2d60e54f2fdb','5408b5c3-f8d1-f34b-a18a-9943047905b6'])
  assert(app.includes(id),`Missing original DWT source ${id}`);
assert(app.includes('function startTunnelVideo()'));
assert(app.includes("$('cameraWatch').addEventListener('click',startTunnelVideo)"));
assert(app.includes("$('cameraContinue').addEventListener('click',startTunnelVideo)"));
assert(app.includes('cameraTimeout=setTimeout'), '15-second viewing cycle missing');
assert(html.includes('id="cameraWatch"'));
assert(html.includes('allow="autoplay; fullscreen; encrypted-media; picture-in-picture"'));
assert(html.includes('data-scale="4"') && html.includes('data-scale="3"') && html.includes('data-scale="2"') && html.includes('data-scale="1"'));
assert(app.includes('const BRIDGE_DEFAULT_ZOOM=4'));
assert(app.includes('left:0.20,up:0.50'));
assert(css.includes('.camera-watch-button'));
assert(html.includes('app.js?v=rc146') && html.includes('styles.css?v=rc146'));
console.log('RC1.4.5 camera source assertions passed');
