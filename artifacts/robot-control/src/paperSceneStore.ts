import { useSyncExternalStore } from "react";
import { selectRevisionPoint, useRevisionScene, revisionSceneSnapshot } from "./revisionSceneStore";
import { useSquareVisual } from "./useSquareVisual";
import type { PaperSceneData } from "./paperSceneModel";

type Snapshot = { owner:string|null; data:PaperSceneData|null; point:number|null; reference:string|null; selectionOrigin:"scene"|"lesson"; selectionVersion:number; revisionSelectionVersion:number; cameraKey:number };
let state:Snapshot = {owner:null,data:null,point:null,reference:null,selectionOrigin:"lesson",selectionVersion:0,revisionSelectionVersion:0,cameraKey:0};
const listeners=new Set<()=>void>();
const set=(next:Snapshot)=>{state=next;listeners.forEach(fn=>fn());};
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const paperSceneSnapshot=()=>state;
export function publishPaperScene(owner:string,data:PaperSceneData) {
  if (owner===state.owner && JSON.stringify(data)===JSON.stringify(state.data)) return;
  const fresh=owner!==state.owner || data.level!==state.data?.level;
  const frameChanged=data.frame?.id!==state.data?.frame?.id;
  const changed=data.samples.filter(s=>!state.data?.samples.some(old=>JSON.stringify(old)===JSON.stringify(s))).at(-1);
  if(fresh) selectRevisionPoint(0);
  set({...state,owner,data,point:fresh?null:state.point,reference:fresh?null:data.level==="advanced-paper-dt"?state.reference:changed?.point??state.reference,
    revisionSelectionVersion:fresh?revisionSceneSnapshot().selectionVersion:state.revisionSelectionVersion,
    selectionOrigin:fresh||frameChanged?"lesson":state.selectionOrigin,cameraKey:state.cameraKey+(fresh?1:0)});
}
export function clearPaperScene(owner:string) {if(state.owner===owner)set({...state,owner:null,data:null,point:null,reference:null,selectionOrigin:"lesson"});}
/** Selection and camera requests are ephemeral: no robot API or persistence here. */
export function selectPaperPoint(label:string,origin:"scene"|"lesson"="lesson") {
  if (!state.data) return;
  if (/^P[1-4]$/.test(label)) selectRevisionPoint(Number(label.slice(1))-1);
  set({...state,point:/^P[1-4]$/.test(label)?Number(label.slice(1))-1:null,reference:/^[OXY]$/.test(label)?label:null,revisionSelectionVersion:revisionSceneSnapshot().selectionVersion,selectionOrigin:origin,selectionVersion:state.selectionVersion+1});
}
export function requestPaperCamera(){if(state.data)set({...state,cameraKey:state.cameraKey+1});}
export function usePaperScene() {
  const snapshot=useSyncExternalStore(subscribe,paperSceneSnapshot,paperSceneSnapshot), revision=useRevisionScene(),square=useSquareVisual();
  const linked=!!snapshot.data?.revisionJourney&&revision.selectionVersion!==snapshot.revisionSelectionVersion;
  return {...snapshot,point:linked?revision.point:snapshot.point,reference:linked?null:snapshot.reference,phase:revision.phase,
    data:square.visual?.review?.selected||square.emphasis||square.replay?null:snapshot.data};
}
