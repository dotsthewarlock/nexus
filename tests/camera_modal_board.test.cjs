'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const D=require('../decision.js');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('board.css','utf8');
const js=fs.readFileSync('board.js','utf8');
new vm.Script(js);
for(const id of [
 'cameraNexusWait','cameraNexusLanes','cameraNexusStatus',
 'cameraRegularWait','cameraRegularLanes','cameraRegularStatus',
 'cameraNexusSchedule','cameraNexusScheduleNote','cameraStage',
 'cameraZoomSurface','cameraZoomControls','cameraZoomHint'
]) assert.ok(html.includes('id="'+id+'"'),'missing modal UI '+id);
for(const scale of [1,2,3,4]) assert.ok(html.includes('data-scale="'+scale+'"'));
assert.ok(html.includes('board.js?v=board6')&&html.includes('board.css?v=board6'));
assert.ok(css.includes('touch-action: none')&&css.includes('.camera-metrics'));
assert.ok(html.includes('id="cameraDetails"'),'source and schedule details must collapse');
assert.ok(html.includes('id="cameraSourceDetails"'));
assert.ok(html.includes('id="cameraScheduleSummary"'));
assert.ok(html.indexOf('id="cameraStage"')<html.indexOf('id="cameraScheduleBox"'),
  'camera must precede the expanded NEXUS schedule');
assert.ok(css.includes('.camera-details summary'));
assert.ok(js.includes('BRIDGE_DEFAULT_ZOOM=4'));
assert.ok(js.includes('BRIDGE_DEFAULT_FRAMING={left:0.20,up:0.50}'));
assert.ok(js.includes("if(id==='gordie'||!CAMERAS[id])return"));
assert.ok(js.includes("frame.src='about:blank'"));
assert.ok(js.includes("D.nextNexusSchedule(data,camera.id,'ca',Date.now())"));

// CBSA scheduling is a published possible service window, not live lane availability.
const base=new Date('2026-11-19T17:00:00Z').getTime(); // Thu noon EST.
const schedule=(rows)=>({
 generated_at:new Date(base).toISOString(),
 sources:{cbsa_hours:{status:'ok',retrieved_at:new Date(base).toISOString()}},
 supplemental:{cbsa_nexus_hours:{ambassador:{groups:[{label:'Dedicated NEXUS lanes towards Canada',rows}]}}}
});
const weekdays=[{label:'Monday to Friday (except Holidays)',start:'07:00',end:'22:00'}];
let hours=D.nextNexusSchedule(schedule(weekdays),'ambassador','ca',base);
assert.equal(hours.kind,'within');assert.equal(hours.event,'closes');
assert.match(hours.next,/Today 10:00/i);
hours=D.nextNexusSchedule(schedule([{label:'Monday to Friday (except Holidays)',start:'14:00',end:'22:00'}]),'ambassador','ca',base);
assert.equal(hours.kind,'outside');assert.equal(hours.event,'opens');
assert.match(hours.next,/Today 2:00/i);
hours=D.nextNexusSchedule(schedule([{label:'7 days per week',start:'22:00',end:'06:00'}]),'ambassador','ca',base);
assert.equal(hours.kind,'outside');assert.equal(hours.event,'opens');
// Overlapping lane-specific windows must end when the last confirmed lane window ends.
hours=D.nextNexusSchedule(schedule([
 {label:'7 days per week',start:'07:00',end:'14:00'},
 {label:'7 days per week',start:'10:00',end:'20:00'}
]),'ambassador','ca',base);
assert.equal(hours.kind,'within');
assert.match(hours.next,/Today 8:00/i,'merged availability should persist to 8 PM');
// Reproduce the official Ambassador Bridge weekday configuration: three
// dedicated lanes with different end times; service lasts until Lane One ends.
hours=D.nextNexusSchedule(schedule([
 {label:'Lane One\nMonday to Friday\n(except Holidays)',start:'07:00',end:'00:00'},
 {label:'Lane One\nWeekends and Holidays',start:'08:00',end:'22:00'},
 {label:'Lane Two\nMonday to Friday\n(except holidays)',start:'14:00',end:'21:00'},
 {label:'Lane Three\nMonday to Friday\n(except holidays)',start:'15:00',end:'19:00'}
]),'ambassador','ca',base);
assert.equal(hours.kind,'within');
assert.match(hours.next,/Tomorrow 12:00/i,'last lane closes at midnight, not 7 or 9 PM');
hours=D.nextNexusSchedule(schedule([{label:'Special circumstances',start:'07:00',end:'22:00'}]),'ambassador','ca',base);
assert.equal(hours.kind,'unknown');
hours=D.nextNexusSchedule(schedule(weekdays),'ambassador','us',base);
assert.equal(hours.kind,'unknown','Do not reuse Canada-bound NEXUS hours for US-bound lanes');
const stale=schedule(weekdays);stale.sources.cbsa_hours.retrieved_at='2026-11-12T17:00:00Z';
assert.equal(D.nextNexusSchedule(stale,'ambassador','ca',base).kind,'unknown');

