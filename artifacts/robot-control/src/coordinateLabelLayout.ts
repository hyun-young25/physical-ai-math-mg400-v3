import { coordinateWorldOffset, coordinateSceneOffset, COORDINATE_MODES, MODE_LABEL, type CoordinateVisual } from "./coordinateLearning";

export type CoordinateLabel = { id: string; text: string; fullText: string; color: string; position: [number,number,number]; live?: boolean; endpoint?: boolean };
const samePosition = (a: number[], b: number[], tolerance: number) => a.every((n,i)=>Math.abs(n-b[i])<=tolerance);
/** Presentation only: merge visible evidence at the same world position, never projected screen positions. */
function combineEndpoints(labels: CoordinateLabel[]): CoordinateLabel[] {
  const groups: CoordinateLabel[][] = [];
  for (const label of labels) {
    const group=groups.find(g=>g.every(other=>samePosition(other.position,label.position,0.01)));
    if(group)group.push(label);else groups.push([label]);
  }
  return groups.map(group=>{
    if(group.length===1)return {...group[0],endpoint:true};
    const absolute=group.some(l=>l.id==="result-absolute"),relative=group.some(l=>l.id==="result-relative");
    const given=group.find(l=>l.text==="B 도착"),result=group.find(l=>l.id.startsWith("result-"));
    const text=absolute&&relative ? `${given?"B 도착":"DT 도착"} · 절대=상대`
      : result ? `${given?"B 도착 · ":""}${result.text}` : group.map(l=>l.text).join(" = ");
    return {...(given??result??group[0]),id:group.map(l=>l.id).join("+"),text,
      fullText:group.map(l=>l.fullText).join(" · 같은 위치: "),endpoint:true};
  });
}
/** Hide only the redundant TCP name at a labelled endpoint. Its live marker remains visible. */
export function tcpSharesEndpoint(labels: CoordinateLabel[], localTcp: [number,number,number]) {
  return labels.some(l=>l.endpoint&&samePosition(l.position,localTcp,0.1));
}
export function coordinateLabels(visual: CoordinateVisual): CoordinateLabel[] {
  const short = (s:string) => s.replace("B · 주어진 도착점","B 도착").replace("P · 주어진 작업대","P 작업대")
    .replace("내 Δ로 만든 도착점","내 Δ 도착").replace("내 예상 · 절대 이동","예상 절대").replace("내 예상 · 상대 이동","예상 상대")
    .replace(" · 내 명령 도착점"," 명령 도착").replace("DT · 절대 이동","DT 절대").replace("DT · 상대 이동","DT 상대");
  const endpoints:CoordinateLabel[] = [
    ...visual.points.flatMap(p=>{
      const position=coordinateSceneOffset(visual,p.pose);
      return position?[{id:`point-${p.id}`,text:short(p.label),fullText:p.label,color:p.color,position}]:[];
    }),
    ...COORDINATE_MODES.flatMap(mode=>{
      const result=visual.results[mode],position=result&&coordinateSceneOffset(visual,result.to);
      return position?[{id:`result-${mode}`,text:mode==="absolute"?"DT 절대":"DT 상대",
        fullText:`DT · ${MODE_LABEL[mode]}`,color:mode==="absolute"?"#0284c7":"#0f766e",position}]:[];
    }),
  ];
  return [
    {id:"origin",text:"O 원점",fullText:"O · 표시 좌표 원점",color:"#64748b",position:[0,0,0]},
    {id:"start",text:`${visual.fromLabel} 출발`,fullText:`${visual.fromLabel} · 문제 출발점`,color:"#334155",position:coordinateWorldOffset(visual.from)},
    {id:"tcp",text:"현재 TCP",fullText:"현재 TCP",color:"#b45309",position:[0,0,0],live:true},
    ...(["x","y","z"] as const).map(axis=>({id:`axis-${axis}`,text:`+${axis.toUpperCase()}`,fullText:`로봇 기준 +${axis.toUpperCase()}`,
      color:"#64748b",position:coordinateWorldOffset({x:0,y:0,z:0,[axis]:65})})),
    // Use only the lesson's visible points. Never compute expected answers for labels.
    ...(visual.trails ? endpoints : combineEndpoints(endpoints)),
    ...(visual.trails??[]).map(t=>({id:`trail-${t.id}`,text:short(t.label),fullText:t.label,color:t.color,position:coordinateWorldOffset(t.to)})),
  ];
}

export type LabelBox = { x: number; y: number; width: number; height: number };
export type ProjectedLabel = { id: string; x: number; y: number; width: number; height: number };
export type PlacedLabel = ProjectedLabel & { box: LabelBox; leader: { x: number; y: number } };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));
export function overlapArea(a: LabelBox, b: LabelBox, gap = 0) {
  return Math.max(0, Math.min(a.x+a.width+gap, b.x+b.width)-Math.max(a.x-gap,b.x))
    * Math.max(0, Math.min(a.y+a.height+gap,b.y+b.height)-Math.max(a.y-gap,b.y));
}
/** Pixel-space labels. Leaders retain the true projected point even when two points coincide. */
export function placeCoordinateLabels(labels: ProjectedLabel[], width: number, height: number,
  reserved: LabelBox[] = [], previous: Map<string, PlacedLabel> = new Map()): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const points = labels.map(p => ({ x:p.x-5, y:p.y-5, width:10, height:10 }));
  for (const label of labels) {
    const w = Math.min(label.width, Math.max(1,width-16)), h = label.height;
    const boxAt = (x:number,y:number): LabelBox => ({x:clamp(x,8,Math.max(8,width-w-8)),y:clamp(y,72,Math.max(72,height-h-54)),width:w,height:h});
    const candidates: LabelBox[] = [];
    const old = previous.get(label.id);
    if (old) candidates.push(boxAt(label.x + old.box.x-old.x, label.y + old.box.y-old.y));
    // Try nearby placements first; search further only when the local cluster is full.
    for (const radius of [16,40,72,112,164,228]) {
      candidates.push(boxAt(label.x+radius,label.y-h/2),boxAt(label.x-radius-w,label.y-h/2),
        boxAt(label.x-w/2,label.y-radius-h),boxAt(label.x-w/2,label.y+radius));
      for (const sx of [-1,1]) for (const sy of [-1,1])
        candidates.push(boxAt(label.x+(sx>0?radius:-radius-w),label.y+(sy>0?radius:-radius-h)));
    }
    const obstacles = [...reserved,...placed.map(p=>p.box),...points];
    const score = (b:LabelBox) => obstacles.reduce((sum,o)=>sum+overlapArea(b,o,6),0)*10000
      + Math.hypot(b.x+b.width/2-label.x,b.y+b.height/2-label.y);
    let best = candidates[0], cost = score(best) - (old ? 18 : 0);
    for (const candidate of candidates.slice(1)) {
      const next = score(candidate); if (next < cost) {best=candidate;cost=next;}
    }
    // Stable edge attachment, never a fabricated world-space offset.
    const leader = {x:clamp(label.x,best.x,best.x+best.width),y:clamp(label.y,best.y,best.y+best.height)};
    placed.push({...label,box:best,leader});
  }
  return placed;
}
