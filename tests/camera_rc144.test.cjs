// Camera source and UX invariants for RC1.4.4 (no external network required).
const fs=require('node:fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('styles.css','utf8');
for(const id of ['4aea1c45-d402-3690-afae-fe635942da82','794566d4-a75e-3cd1-6f95-2d60e54f2fdb','5408b5c3-f8d1-f34b-a18a-9943047905b6'])
  assert(app.includes(id),`Missing original RC1.4 DWT Dacast source ${id}`);
assert(app.includes('limit:15'), 'RC1.4 viewing period must be restored');
assert(app.includes('cameraTimeout=setTimeout'), 'DWT 15-second timer missing');
assert(app.includes('cameraContinue'), 'Continue watching action missing');
assert(!app.includes('externalOnly:true'), 'DWT must use in-app camera player');
assert(html.includes('allow="autoplay; fullscreen; encrypted-media; picture-in-picture"'), 'Original RC1.4 iframe permissions missing');
assert(html.includes('id="cameraContinue"'), 'Continue watching button missing');
assert(html.includes('id="cameraZoomControls"'), 'Bridge zoom buttons missing');
assert(html.includes('data-scale="3"') && html.includes('data-scale="2"') && html.includes('data-scale="1"'));
assert(app.includes('if(enable)setBridgeScale(3)'), 'Bridge must default to 3x');
assert(css.includes('height:90dvh'), 'Compact bridge mobile modal missing');
assert(css.includes('aspect-ratio:4/3'), '4:3 iframe framing missing');
assert(html.includes('app.js?v=rc144') && html.includes('styles.css?v=rc144'), 'Asset version stale');
console.log('RC1.4.4 camera-source regression assertions passed');
