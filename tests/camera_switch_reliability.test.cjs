'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('camera-switch-reliability.html','utf8');
const workflow=fs.readFileSync('.github/workflows/publish.yml','utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length,1,'single inline diagnostic controller');
const js=scripts[0][1];new vm.Script(js);
for(const id of [
 'strategy','sequence','cameraName','pill','playerHost','reopen',
 'modalBar','minimize','restart','restartModal','manualExpand',
 'launchOutcome','reopenOutcome','notes','next','restartSequence',
 'matrix','report','copy','clearResults','external'
]){
 assert.ok(html.includes('id="'+id+'"'),'missing UI id '+id);
}
for(const id of [
 '4aea1c45-d402-3690-afae-fe635942da82',
 '794566d4-a75e-3cd1-6f95-2d60e54f2fdb'
])assert.ok(html.includes(id),'missing official DWT camera ID '+id);
for(const token of [
 "const STEPS=['A','B','A','B','A','B','A'];",
 "if(data.strategy==='control'&&!forceFresh&&prior){",
 "frame.src=source();",
 "if(prior)prior.remove();",
 "frame=makeFrame(session);",
 "host.replaceChildren(frame);",
 "if(session===state.token&&state.mode==='launching')expand('first');",
 "if(frame!==next||state.token!==session)",
 "host.classList.add('collapsed');",
 "host.classList.add('expanded');",
 "const session=++state.token;",
 "cancelPending();",
 "next.referrerPolicy='no-referrer';",
 "next.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';",
 "next.loading='eager';",
 "sessionStorage.setItem(STORE",
 "navigator.clipboard.writeText(report())"
])assert.ok(js.includes(token),'missing regression guarantee: '+token);
assert.ok(html.includes('scale(6)'),'same 6x native-play crop');
assert.ok(!html.includes('5408b5c3-f8d1-f34b-a18a-9943047905b6'),'Randolph camera must be excluded');
assert.ok(!html.includes('Randolph'),'UI must not mention camera C');
assert.ok(!html.includes('isolation:isolate'),'modal host must not be trapped below backdrop');
assert.ok(html.includes('z-index:1003')&&html.includes('z-index:1004'),'player and modal controls must have distinct overlay layers');
assert.ok(!html.includes('id="shade"')&&!html.includes('#shade')&&!js.includes("$('shade')"),'no backdrop or shade allowed in this diagnostic');
assert.ok(html.includes('value="stuck_paused"'),'record hard-paused playback failures');
assert.ok(js.includes("const STORE='nexus-dwt-switch-reliability-v2';"),'avoid mapping prior C results to B');
assert.ok(html.includes("180);"),'same brief gesture-settling period');
assert.ok(html.includes("1500);"),'same first-launch handoff');
assert.ok(!/XMLHttpRequest|fetch\s*\(|\.m3u8|\.mpd|dispatchEvent\s*\(|document\.cookie/.test(js));
assert.ok(workflow.includes('node tests/camera_switch_reliability.test.cjs'),'test must run in CI');
assert.ok(workflow.includes('cp camera-switch-reliability.html site/'),'diagnostic must be staged for Pages');
console.log('Camera-switch reliability lab static checks passed.');
