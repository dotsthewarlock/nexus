'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Dest=require('../destinations.js');
const Routing=require('../routing.js');
const D=require('../decision.js');
const dashboard=fs.readFileSync('dashboard.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('dashboard.css','utf8');
const workflow=fs.readFileSync('.github/workflows/publish.yml','utf8');
new vm.Script(dashboard);
assert.match(html,/destinations\.js\?v=m3a/);
assert.match(html,/dashboard\.js\?v=m5-routeqa/);
assert.match(html,/routing\.js\?v=m3b/);
for(const id of ['detailMain','destinationPicker','chooseDestination','changeDestination',
 'openDirections','detailDestination','destinationPickerSaved','oneTimeDestinationForm',
 'oneTimeAddress','destinationForm','destinationKind','destinationLabel','destinationAddress',
 'destinationCountry','destinationEditingId','savedDestinations','removeAllConfirm','openDestinationSettings'])
 assert.ok(html.includes('id="'+id+'"'),'missing M3a surface '+id);
assert.match(workflow,/cp dashboard\.css dashboard\.js destinations\.js routing\.js classic-board\.html site\//);
assert.match(css,/\[hidden\]\{display:none!important\}/);
assert.doesNotMatch(dashboard,/window\.open\(/,'Open directions uses a standard user-clicked external anchor, not popup scripting');

const memory=()=>{const values={};return {
 getItem:k=>values[k]??null,
 setItem:(k,v)=>{values[k]=String(v)},
 removeItem:k=>{delete values[k]},
 values
};};
const homeDetails={kind:'home',country:'ca',address:'100 Example Rd, Windsor, ON',label:''};
const workDetails={kind:'work',country:'us',address:'200 Example Blvd, Detroit, MI',label:''};
let storage=memory(),store=Dest.createStore(storage);
assert.deepEqual(store.items(),[]);
const h=store.upsert(homeDetails);
assert.equal(h.persisted,true);
assert.equal(h.item.label,'Home');
const w=store.upsert(workDetails);
assert.equal(store.items().length,2);
assert.throws(()=>store.upsert(homeDetails),/already exists/);
assert.throws(()=>store.setDefault('us',h.item.id),/match/);
assert.equal(store.setDefault('ca',h.item.id),true);
assert.equal(store.setDefault('us',w.item.id),true);
assert.equal(store.defaultFor('ca').label,'Home');
assert.equal(store.defaultFor('us').label,'Work');
assert.equal(Dest.createStore(storage).defaultFor('ca').id,h.item.id,'local settings survive reload');
store.upsert({...homeDetails,country:'us'},h.item.id);
assert.equal(store.defaultFor('ca'),null,'changing declared country clears incompatible default');
assert.equal(store.find(h.item.id).country,'us');
assert.equal(store.forCountry('ca').length,0);
assert.equal(store.remove(w.item.id),true);
assert.equal(store.defaultFor('us'),null,'removing destination clears default');
assert.equal(store.clear(),true);
assert.equal(store.items().length,0);
assert.equal(Dest.createStore(storage).items().length,0);
const extra=Dest.parse(JSON.stringify({version:1,items:[{
 id:'sample-id',kind:'custom',label:'Test',country:'ca',address:'A place'
}],defaults:{ca:'sample-id',us:'sample-id'}}));
assert.equal(extra.defaults.ca,'sample-id');
assert.equal(extra.defaults.us,null,'invalid cross-border default is rejected');
assert.deepEqual(Dest.parse('{bad'),Dest.parse(null),'corrupt storage starts empty safely');
assert.throws(()=>Dest.record({id:'valid-id',kind:'custom',label:'X',country:'CA',address:'A'}),/Choose Canada/);
assert.throws(()=>Dest.record({id:'valid-id',kind:'custom',label:'',country:'ca',address:'A'}),/label/);
assert.throws(()=>Dest.record({id:'valid-id',kind:'custom',label:'X',country:'ca',address:' '.repeat(20)}),/address/);
const blocked=Dest.createStore({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}});
assert.equal(blocked.upsert(homeDetails).persisted,false);
assert.match(blocked.problem(),/only available until this page closes/);
assert.equal(blocked.items().length,1,'storage failure can still support current-session selection');

const injected=dashboard.replace(/\ninit\(\);\n\}\)\(\);\s*$/,
 "\nwindow.__m3aTest={store,initDestinations,saveDestinationForm,renderDestinationAction,openDetail,openDestinationPicker,returnToCrossing,useSavedDestination,useOneTimeDestination,editDestination,savedDestinationAction,tripChoice,resolvedDestination,repository:()=>destinationRepo};\n})();");
