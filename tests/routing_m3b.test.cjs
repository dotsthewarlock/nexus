'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Routing=require('../routing.js');
const ids=['ambassador','tunnel','gordie'];
const destinations={
 ca:{address:'400 Example Rd, Windsor, Ontario, Canada',country:'ca',label:'Home'},
 us:{address:'500 Example Blvd, Detroit, Michigan, USA',country:'us',label:'Work'}
};
for(const crossing of ids)for(const direction of ['ca','us']){
 const plan=Routing.prepare({crossing,direction,destination:destinations[direction]});
 const link=new URL(plan.url);
 assert.equal(link.origin,'https://www.google.com');
 assert.equal(link.pathname,'/maps/dir/');
 assert.equal(link.searchParams.get('api'),'1');
 assert.equal(link.searchParams.get('destination'),destinations[direction].address);
 assert.equal(link.searchParams.get('travelmode'),'driving');
 assert.equal(link.searchParams.get('waypoints'),Routing.CROSSINGS[crossing].waypoint);
 assert.equal(link.searchParams.has('origin'),false,'do not request user location from Nexus');
 assert.equal(link.searchParams.has('dir_action'),false,'request directions preview, never force turn-by-turn navigation');
 assert.equal(plan.crossingEnforced,false,'a waypoint is not route enforcement');
 assert.equal(plan.waypointRequested,true);
 assert.match(plan.guidance,/Confirm the route crosses at .* in Google Maps/);
 assert.match(plan.guidance,/waypoint may be ignored/);
 assert.ok(!plan.url.includes('key=')&&!plan.url.includes('latitude='));
}
// Address is treated as a URL parameter, not code or a top-level URL.
const unsafeAddress='https://malicious.example/'; 
const safe=Routing.prepare({crossing:'tunnel',direction:'us',destination:{country:'us',address:unsafeAddress}});
assert.equal(new URL(safe.url).searchParams.get('destination'),unsafeAddress);
assert.equal(new URL(safe.url).origin,'https://www.google.com');
assert.ok(!safe.url.startsWith('https://malicious.example'));
for(const invalid of [
 {crossing:'bluewater',direction:'ca',destination:destinations.ca},
 {crossing:'tunnel',direction:'fake',destination:destinations.ca},
 {crossing:'tunnel',direction:'ca',destination:destinations.us},
 {crossing:'tunnel',direction:'ca',destination:{country:'ca',address:'   '}},
 {crossing:'tunnel',direction:'ca',destination:{country:'ca',address:'x'.repeat(201)}},
 {crossing:'tunnel',direction:'ca',destination:destinations.ca,vehicle:'commercial'},
])assert.throws(()=>Routing.prepare(invalid));
const html=fs.readFileSync('index.html','utf8');
const js=fs.readFileSync('dashboard.js','utf8');
const css=fs.readFileSync('dashboard.css','utf8');
const wf=fs.readFileSync('.github/workflows/publish.yml','utf8');
assert.match(html,/routing\.js\?v=m3b/);
assert.match(html,/id="openDirections"[^>]*target="_blank"/,'use a native user-clicked link');
assert.match(html,/id="openDirections"[^>]*rel="noopener noreferrer"/);
assert.match(html,/id="routeNotValidated"/);
assert.match(js,/window\.NexusRouting\.prepare/);
assert.match(js,/link\.href=route\.url/);
assert.match(js,/link\.removeAttribute\('href'\)/);
assert.match(css,/\.route-warning/);
assert.match(wf,/cp dashboard\.css dashboard\.js destinations\.js routing\.js classic-board\.html site\//);
console.log('M3b navigation URL tests passed for all six crossing/direction pairs, preview-only handoff and invalid/unsafe cases.');
