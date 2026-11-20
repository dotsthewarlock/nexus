'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('index.html','utf8');
const app=fs.readFileSync('dashboard.js','utf8');
const publish=fs.readFileSync('.github/workflows/publish.yml','utf8');
new vm.Script(app);

// Owner decision: navigation, route testing and destination collection are
// deferred. Keep existing browser storage untouched for a future release.
for(const forbidden of [
 /id="openDirections"/, /id="destinationPicker"/,
 /id="destinationForm"/, /id="savedDestinations"/,
 /id="routeQaDetails"/, /id="routeQaGrid"/,
 /src="\.\/routing\.js/, /src="\.\/destinations\.js/,
 /www\.google\.com\/maps\/dir/, /Google Maps/
]){
 assert.doesNotMatch(html,forbidden,'Deferred navigation UI must not ship');
}
for(const forbidden of [
 /NexusRouting/, /NexusDestinations/, /initDestinations\(/,
 /initRouteQa\(/, /renderDestinationAction\(/, /routeQaLinks\(/,
 /www\.google\.com\/maps\/dir/, /localStorage\.clear\(/
]){
 assert.doesNotMatch(app,forbidden,'Deferred navigation code must not execute');
}
assert.match(html,/dashboard\.js\?v=m6-dwt2/);
assert.match(publish,/cp dashboard\.css dashboard\.js classic-board\.html site\//);
assert.doesNotMatch(publish,/cp dashboard\.css dashboard\.js destinations\.js routing\.js/);
assert.match(html,/id="detailDialog"/);
assert.match(html,/id="detailProvenance"/);
assert.match(html,/id="detailSchedule"/);
assert.match(html,/id="crossingRows"/);
assert.match(html,/id="cameraViewer"/);
assert.match(app,/async function refresh\(\)/);
assert.match(app,/NexusDecision/);
assert.match(app,/document\.addEventListener\('visibilitychange'/);
assert.match(app,/localStorage\.removeItem\(key\)/,
 'Only the existing sort-reset action may remove a stored preference');
console.log('Navigation deferral tests passed: no routing/destination/test UI, border dashboard and local data preserved.');
