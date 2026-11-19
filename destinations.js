/* Nexus M3a: local-only destinations, no geocoding or network access. */
(function(root, factory) {
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  if(root)root.NexusDestinations=api;
})(typeof window==='undefined'?null:window,function(){
'use strict';
const KEY='nexus-destinations-v1',VERSION=1,MAX_ITEMS=12;
const COUNTRIES=['ca','us'],KINDS=['home','work','custom'];
const empty=()=>({version:VERSION,items:[],defaults:{ca:null,us:null}});
const clean=s=>typeof s==='string'?s.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim():'';
function record(input){
 if(!input||typeof input!=='object')throw Error('Invalid destination');
 const id=clean(input.id),kind=clean(input.kind),country=clean(input.country);
 const address=clean(input.address),label=kind==='home'?'Home':kind==='work'?'Work':clean(input.label);
 if(!/^[a-z0-9_-]{4,64}$/i.test(id))throw Error('Invalid destination identifier');
 if(!KINDS.includes(kind))throw Error('Choose Home, Work or Custom');
 if(!COUNTRIES.includes(country))throw Error('Choose Canada or USA for the destination');
 if(!address||address.length>200)throw Error('Enter a destination address or place (up to 200 characters)');
 if(!label||label.length>40)throw Error('Enter a destination label (up to 40 characters)');
 return {id,kind,label,country,address};
}
function parse(raw){
 if(!raw)return empty();
 let data;
 try{data=JSON.parse(raw)}catch{return empty()}
 if(!data||data.version!==VERSION||!Array.isArray(data.items)||!data.defaults)return empty();
 const out=empty(),ids=new Set(),kinds=new Set();
 for(const input of data.items.slice(0,MAX_ITEMS)){
  try{
   const item=record(input),singleton=item.kind==='custom'?null:item.kind;
   if(ids.has(item.id)||(singleton&&kinds.has(singleton)))continue;
   out.items.push(item);ids.add(item.id);if(singleton)kinds.add(singleton);
  }catch{}
 }
 for(const c of COUNTRIES){
  const id=typeof data.defaults[c]==='string'?data.defaults[c]:null;
  if(id&&out.items.some(item=>item.id===id&&item.country===c))out.defaults[c]=id;
 }
 return out;
}
function newId(){
 return 'd'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
}
function createStore(storage){
 let state=empty(),storageProblem=null;
 try{state=parse(storage?.getItem(KEY))}catch{storageProblem='Local storage is unavailable';}
 const copy=i=>i?{...i}:null;
 function save(){
  try{
   if(!storage||typeof storage.setItem!=='function')throw Error('Missing local storage');
   storage.setItem(KEY,JSON.stringify(state));storageProblem=null;return true;
  }catch{storageProblem='Changes are only available until this page closes; local storage is blocked or full';return false}
 }
 function items(){return state.items.map(copy)}
 function forCountry(country){return COUNTRIES.includes(country)?items().filter(i=>i.country===country):[]}
 function find(id){return copy(state.items.find(i=>i.id===id))}
 function defaultFor(country){
  return COUNTRIES.includes(country)?find(state.defaults[country]):null;
 }
 function upsert(input,id=null){
  if(id!==null&&!find(id))throw Error('Destination no longer exists');
  const item=record({...input,id:id||newId()});
  if(item.kind!=='custom'&&state.items.some(i=>i.kind===item.kind&&i.id!==id))
   throw Error(item.label+' already exists; edit the existing destination');
  if(id===null&&state.items.length>=MAX_ITEMS)throw Error('Maximum of '+MAX_ITEMS+' saved destinations');
  const index=id===null?-1:state.items.findIndex(i=>i.id===id);
  if(index<0)state.items.push(item);else state.items[index]=item;
  for(const c of COUNTRIES)if(state.defaults[c]===id&&item.country!==c)state.defaults[c]=null;
  return {item:copy(item),persisted:save()};
 }
 function remove(id){
  if(!find(id))return false;
  state.items=state.items.filter(i=>i.id!==id);
  for(const c of COUNTRIES)if(state.defaults[c]===id)state.defaults[c]=null;
  save();return true;
 }
 function setDefault(country,id){
  if(!COUNTRIES.includes(country))throw Error('Invalid direction');
  if(id!==null){
   const item=find(id);
   if(!item||item.country!==country)throw Error('Destination must match the selected country');
  }
  state.defaults[country]=id;return save();
 }
 function clear(){state=empty();return save()}
 function problem(){return storageProblem}
 return {items,forCountry,find,defaultFor,upsert,remove,setDefault,clear,problem};
}
return {KEY,MAX_ITEMS,record,parse,createStore};
});