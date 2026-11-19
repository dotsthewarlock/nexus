// DWT diagnostic must stay isolated from the production player and border-data ingestion.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const html=fs.readFileSync('camera-diagnostics.html','utf8');
const workflow=fs.readFileSync('.github/workflows/publish.yml','utf8');
const app=fs.readFileSync('app.js','utf8');
const first='4aea1c45-d402-3690-afae-fe635942da82';
const second='794566d4-a75e-3cd1-6f95-2d60e54f2fdb';
const third='5408b5c3-f8d1-f34b-a18a-9943047905b6';
for(const id of [first,second,third]){
  assert(html.includes(id),`Diagnostic missing original source ${id}`);
  assert(app.includes(id),`Production source unexpectedly missing ${id}`);
}
for(const s of [
  'function newIframeForOperator(src)',
  "frame.allow='encrypted-media'",
  "frame.src=src",
  "stageA.insertBefore(frame,stageA.firstChild)",
  "existingFrame.src=src",
  'id="directPlayer"',
  'id="officialWebsite"',
  'id="resultA"',
  'id="copyReport"',
  "addEventListener('pagehide',unload)",
  'iframe load event (not proof of video playback)'
]) assert(html.includes(s),`Diagnostic missing safety/feature: ${s}`);
assert(!/fetch\s*\(/.test(html),'Diagnostic must never fetch agency data or stream media itself');
assert(workflow.includes('camera-diagnostics.html site/'),'Deployment must publish standalone test page');
assert(workflow.includes('node tests/camera_diagnostics.test.cjs'),'Deployment must test new page');
console.log('Standalone DWT diagnostic assertions passed');
