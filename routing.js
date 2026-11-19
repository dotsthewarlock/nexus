/* Nexus M3b: Google Maps directions preview, never verified border-crossing enforcement.
 * Official format: https://developers.google.com/maps/documentation/urls/get-started
 * Google warns that waypoints can be ignored depending on the Maps product.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.NexusRouting=api;
})(typeof window==='undefined'?null:window,function(){
'use strict';
const CROSSINGS={
 ambassador:{name:'Ambassador Bridge',waypoint:'Ambassador Bridge, Windsor-Detroit'},
 tunnel:{name:'Detroit–Windsor Tunnel',waypoint:'Detroit Windsor Tunnel border crossing'},
 gordie:{name:'Gordie Howe International Bridge',waypoint:'Gordie Howe International Bridge, Windsor-Detroit'}
};
const DIRECTIONS=['ca','us'];
function prepare({crossing,direction,destination,vehicle='passenger'}={}){
 if(!Object.prototype.hasOwnProperty.call(CROSSINGS,crossing))throw Error('Unknown border crossing');
 if(!DIRECTIONS.includes(direction))throw Error('Choose a destination country');
 if(vehicle!=='passenger')throw Error('Commercial routing and restrictions have not been verified');
 const address=typeof destination?.address==='string'
   ?destination.address.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim():'';
 if(!address||address.length>200)throw Error('Choose a valid destination address or place');
 if(destination.country!==direction)throw Error('Destination country does not match the selected crossing direction');
 // The Maps URL requests a single, named crossing waypoint but cannot force Google
 // Maps to follow it. Do NOT set dir_action=navigate: show directions for inspection first.
 const c=CROSSINGS[crossing];
 const url='https://www.google.com/maps/dir/?api=1'
  +'&destination='+encodeURIComponent(address)
  +'&travelmode=driving'
  +'&waypoints='+encodeURIComponent(c.waypoint);
 if(url.length>2048)throw Error('Directions link is too long');
 return Object.freeze({
  url,crossing:c.name,direction,destination:address,provider:'Google Maps',
  waypointRequested:true,crossingEnforced:false,
  guidance:'Confirm the route crosses at '+c.name+' in Google Maps. The waypoint may be ignored. Check lane and vehicle eligibility before driving.'
 });
}
return {CROSSINGS,prepare};
});