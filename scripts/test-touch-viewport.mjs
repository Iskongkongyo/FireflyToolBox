import test from 'node:test'
import assert from 'node:assert/strict'
import {touchViewport} from '../src-tauri/builtin-tools/src/touch-viewport.js'
function viewport(){
 const listeners=new Map(),captured=new Set();let scale=1,cancelled=0,enabled=true
 const stage={scrollLeft:50,scrollTop:30,addEventListener(name,fn){listeners.set(name,fn)},removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name)},setPointerCapture(id){captured.add(id)},hasPointerCapture(id){return captured.has(id)},releasePointerCapture(id){captured.delete(id)}}
 const content={getBoundingClientRect:()=>({left:10-stage.scrollLeft,top:20-stage.scrollTop,width:400*scale,height:600*scale})}
 const dispose=touchViewport(stage,{content,getScale:()=>scale,setScale:value=>scale=Math.min(3,Math.max(.5,value)),cancelSingle:()=>cancelled++,enabled:()=>enabled})
 function event(type,id,x=100,y=100,pointerType='touch'){const e={pointerId:id,clientX:x,clientY:y,pointerType,prevented:false,stopped:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};listeners.get(type)?.(e);return e}
 return{stage,event,dispose,captured,listeners,get scale(){return scale},get cancelled(){return cancelled},disable(){enabled=false}}
}
test('single touch and mouse drawing reach the caller without capture or cancellation',()=>{
 const v=viewport();assert.equal(v.event('pointerdown',1).stopped,false);assert.equal(v.event('pointermove',1,120,130).prevented,false);assert.equal(v.event('pointerup',1).stopped,false)
 assert.equal(v.event('pointerdown',2,100,100,'mouse').stopped,false);assert.equal(v.cancelled,0);assert.equal(v.captured.size,0);v.dispose()
})
test('pinch cancels a pending stroke and keeps the content under the moving midpoint',()=>{
 const v=viewport();v.event('pointerdown',1,100,100);assert(v.event('pointerdown',2,200,100).stopped);assert.equal(v.cancelled,1)
 v.event('pointermove',2,300,100);assert.equal(v.scale,2)
 // Start midpoint (150,100) corresponds to document position (190,110).
 assert(Math.abs(10-v.stage.scrollLeft+190*2-200)<1e-8);assert(Math.abs(20-v.stage.scrollTop+110*2-100)<1e-8)
 v.event('pointermove',1,120,140);const mid={x:210,y:120};assert(Math.abs(10-v.stage.scrollLeft+190*v.scale-mid.x)<1e-8);assert(Math.abs(20-v.stage.scrollTop+110*v.scale-mid.y)<1e-8);v.dispose()
})
test('lifting one finger cannot resume a stroke or generate a node click after pinching',()=>{
 const v=viewport();v.event('pointerdown',1);v.event('pointerdown',2,200);assert(v.event('pointerup',2).stopped);assert(v.event('pointermove',1,140).stopped);assert(v.event('pointerup',1).stopped);assert(v.event('click',1).prevented)
 assert.equal(v.event('pointerdown',3).stopped,false);v.dispose()
})
test('touch cancellation resets navigation and clamped zoom retains its anchor',()=>{
 const v=viewport();v.event('pointerdown',1,100,100);v.event('pointerdown',2,200,100);v.event('pointermove',2,1000,100);assert.equal(v.scale,3);assert.equal(10-v.stage.scrollLeft+190*3,550)
 v.event('pointercancel',1);v.event('pointercancel',2);assert.equal(v.event('pointerdown',3).stopped,false);v.dispose()
})
test('busy editors ignore new gestures and disposal releases active capture and listeners',()=>{
 const v=viewport();v.disable();v.event('pointerdown',1);v.event('pointerdown',2);assert.equal(v.cancelled,0);v.dispose()
 const active=viewport();active.event('pointerdown',1);active.event('pointerdown',2);assert.equal(active.captured.size,2);active.dispose();assert.equal(active.captured.size,0);assert.equal(active.listeners.size,0)
})
