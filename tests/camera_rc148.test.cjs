'use strict';
// RC1.4.9: native DWT Play handoff. Actual cross-origin playback requires device QA.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('legacy.html','utf8');
const css=fs.readFileSync('styles.css','utf8');
new vm.Script(app);
for(const id of [
 '4aea1c45-d402-3690-afae-fe635942da82',
 '794566d4-a75e-3cd1-6f95-2d60e54f2fdb',
 '5408b5c3-f8d1-f34b-a18a-9943047905b6'
])assert.ok(app.includes(id),'Missing original DWT source '+id);
for(const id of [
 'tunnelCameraLauncher','tunnelPlayerHost','tunnelCameraHead','tunnelCameraFoot',
 'tunnelCameraTabs','tunnelCameraTitle','tunnelCameraMinimize','tunnelCameraStop',
 'tunnelCameraRetry','tunnelCameraDirect','tunnelCameraHint'
])assert.ok(html.includes('id="'+id+'"'),'Missing production tunnel component '+id);
for(const token of [
 'const TUNNEL_HANDOFF_MS=0;',
 "frame.referrerPolicy='no-referrer';",
 'function mountTunnelCamera(index){',
 'function syncTunnelLauncher(){',
 'function beginTunnelHandoff(frame,generation){',
 'function minimizeTunnelCamera(){',
 'function expandTunnelCamera(kind){',
 'tunnelHandoffTimer=setTimeout',
 'tunnelGeneration++;',
 'if(tunnelFrame)tunnelFrame.remove();',
 "if(id==='tunnel'){openTunnelFromButton();return;}",
 "if(frame&&document.activeElement===frame)beginTunnelHandoff(frame,generation);",
 "frame.addEventListener('focus'",
 "if(tunnelMode==='expanded')mountTunnelCamera(Number(b.dataset.index));",
 "if(tunnelMode==='expanded'&&tunnelIndex>=0)mountTunnelCamera(tunnelIndex);",
 "if(camera===expectedCamera && cameraIndex===expectedIndex",
 "tunnelMode='stopped';tunnelDirection=prefs.direction;",
 "if(!tunnelFrame&&tunnelMode!=='stopped')mountTunnelCamera"
])assert.ok(app.includes(token),'Missing production behavior: '+token);
assert.ok(!app.includes('startTunnelVideo')&&!app.includes('cameraTimeout'),'Old 15-second DWT behavior must be retired');
assert.ok(html.includes('allow="autoplay; fullscreen; encrypted-media; picture-in-picture"'),'Bridge iframe untouched');
assert.ok(html.includes('data-scale="4"')&&app.includes('const BRIDGE_DEFAULT_ZOOM=4'),'Bridge zoom preserved');
assert.ok(app.includes('left:0.20,up:0.50'),'Bridge framing unchanged');
assert.ok(css.includes('.camera-watch-button'),'Old non-tunnel styling retained');
assert.ok(css.includes('scale(6)')&&css.includes('pointer-events:none'),'Native Play button must be pointer transparent');
assert.ok(css.includes('.tunnel-player-host.is-expanded')&&!css.includes('#tunnelShade'),'Camera must not have a dark overlay');
assert.ok(html.includes('app.js?v=rc149')&&html.includes('styles.css?v=rc149'),'Cache bust required');
console.log('RC1.4.9 DWT native-Play integration static checks passed.');