assert.notEqual(injected,dashboard,'M3a test injection failed');
const nodes=new Map();
function node(id){
 if(!nodes.has(id))nodes.set(id,{
  id,value:'',dataset:{},textContent:'',innerHTML:'',hidden:false,open:false,disabled:false,
  listeners:{},addEventListener(t,fn){this.listeners[t]=fn},
  focus(){this.focused=true},scrollIntoView(){},showModal(){this.open=true},close(){this.open=false},
  setAttribute(n,v){this[n]=v},getAttribute(n){return this[n]},removeAttribute(n){delete this[n]},querySelector(){return null}
 });
 return nodes.get(id);
}
const uiStorage=memory();
const doc={getElementById:node,querySelectorAll(){return[]},hidden:false};
const ctx={window:{NexusDecision:D,NexusDestinations:Dest,NexusRouting:Routing},document:doc,localStorage:uiStorage,
 Date,Math,Number,Intl,console};
vm.runInNewContext(injected,ctx,{filename:'dashboard.js'});
const api=ctx.window.__m3aTest;
api.initDestinations();
assert.match(node('savedDestinations').innerHTML,/No destinations saved/);
node('destinationKind').value='home';node('destinationCountry').value='ca';
node('destinationAddress').value='101 Example St, Windsor, Ontario';
api.saveDestinationForm({preventDefault(){}});
const uiRepo=api.repository();
assert.equal(uiRepo.items().length,1);
const home=uiRepo.items()[0];
assert.equal(home.country,'ca');
assert.equal(node('destinationKind').value,'work','after saving Home, next form defaults to Work');
api.savedDestinationAction({target:{closest:()=>({dataset:{destAction:'default',destId:home.id}})}});
assert.equal(uiRepo.defaultFor('ca').id,home.id,'default is explicitly set');
api.openDetail('tunnel','ca');
assert.equal(node('detailDialog').open,true);
assert.match(node('detailDestination').textContent,/Home.*101 Example St.*your default/);
assert.equal(node('openDirections').hidden,false,'preview link is enabled for a compatible passenger destination');
assert.match(node('openDirections').href,/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
assert.match(node('routeNotValidated').textContent,/Confirm the route crosses at Detroit–Windsor Tunnel/);
assert.equal(node('chooseDestination').hidden,true);
assert.equal(node('changeDestination').hidden,false);
api.openDestinationPicker();
assert.equal(node('detailMain').hidden,true);
assert.equal(node('destinationPicker').hidden,false);
assert.match(node('destinationPickerSaved').innerHTML,/101 Example St/);
assert.match(node('destinationPickerCountry').textContent,/Canada/);
api.useOneTimeDestination('Temporary stop, Windsor');
assert.equal(api.tripChoice.ca.type,'once');
assert.match(node('detailDestination').textContent,/Temporary stop, Windsor/);
assert.equal(uiRepo.items().length,1,'one-time address must never become saved');
assert.ok(!uiStorage.values[Dest.KEY].includes('Temporary stop'));
api.openDestinationPicker();
api.useSavedDestination(home.id);
assert.equal(api.tripChoice.ca.type,'saved');
assert.equal(node('destinationPicker').hidden,true);
assert.match(node('detailDestination').textContent,/101 Example St/);
// Explicit destination country is the only matching criterion; no geolocation.
api.openDetail('ambassador','us');
assert.match(node('detailDestination').textContent,/No destination selected/);
assert.equal(node('chooseDestination').hidden,false);
api.openDestinationPicker();
assert.doesNotMatch(node('destinationPickerSaved').innerHTML,/101 Example St/);
assert.throws(()=>uiRepo.setDefault('us',home.id),/match/);
// User-provided names are escaped before rendering.
uiRepo.upsert({kind:'custom',label:'Place <img src=x>',country:'us',address:'200 <script> X St'});
api.openDestinationPicker();
assert.match(node('destinationPickerSaved').innerHTML,/&lt;img/);
assert.doesNotMatch(node('destinationPickerSaved').innerHTML,/<img/);
assert.match(node('destinationPickerSaved').innerHTML,/&lt;script&gt;/);
uiRepo.remove(home.id);
assert.equal(uiRepo.defaultFor('ca'),null);
api.openDetail('tunnel','ca');
assert.match(node('detailDestination').textContent,/No destination selected/,'deleted selected destination must not remain active');
console.log('M3a/M3b tests passed: local CRUD/defaults, country filtering, storage failure, one-time privacy, preview routes and HTML escaping.');
