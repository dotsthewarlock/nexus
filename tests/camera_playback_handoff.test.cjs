'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('camera-playback-handoff.html','utf8');
const workflow=fs.readFileSync('.github/workflows/publish.yml','utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length,1,'one diagnostic controller');
const js=scripts[0][1];
new vm.Script(js);
for(const id of ['mode','sequence','cameraName','pill','playerHost','reopen',
 'firstResult','rescueResult','reopenResult','notes','next','resetMode',
 'copy','report','matrix','minimize','restart','restartModal','external']){
 assert.ok(html.includes('id="'+id+'"'),'missing UI id '+id);
}
for(const id of ['4aea1c45-d402-3690-afae-fe635942da82',
 '794566d4-a75e-3cd1-6f95-2d60e54f2fdb',
 '5408b5c3-f8d1-f34b-a18a-9943047905b6']){
 assert.ok(html.includes(id),'missing camera '+id);
}
for(const token of [
 "const STEPS=['A','B','C','A','B','C','A','B','C'];",
 "const MODES=['hide','keep'];",
 "if(saved.mode==='hide'){",
 "host.classList.add('launch-hide');",
 "},180);",
 "},500);",
 "host.classList.add('expanded');",
 "host.classList.add('minimized');",
 "next.referrerPolicy='no-referrer';",
 "next.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';",
 "if(next!==frame||generation!==st.generation)return;",
 "st.generation++;",
 "if(prior)prior.remove();",
 "frame=createFrame(st.generation);",
 "host.replaceChildren(frame);",
 "saveFields();",
 "sessionStorage.setItem(KEY",
 "navigator.clipboard.writeText(report())"
]){
 assert.ok(js.includes(token),'missing regression guarantee: '+token);
}
assert.ok(html.includes('scale(6)'),'preserve 6x crop');
assert.ok(html.includes('value="idle"'),'diagnose modal-with-no-play case');
assert.ok(html.includes('value="works"'),'manual Play recovery must be reported');
assert.ok(!html.includes('id="shade"')&&!html.includes('#shade'),'avoid shade on playback');
assert.ok(!html.includes('isolation:isolate'),'avoid stacking context trap');
assert.ok(!/XMLHttpRequest|fetch\s*\(|\.m3u8|\.mpd|dispatchEvent\s*\(|document\.cookie/.test(js),'no stream manipulation');
assert.ok(workflow.includes('node tests/camera_playback_handoff.test.cjs'),'CI test included');
assert.ok(workflow.includes('cp camera-playback-handoff.html site/'),'Pages deployment included');
console.log('Three-camera playback handoff diagnostic static checks passed.');
