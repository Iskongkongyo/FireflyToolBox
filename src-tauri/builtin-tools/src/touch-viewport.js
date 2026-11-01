// Capture two-finger navigation before drawing / node handlers see it. After a
// pinch, the remaining finger must lift before starting another single stroke.
export function touchViewport(stage,{content,getScale,setScale,cancelSingle,enabled=()=>true}){
 const touches=new Map();let gesture=null,blocked=false,suppressClickUntil=0
 const middle=points=>({x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2,distance:Math.max(1,Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y))})
 const stop=event=>{event.preventDefault();event.stopImmediatePropagation()}
 function start(){const mid=middle([...touches.values()]),rect=content.getBoundingClientRect();gesture={scale:getScale(),distance:mid.distance,x:(mid.x-rect.left)/Math.max(1,rect.width),y:(mid.y-rect.top)/Math.max(1,rect.height)};blocked=true;cancelSingle();for(const id of touches.keys())try{stage.setPointerCapture(id)}catch{/* Pointer already ended. */}}
 function down(event){if(event.pointerType!=='touch'||!enabled())return;touches.set(event.pointerId,{x:event.clientX,y:event.clientY});if(touches.size===2)start();if(blocked)stop(event)}
 function move(event){if(!touches.has(event.pointerId))return;touches.set(event.pointerId,{x:event.clientX,y:event.clientY});if(!blocked)return;stop(event);if(!gesture||touches.size!==2||!enabled())return;const mid=middle([...touches.values()]);setScale(gesture.scale*mid.distance/gesture.distance);const rect=content.getBoundingClientRect();stage.scrollLeft+=rect.left+gesture.x*rect.width-mid.x;stage.scrollTop+=rect.top+gesture.y*rect.height-mid.y}
 function end(event){if(!touches.has(event.pointerId))return;if(blocked){stop(event);suppressClickUntil=Date.now()+500}touches.delete(event.pointerId);if(touches.size<2)gesture=null;if(!touches.size)blocked=false}
 function click(event){if(Date.now()<suppressClickUntil)stop(event)}
 const handlers={pointerdown:down,pointermove:move,pointerup:end,pointercancel:end,click}
 for(const [name,handler]of Object.entries(handlers))stage.addEventListener(name,handler,{capture:true,passive:false})
 return()=>{for(const [name,handler]of Object.entries(handlers))stage.removeEventListener(name,handler,true);for(const id of touches.keys())try{if(stage.hasPointerCapture(id))stage.releasePointerCapture(id)}catch{/* Removed viewport. */}touches.clear();gesture=null;blocked=false}
}
