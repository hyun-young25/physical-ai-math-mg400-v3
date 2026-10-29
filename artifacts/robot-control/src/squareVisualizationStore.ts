import type { SquareVisual } from "./squareComparisonVisual";
type Snapshot = { owner:string|null; visual:SquareVisual|null; enabled:boolean;
  emphasis:{edgeIndex?:number;nonce:number}|null; replay:{startedAt:number;speed:1|0.5}|null };
let state:Snapshot={owner:null,visual:null,enabled:true,emphasis:null,replay:null};
const listeners=new Set<()=>void>();
let emphasisTimer:ReturnType<typeof setTimeout>|undefined,replayTimer:ReturnType<typeof setTimeout>|undefined;
function set(next:Snapshot){state=next;listeners.forEach(fn=>fn());}
export const subscribeSquareVisual=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const squareVisualSnapshot=()=>state;
export function publishSquareVisual(owner:string,visual:SquareVisual|null) {
  if(!visual){clearSquareVisual(owner);return;}
  const fresh=state.owner!==owner||state.visual?.key!==visual.key;
  if(!fresh&&JSON.stringify(state.visual)===JSON.stringify(visual))return;
  if(fresh){clearTimeout(emphasisTimer);clearTimeout(replayTimer);}
  set({owner,visual,enabled:fresh?true:state.enabled,emphasis:fresh?null:state.emphasis,replay:fresh?null:state.replay});
}
export function clearSquareVisual(owner:string){
  if(state.owner!==owner)return;
  clearTimeout(emphasisTimer);clearTimeout(replayTimer);
  set({owner:null,visual:null,enabled:true,emphasis:null,replay:null});
}
export function toggleSquareVisual(){clearTimeout(replayTimer);set({...state,enabled:!state.enabled,replay:null});}
export function emphasizeSquareEvidence(key:string,edgeIndex?:number){
  if(!state.visual||state.visual.feedbackKey!==key)return false;
  clearTimeout(emphasisTimer);
  set({...state,enabled:true,emphasis:{edgeIndex:edgeIndex??state.visual.diagnosis.edgeIndex,nonce:Date.now()}});
  emphasisTimer=setTimeout(()=>set({...state,emphasis:null}),2000);
  return true;
}
/** This module has no robot, network, persistence, grading or inquiry dependencies. */
export function replaySquareComparison(speed:1|0.5){
  if(!state.visual||state.visual.stage!==6||state.visual.observed.length!==5)return false;
  clearTimeout(replayTimer);
  set({...state,enabled:true,replay:{startedAt:performance.now(),speed}});
  replayTimer=setTimeout(()=>set({...state,replay:null}),4000/speed);
  return true;
}