// Controlled, synthetic DOM: no real video provider is contacted.
const elements=new Map(),zoomButtons=[1,2,3,4].map(n=>makeElement('zoom'+n));
function makeElement(id) {
 const handlers={};
 const node={id,hidden:false,dataset:{},style:{},textContent:'',innerHTML:'',open:false,src:'',
  attrs:{},offsetWidth:460,offsetHeight:345,clientWidth:460,clientHeight:345,
  addEventListener(name,fn){(handlers[name]??=[]).push(fn)},
  emit(name,event={}){for(const fn of handlers[name]||[])fn({target:node,...event})},
  setAttribute(name,value){this.attrs[name]=String(value)},
  removeAttribute(name){delete this.attrs[name]},
  setPointerCapture(id){this.pointer=id},
  hasPointerCapture(id){return this.pointer===id},
  releasePointerCapture(){this.pointer=null},
  querySelectorAll(){return []},
  getBoundingClientRect(){return {left:60,top:50,right:700,bottom:680}},
  showModal(){this.open=true},
  close(){this.open=false;this.emit('close')},
  classList:{add(){},remove(){}}
 };
 return node;
}
function el(id){if(!elements.has(id))elements.set(id,makeElement(id));return elements.get(id)}
el('cameraZoomControls').querySelectorAll=()=>zoomButtons;
zoomButtons.forEach((b,i)=>b.dataset.scale=String(i+1));
const dom={hidden:false,getElementById:el,addEventListener(){}};
const win={NexusDecision:D,addEventListener(){}};
const source=js.replace('  render();refresh();',
 "  window.__cameraQa={openCamera,closeCamera,setBridgeScale,bridgeZoom,setData:(x)=>{data=x;busy=false;loadError='';},setDirection:(x)=>{direction=x;render();}};\n  render();refresh();");
assert.notEqual(source,js);
vm.runInNewContext(source,{
  document:dom,window:win,localStorage:{getItem(){return null},setItem(){}},
  fetch(){return new Promise(()=>{})},setInterval(){},setTimeout(){return 0},
  clearTimeout(){},requestAnimationFrame(cb){cb()},AbortController,Intl,Date,Number,Math,Promise,Error
},{filename:'board.js'});
const api=win.__cameraQa;
const stamp=n=>new Date(Date.now()-n*60000).toISOString();
const lane=(n,age,count)=>({status:'reported',minutes:n,lanes_open:count,observation_at:stamp(age)});
const now=stamp(0);
api.setData({
 schema:'nexus-live-v2',generated_at:now,
 directions:{us:{ambassador:{standard:lane(0,5,2),nexus:lane(6,5,1)}},
  ca:{tunnel:{standard:lane(4,5,null)}}},
 sources:{cbp:{status:'ok',retrieved_at:now},cbsa:{status:'ok',retrieved_at:now},
  cbsa_hours:{status:'ok',retrieved_at:now}},
 supplemental:{cbsa_nexus_hours:{tunnel:{groups:[{
  label:'Dedicated NEXUS lanes towards Canada',
  rows:[{label:'7 days per week',start:'',end:'',custom:'24h'}]}]}}}
});
api.openCamera('ambassador');
assert.equal(el('cameraDialog').open,true);
assert.equal(el('cameraNexusWait').textContent,'6 min');
assert.equal(el('cameraRegularWait').textContent,'No Delay');
assert.equal(el('cameraRegularLanes').textContent,'2 lanes reported');
assert.match(el('cameraSourceDetails').textContent,/Source retrieved/,'source timestamps remain accessible');
assert.equal(el('cameraDetails').open,false,'schedule details should default to collapsed');
assert.equal(el('cameraZoomSurface').hidden,false);
assert.equal(api.bridgeZoom.scale,4);
assert.match(el('cameraFrame').style.transform,/scale\(4\)/);
assert.match(el('cameraNexusScheduleNote').textContent,/not published/i);

// Original 20% left, 50% up framing.
const expectedX=((460*4-460)/2)*.20, expectedY=((345*4-345)/2)*.50;
assert.ok(Math.abs(api.bridgeZoom.x-expectedX)<.01);
assert.ok(Math.abs(api.bridgeZoom.y-expectedY)<.01);
const overlay=el('cameraZoomSurface');
overlay.emit('pointerdown',{button:0,pointerId:1,clientX:100,clientY:100});
overlay.emit('pointermove',{pointerId:1,clientX:125,clientY:119});
overlay.emit('pointerup',{pointerId:1});
assert.ok(api.bridgeZoom.x>expectedX,'drag should pan camera');
assert.equal(el('cameraDialog').open,true,'drag does not dismiss camera');
api.setBridgeScale(1);
assert.equal(el('cameraFrame').style.transform,'');
overlay.emit('keydown',{key:'Enter',preventDefault(){}});
assert.equal(api.bridgeZoom.scale,4,'keyboard toggles zoom');

// Gesture inside dialog must not dismiss; outside must unload the iframe.
const dialog=el('cameraDialog');
dialog.emit('pointerdown',{clientX:200,clientY:200,target:el('cameraFrame')});
dialog.emit('pointerup',{clientX:200,clientY:200,target:el('cameraFrame')});
assert.equal(dialog.open,true);
dialog.emit('pointerdown',{clientX:10,clientY:10,target:dialog});
dialog.emit('pointerup',{clientX:10,clientY:10,target:dialog});
assert.equal(dialog.open,false);
assert.equal(el('cameraFrame').src,'about:blank');
assert.equal(el('cameraFrame').hidden,true);

// Escape also cleans up. Tunnel must never be covered by a bridge-pan overlay.
api.setDirection('ca');api.openCamera('tunnel');
assert.equal(dialog.open,true);
assert.equal(el('cameraZoomSurface').hidden,true);
assert.match(el('cameraNexusSchedule').textContent,/published NEXUS hours/i);
assert.equal(el('cameraNexusWait').textContent,'Not published','CBSA does not report NEXUS waits');
let prevented=false;
dialog.emit('cancel',{preventDefault(){prevented=true}});
assert.equal(prevented,true);
assert.equal(dialog.open,false);
assert.equal(el('cameraFrame').src,'about:blank');
api.openCamera('gordie');assert.equal(dialog.open,false);
console.log('Camera modal regression passed: data, CBSA schedule, zoom, pan, backdrop, Escape, iframe cleanup.');
