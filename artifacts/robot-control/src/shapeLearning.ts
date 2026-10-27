/** Mathematics for the shared shape lessons. Robot execution stays in RobotArm. */
export type ShapeLessonShape = "사각형" | "삼각형" | "동그라미";
export type ShapeLessonPoint = { x:number; y:number; z:number; r:number };
export type ShapeLessonStep = { type:"MoveJ"|"MoveL"|"MoveC"; label:string; coords?:ShapeLessonPoint; via?:ShapeLessonPoint };
export type LessonQuestion = { key:string; label:string; unit?:string; options?:{value:string;label:string}[]; answer:number|string; hint:string; feedback?:Record<string,string> };
export type ShapeLessonBrief = {
  contextLabel:string; contextValue:string; conditionLabel:string; conditionValue:string;
  focus:string; note?:string;
};
export type ShapePathPlanRow = {
  label:string; kind:"vertex"|"via"|"closure"; xKey:string; yKey:string;
  /** Z and tool orientation are given conditions, not hidden XY answers. */
  z:number; r:number; sequenceIndex:number;
};
export type ShapePathPlan = { start:ShapeLessonPoint; radiusKey?:string; rows:ShapePathPlanRow[]; requiredKeys:string[]; instruction:string };
export type ShapeLesson = {
  id:string; difficulty:"기초"|"응용"|"심화"; title:string; instruction:string; reflection:string;
  taskKind: "practice" | "representative" | "transfer";
  brief:ShapeLessonBrief;
  pathPlan:ShapePathPlan;
  sequence:ShapeLessonStep[]; targetSequence?:ShapeLessonStep[]; circleCenter:{x:number;y:number};
  concept:LessonQuestion[]; relations:LessonQuestion[]; calculation:LessonQuestion[]; prediction:LessonQuestion[];
};
export const SHAPE_LESSON_COUNT = 6;
type SequenceInput = readonly {type:string;label:string;coords?:ShapeLessonPoint;via?:ShapeLessonPoint}[];
type LabeledPoint = ShapeLessonPoint & {label?:string};
const point=(x:number,y:number):ShapeLessonPoint=>({x,y,z:0,r:0});
const distance=(a:ShapeLessonPoint,b:ShapeLessonPoint)=>Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
const norm=(a:number)=>((a%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
const show=(n:number)=>String(Math.round(n*100)/100);
const choice=(key:string,label:string,answer:string,options:[string,string][],hint:string):LessonQuestion=>({key,label,answer,options:options.map(([value,label])=>({value,label})),hint});
const number=(key:string,label:string,answer:number,hint:string,unit="mm"):LessonQuestion=>({key,label,answer,hint,unit});
const cloneStep=(step:ShapeLessonStep):ShapeLessonStep=>({...step,coords:step.coords?{...step.coords}:undefined,via:step.via?{...step.via}:undefined});
const DIFFICULTIES = ["기초","기초","응용","응용","심화","심화"] as const;
// Retain the square course's calibrated coordinates and intentional final-task fault.
const SQUARES = [
  {x:200,y:100,width:100,height:200,xDir:1,yDir:-1},
  {x:320,y:-80,width:100,height:160,xDir:-1,yDir:1},
  {x:180,y:-60,width:120,height:150,xDir:1,yDir:1},
  {x:310,y:80,width:90,height:140,xDir:-1,yDir:-1},
  {x:190,y:90,width:130,height:180,xDir:1,yDir:-1},
  {x:320,y:-75,width:110,height:150,xDir:-1,yDir:1},
];
function squareSequence(index:number,motionMode:"MoveJ"|"MoveL",injectFault=false):ShapeLessonStep[] {
  const s=SQUARES[index],a=point(s.x,s.y),b=point(s.x+s.xDir*s.width,s.y);
  const c=point(b.x+(injectFault&&index===5?20:0),s.y+s.yDir*s.height),d=point(s.x,c.y);
  return [a,b,c,d,a].map((coords,i)=>({type:i===0?"MoveJ":motionMode,
    label:i===0?"P1 시작점으로 이동":i===4?"P4 → P1 도형 닫기 (복귀)":`P${i} → P${i+1}`,coords:{...coords}}));
}
const TRIANGLES = [
  [[250,100],[300,-80],[200,-80]],
  [[210,70],[310,20],[230,-70]],
  [[200,60],[290,10],[240,-70]],
  [[190,60],[310,60],[250,-100]],
  [[210,80],[300,-40],[200,-60]],
  [[300,80],[190,20],[270,-80]],
] as const;
// Start angles and radii change separately so each task introduces one new relation.
const CIRCLES = [
  {x:250,y:0,radius:80,angle:90}, {x:250,y:0,radius:60,angle:0},
  {x:240,y:10,radius:60,angle:90}, {x:250,y:0,radius:50,angle:90},
  {x:250,y:0,radius:70,angle:90}, {x:250,y:0,radius:80,angle:0},
];
function baseSequence(shape:ShapeLessonShape,index:number,motionMode:"MoveJ"|"MoveL") {
  if(shape==="사각형")return squareSequence(index,motionMode,true);
  if(shape==="삼각형") {
    const vertices=TRIANGLES[index].map(([x,y])=>point(x,y));
    return [...vertices,vertices[0]].map((coords,i):ShapeLessonStep=>({type:i===0?"MoveJ":motionMode,label:i===0?"P1 시작점으로 이동":i===3?"P3 → P1 도형 닫기 (복귀)":`P${i} → P${i+1}`,coords:{...coords}}));
  }
  const c=CIRCLES[index],onCircle=(degrees:number)=>point(c.x+c.radius*Math.cos(degrees*Math.PI/180),c.y+c.radius*Math.sin(degrees*Math.PI/180));
  const start=onCircle(c.angle);
  return [{type:motionMode,label:"P1 시작점으로 이동",coords:start},...Array.from({length:4},(_,i):ShapeLessonStep=>({
    type:"MoveC",label:`P${i+1} → ${i===3?"P1":"P"+(i+2)} 원호${i===3?" (복귀)":""}`,
    coords:i===3?{...start}:onCircle(c.angle-90*(i+1)),via:onCircle(c.angle-90*i-45),
  }))] as ShapeLessonStep[];
}
const axisOptions:[string,string][]=[["xy","X와 Y가 함께 변한다"],["x","X만 변한다"],["y","Y만 변한다"],["none","X와 Y는 변하지 않는다"]];
const moveOptions:[string,string][]=[["straight","각 변이 직선인 경로"],["joint","관절 움직임에 따라 휘어질 수 있는 경로"]];
const distanceOptions:[string,string][]=[["pythagoras","√(ΔX² + ΔY² + ΔZ²)"],["sum","|ΔX| + |ΔY| + |ΔZ|"],["x-only","|ΔX|"]];
function squareQuestions(index:number,sequence:ShapeLessonStep[],targetSequence:ShapeLessonStep[]):Pick<ShapeLesson,"title"|"instruction"|"reflection"|"concept"|"relations"|"calculation"|"prediction"> {
  const s=SQUARES[index],a=targetSequence[0].coords!,b=targetSequence[1].coords!,c=targetSequence[2].coords!,d=targetSequence[3].coords!;
  const actual=sequence.filter(step=>step.coords),first=actual[0]?.coords,last=actual.at(-1)?.coords;
  const actualP3=actual[2]?.coords??c;
  const closed=!!first&&!!last&&distance(first,last)<=0.1;
  const hasJoint=sequence.slice(1).some(step=>step.type==="MoveJ");
  const facts=`시작 P1(${show(a.x)}, ${show(a.y)}, 0). X축 방향 길이 ${s.width} mm, Y축 방향 길이 ${s.height} mm인 직사각형을 그립니다. P1 → P2는 ${s.xDir>0?"+X":"−X"}, P2 → P3는 ${s.yDir>0?"+Y":"−Y"} 방향입니다.`;
  const trajectory=choice("trajectory","현재 이동 명령으로 각 변을 그리면 어떤 궤적이 예상되나요?",hasJoint?"joint":"straight",moveOptions,"MoveL은 TCP를 직선으로 보간합니다. MoveJ는 관절각을 보간하므로 같은 끝점이어도 중간 경로가 달라질 수 있습니다.");
  const closure=choice("closurePrediction","현재 명령의 마지막 점까지 실행하면 도형이 닫히나요?",closed?"closed":"open",[["closed","그리기 시작한 P1으로 돌아와 닫힌다"],["open","마지막 점이 P1과 달라 열린다"]],"마지막 명령 좌표를 첫 명령의 P1 좌표와 비교하세요. 실행 후 로봇의 원래 자세로 돌아가는 이동과는 다릅니다.");
  if(index===0)return {
    title:"네 꼭짓점을 연결해 직사각형 만들기",instruction:`${facts} 각 변에서 변하는 좌표와 유지되는 좌표를 구분하고, P2·P3·P4와 닫힘 좌표를 모두 계획하세요.`,reflection:"P1에서 P2로 이동할 때 X와 Y 중 무엇이 변했는지, 계산과 실행 궤적을 연결해 설명하세요.",
    concept:[choice("squareAxis","P1 → P2에서는 어떤 평면 좌표가 변하나요?","x",axisOptions,"첫 번째 이동은 X축과 나란합니다. Y축 방향 이동은 그다음 변에서 시작합니다.")],
    relations:[choice("firstEdgeRelation","P1 → P2의 좌표 관계식은?","x-plus",[["x-plus","P2 = (P1X + 가로 길이, P1Y)"],["y-plus","P2 = (P1X, P1Y + 가로 길이)"],["x-minus","P2 = (P1X − 가로 길이, P1Y)"]],"이동하는 축에만 길이를 더하고, 이동하지 않는 축은 그대로 둡니다.")],
    calculation:[number("p2x","P2의 X",b.x,"P1의 X에 +X 방향 이동량을 더하세요."),number("p2y","P2의 Y",b.y,"첫 번째 변은 X축과 나란하므로 Y는 변하지 않습니다.")],prediction:[trajectory],
  };
  if(index===1)return {
    title:"음의 방향을 포함한 꼭짓점 찾기",instruction:`${facts} 두 번 이동한 뒤 도착하는 P3를 구하세요.`,reflection:"길이는 양수인데 이동량은 음수가 될 수 있는 이유를 P1 → P2 이동으로 설명하세요.",
    concept:[choice("negativeDirection","−X 방향으로 이동하면 X 좌표는?","decrease",[["decrease","작아진다"],["increase","커진다"],["same","변하지 않는다"]],"축의 양의 방향과 반대인 이동에는 음의 변화량을 사용합니다.")],
    relations:[choice("cornerRelation","P1에서 두 변을 이동한 P3의 좌표식은?","minus-plus",[["minus-plus","(P1X − 가로 길이, P1Y + 세로 길이)"],["plus-plus","(P1X + 가로 길이, P1Y + 세로 길이)"],["minus-minus","(P1X − 가로 길이, P1Y − 세로 길이)"]],"X와 Y의 변화량은 각 축의 이동 방향에 맞추어 따로 더합니다.")],
    calculation:[number("p3x","P3의 X",c.x,"P1의 X에서 −X 방향 길이를 빼세요. 두 번째 변에서는 X가 유지됩니다."),number("p3y","P3의 Y",c.y,"P1의 Y에 +Y 방향 길이를 더하세요.")],prediction:[closure],
  };
  if(index===2)return {
    title:"가로 길이가 바뀌면 달라지는 것",instruction:`${facts} 가로 길이만 20 mm 늘린다고 가정하세요. 새 꼭짓점과 둘레·넓이를 예상하고, 실행에서는 현재 직사각형을 관찰해 비교합니다.`,reflection:"가로 길이를 20 mm 늘리면 둘레와 넓이는 각각 얼마나 늘어나는지 관계식으로 설명하세요.",
    concept:[choice("widthChange","가로 길이만 늘릴 때 그대로인 것은?","height",[["height","세로 길이"],["perimeter","둘레"],["area","넓이"]],"바뀌는 조건은 가로 길이 하나입니다. 세로 길이는 같은 값으로 계산합니다.")],
    relations:[choice("widthRelation","늘어난 가로 길이를 w′, 세로 길이를 h라 하면?","rectangle",[["rectangle","둘레 = 2(w′ + h), 넓이 = w′h"],["single","둘레 = w′ + h, 넓이 = w′h"],["swap","둘레 = w′h, 넓이 = 2(w′ + h)"]],"둘레는 네 변의 길이 합이고, 넓이는 서로 수직인 두 변의 길이의 곱입니다.")],
    calculation:[number("expandedP2x","가로를 늘린 뒤 P2의 X",a.x+s.xDir*(s.width+20),"새 가로 길이를 현재 이동 방향에 맞추어 시작 X에 더하세요."),number("expandedPerimeter","가로를 늘린 뒤 둘레",2*(s.width+20+s.height),"서로 같은 두 가로와 두 세로의 길이를 더하세요."),number("expandedArea","가로를 늘린 뒤 넓이",(s.width+20)*s.height,"새 가로 길이에 그대로인 세로 길이를 곱하세요.","mm²")],
    prediction:[choice("widthPrediction","가로만 20 mm 늘린 경로를 현재 경로와 비교하면?","x-wider",[["x-wider","X 방향 폭만 넓어진다"],["all-scale","X와 Y 방향이 모두 같은 비율로 늘어난다"],["translate","크기는 같고 위치만 옮겨진다"]],"한 방향의 길이를 바꾸는 것과 전체를 확대하거나 평행이동하는 것을 구분하세요.")],
  };
  if(index===3)return {
    title:"반대쪽 변의 좌표 관계",instruction:`${facts} P3 다음 P4는 P1과 같은 X, P3와 같은 Y에 놓여야 합니다. P4와 직사각형의 넓이를 구하세요.`,reflection:"P4를 정할 때 P1과 P3의 어떤 좌표를 각각 사용했는지, 마주 보는 변의 관계로 설명하세요.",
    concept:[choice("oppositeEdges","마주 보는 두 변의 올바른 관계는?","parallel-equal",[["parallel-equal","서로 평행하고 길이가 같다"],["perpendicular","서로 수직이다"],["same-direction","이어 그릴 때 이동 방향도 같다"]],"P1 → P2와 P3 → P4는 길이가 같지만 이동 방향은 반대입니다.")],
    relations:[choice("lastCornerRelation","P4의 좌표와 넓이를 구하는 관계는?","corner-area",[["corner-area","P4 = (P1X, P3Y), 넓이 = 가로 × 세로"],["swapped","P4 = (P3X, P1Y), 넓이 = 가로 × 세로"],["perimeter","P4 = (P1X, P3Y), 넓이 = 2(가로 + 세로)"]],"세 번째 변은 Y를 유지하며 시작 X로 돌아갑니다. 넓이와 둘레를 구분하세요.")],
    calculation:[number("p4x","P4의 X",d.x,"P4 → P1이 Y축과 나란하도록 P1과 같은 X를 사용하세요."),number("p4y","P4의 Y",d.y,"P3 → P4가 X축과 나란하도록 P3의 Y를 유지하세요."),number("area","현재 직사각형의 넓이",s.width*s.height,"가로와 세로 길이를 곱하세요.","mm²")],prediction:[closure],
  };
  if(index===4)return {
    title:"직선 경로와 닫힌 경로 계획하기",instruction:`${facts} 네 변을 직선으로 그릴 명령을 선택하고, 네 변의 총길이와 한 바퀴 후 좌표 변화량을 비교하세요.`,reflection:"네 변의 길이를 모두 더한 값과 전체 ΔX·ΔY가 다른 이유를 설명하고, 선택한 명령이 직선을 보장하는지 관찰하세요.",
    concept:[choice("squareMotion","TCP가 각 변을 직선으로 따라가도록 할 명령은?","MoveL",[["MoveL","각 변에 MoveL"],["MoveJ","각 변에 MoveJ"],["either","MoveJ와 MoveL 어느 것이든 직선 보장"]],"MoveL은 TCP 위치를 직선으로 보간하고, MoveJ는 관절각을 보간합니다.")],
    relations:[choice("closedDisplacement","도형이 P1에서 시작해 P1으로 닫힐 조건은?","zero-sum",[["zero-sum","모든 ΔX의 합 = 0, 모든 ΔY의 합 = 0"],["perimeter","ΔX와 ΔY의 합이 각각 둘레와 같다"],["positive","모든 이동의 ΔX와 ΔY가 양수다"]],"좌표 변화량에는 방향을 나타내는 부호가 있습니다. 반대 방향의 이동량이 서로 상쇄됩니다.")],
    calculation:[number("perimeter","네 변을 직선으로 이은 총길이",2*(s.width+s.height),"서로 같은 가로 두 변과 세로 두 변의 길이를 더하세요."),number("netX","한 바퀴 후 전체 ΔX",0,"P1에서 출발해 같은 P1으로 돌아올 때 마지막 X − 처음 X를 구하세요."),number("netY","한 바퀴 후 전체 ΔY",0,"전체 Y 변화량도 마지막 Y − 처음 Y입니다.")],prediction:[trajectory],
  };
  const matches=sequencesMatch(sequence,targetSequence);
  return {
    title:"닫혔지만 찌그러진 사각형 고치기",instruction:`${facts} 현재 프로그램의 P3는 (${show(actualP3.x)}, ${show(actualP3.y)}, ${show(actualP3.z)})입니다. 목표 직사각형에 필요한 P3를 계산한 뒤 현재 명령과 비교하세요.`,reflection:"시작점으로 돌아왔어도 목표 사각형과 다른 궤적이 나올 수 있는 이유를 설명하세요. 어긋난 명령을 직접 고친 뒤 다시 실행해 비교하세요.",
    concept:[choice("squareDiagnosis","시작점으로 돌아와 도형이 닫혔다는 사실만으로 알 수 있는 것은?","only-closure",[["only-closure","시작점과 끝점이 같다는 것"],["correct-shape","모든 꼭짓점과 변이 목표와 같다는 것"],["returned","실행 전 로봇 자세로도 이미 돌아갔다는 것"]],"닫힘, 목표 도형과의 일치, 실행 전 관절 자세로의 복귀는 각각 따로 확인해야 합니다.")],
    relations:[choice("repairCornerRelation","목표 직사각형의 P3가 만족해야 할 관계는?","same-x-y",[["same-x-y","P3X = P2X, P3Y = P4Y"],["diagonal","P3X = P1X, P3Y = P1Y"],["same-p2","P3X = P2X, P3Y = P2Y"]],"P2 → P3는 Y축과 나란하고 P3 → P4는 X축과 나란해야 합니다.")],
    calculation:[number("p3x","목표 직사각형에 필요한 P3의 X",c.x,"시작 X에 첫 번째 변의 부호 있는 이동량을 더하세요. 두 번째 변에서는 X가 바뀌지 않습니다."),number("p3y","목표 직사각형에 필요한 P3의 Y",c.y,"시작 Y에 두 번째 변의 방향을 반영한 이동량을 더하세요."),number("p3Error","현재 P3의 X 오차 (명령 − 목표)",actualP3.x-c.x,"현재 프로그램의 P3 X에서 계산한 목표 P3 X를 빼세요.")],
    prediction:[choice("programMatch","현재 프로그램으로 실행하면 목표 직사각형과 같은 경로가 되나요?",matches?"match":"mismatch",[["match","각 꼭짓점과 직선 명령이 목표와 같다"],["mismatch","좌표 또는 이동 명령이 달라 목표와 다르다"]],"계산한 목표 좌표와 현재 명령을 비교하세요. 수정 뒤에도 정답이 자동으로 프로그램에 적용되지는 않습니다.")],
  };
}
function triangleQuestions(index:number,sequence:ShapeLessonStep[]):Pick<ShapeLesson,"title"|"instruction"|"reflection"|"concept"|"relations"|"calculation"|"prediction"> {
  const p=sequence.filter(s=>s.coords).map(s=>s.coords!);
  const [a,b,c]=p,last=p[p.length-1],dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;
  const axes=Math.abs(dx)>1e-7?(Math.abs(dy)>1e-7?"xy":"x"):(Math.abs(dy)>1e-7?"y":"none");
  const hasJoint=sequence.slice(1).some(s=>s.type==="MoveJ");
  const closed=distance(a,last)<=0.15;
  const path=p.slice(1).reduce((sum,v,i)=>sum+distance(p[i],v),0);
  const deltaHint="각 축의 주어진 변화량이 0인지 확인하세요. 도착 좌표는 출발 좌표에 변화량을 더해 구합니다.";
  const geometry=triangleConditions(a,b,c);
  const motion=choice("trajectory","선택한 이동 명령으로 그리면 어떤 궤적이 예상되나요?",hasJoint?"joint":"straight",moveOptions,"MoveL은 TCP를 직선으로 보간합니다. MoveJ는 관절각을 보간하므로 TCP의 직선 이동을 보장하지 않습니다.");
  const relation=choice("distanceRelation","P1 → P2의 직선거리를 구할 관계식은?","pythagoras",distanceOptions,"서로 수직인 축의 변화량에는 피타고라스 관계를 적용합니다.");
  if(index===0) return {
    title:"세 꼭짓점을 연결해 삼각형 만들기",instruction:`${geometry}. P1 → P2에서 두 좌표가 어떻게 함께 변하는지 생각해 보세요.`,reflection:"축별 변화량과 실제 빗변의 길이가 어떻게 다른지, 예측과 실행을 근거로 설명하세요.",
    concept:[choice("axisChange","P1 → P2에서는 어떤 평면 좌표가 변하나요?",axes,axisOptions,deltaHint)],relations:[relation],
    calculation:[number("distance","P1 → P2 직선거리",distance(a,b),"세 축의 변화량을 제곱해 더한 뒤 제곱근을 구하세요."),number("returnY","P3에서 P1으로 돌아갈 때 ΔY",a.y-c.y,"ΔY = P1의 Y − P3의 Y. 방향을 나타내는 부호도 적으세요.")],prediction:[motion],
  };
  if(index===1) return {
    title:"세 변으로 경로 닫기",instruction:`${geometry}. P3 다음에 돌아가야 할 좌표를 직접 정하세요.`,reflection:"도형이 닫히려면 마지막 점과 어떤 점이 같아야 하는지 설명하세요. 로봇의 실행 전 자세와도 구분하세요.",
    concept:[choice("closurePoint","삼각형의 마지막 점은 어디와 같아야 하나요?","p1",[["p1","도형을 그리기 시작한 P1"],["p2","P2"],["robot-start","도형을 그리기 전 로봇 자세"]],"도형을 그리는 경로와 시작점까지 접근하는 경로를 구분하세요.")],
    relations:[choice("closureRelation","P3에서 P1으로 돌아가는 변화량은?","end-minus-start",[["end-minus-start","P1 − P3"],["start-minus-end","P3 − P1"],["sum","P1 + P3"]],"이동량은 항상 도착 좌표 − 출발 좌표입니다.")],
    calculation:[number("closeX","삼각형을 닫을 마지막 X",a.x,"마지막 점은 P1과 같아야 합니다."),number("closeY","삼각형을 닫을 마지막 Y",a.y,"마지막 점은 P1과 같아야 합니다."),number("returnY","P3 → P1의 ΔY",a.y-c.y,"끝 Y에서 시작 Y를 빼세요.")],
    prediction:[choice("closurePrediction","현재 명령의 마지막 점까지 실행하면 도형이 닫히나요?",closed?"closed":"open",[["closed","P1으로 돌아와 닫힌다"],["open","마지막 점이 P1과 달라 열린다"]],`현재 마지막 점은 (${show(last.x)}, ${show(last.y)}, ${show(last.z)})입니다. P1과 비교하세요.`)],
  };
  if(index===2) return {
    title:"위치가 바뀌어도 같은 삼각형",instruction:`${geometry}. 이 삼각형의 모든 점을 X로 +20 mm, Y로 −20 mm 평행이동한다고 가정하세요. 실행에서는 현재 삼각형을 관찰하고 두 경우를 비교합니다.`,reflection:"점의 좌표는 변하지만 두 점 사이의 차이는 어떻게 되는지 식으로 설명하세요.",
    concept:[choice("translationConcept","모든 점을 똑같이 옮기면 변의 길이는?","same",[["same","그대로 유지된다"],["longer","길어진다"],["shorter","짧아진다"]],"두 점에서 같은 이동량을 빼면 좌표의 차이에 무엇이 남는지 생각하세요.")],
    relations:[choice("translationRelation","평행이동한 점의 좌표식은?","translate",[["translate","(X + 20, Y − 20)"],["scale","(20X, −20Y)"],["swap","(Y + 20, X − 20)"]],"평행이동은 좌표에 일정한 값을 더하는 변환입니다.")],
    calculation:[number("translatedP2x","이동 후 P2의 X",b.x+20,"현재 P2의 X에 20을 더하세요."),number("translatedP2y","이동 후 P2의 Y",b.y-20,"현재 P2의 Y에서 20을 빼세요."),number("distance","이동 후 P1 → P2 직선거리",distance(a,b),"두 점을 같은 양만큼 옮기면 좌표 차이는 변하지 않습니다.")],
    prediction:[choice("translationPrediction","현재 궤적과 평행이동한 궤적을 겹쳐 비교하면?","same-shape",[["same-shape","위치만 다르고 모양과 크기는 같다"],["larger","이동한 삼각형이 더 크다"],["rotated","삼각형의 방향이 회전한다"]],"평행이동은 회전이나 확대와 다릅니다.")],
  };
  if(index===3) return {
    title:"이동거리와 변위 구분하기",instruction:`${geometry}. 현재 경유점을 모두 직선으로 연결했을 때의 총길이와 시작·끝 사이의 거리를 비교하세요.`,reflection:"로봇이 많이 움직여도 시작점과 끝점의 거리가 작을 수 있는 이유를 설명하세요. MoveJ 실행이면 실제 궤적 길이와 직선 합도 구분하세요.",
    concept:[choice("distanceVsDisplacement","경유점 사이의 직선거리 합과 시작·끝 사이의 거리는 항상 같나요?","different",[["different","경로에 따라 다르다"],["same","항상 같다"]],"출발점으로 돌아오는 경로를 생각하세요.")],
    relations:[choice("pathRelation","경유점을 직선으로 이었을 때의 총길이는?","sum-segments",[["sum-segments","각 구간의 직선거리 합"],["endpoints","처음 점과 마지막 점 사이의 거리"],["sum-x","X 좌표의 합"]],"각 변의 길이는 항상 0 이상이며 모두 더해야 합니다.")],
    calculation:[number("pathLength","경유점 사이 직선거리의 합",path,"각 구간에 피타고라스 관계를 적용한 뒤 길이를 더하세요."),number("displacement","P1과 마지막 점 사이 거리",distance(a,last),"처음 점과 마지막 점만 비교하세요.")],prediction:[motion],
  };
  if(index===4) return {
    title:"빗변 길이의 잘못된 계산 찾기",instruction:`${geometry}. 한 학생이 P1 → P2 거리를 |ΔX| + |ΔY| + |ΔZ|로 계산했습니다. 축을 따라 꺾어 가는 길과 직선 길이를 비교하세요.`,reflection:"축별 이동량의 절댓값을 더하면 어떤 경로의 길이가 되는지 설명하고, 직선거리와의 차이를 해석하세요.",
    concept:[choice("diagonalDiagnosis","|ΔX| + |ΔY| + |ΔZ|가 나타내는 것은?","axis-route",[["axis-route","각 축을 따라 차례로 이동하는 경로 길이"],["straight","항상 두 점 사이의 직선거리"],["signed","방향을 포함한 변위"]],"먼저 X 방향으로만, 다음 Y 방향으로만 이동하는 꺾인 경로를 그려 보세요.")],relations:[relation],
    calculation:[number("distance","P1 → P2 직선거리",distance(a,b),"변화량의 제곱합에 제곱근을 적용하세요."),number("axisRoute","축을 따라 차례로 가는 거리",Math.abs(dx)+Math.abs(dy)+Math.abs(dz),"각 축 변화량의 절댓값을 더하세요."),number("extraDistance","축을 따라 가면 더 이동하는 거리",Math.abs(dx)+Math.abs(dy)+Math.abs(dz)-distance(a,b),"축을 따라 가는 거리 − 직선거리로 계산하세요.")],
    prediction:[choice("shortestPrediction","두 경로 중 더 짧은 것은?",Math.abs(dx)+Math.abs(dy)+Math.abs(dz)-distance(a,b)>0.1?"direct":"same",[["direct","두 점을 바로 잇는 직선"],["axis","축을 따라 차례로 가는 길"],["same","둘의 길이가 같다"]],"직선거리와 축별 거리의 합을 비교하세요.")],
  };
  return {
    title:"닫힘 오차를 고치는 마지막 이동",instruction:`${geometry}. P3에서 X로 ${show(a.x-c.x+20)} mm, Y로 ${show(a.y-c.y)} mm, Z로 ${show(a.z-c.z)} mm 이동하도록 잘못 입력했다고 가정하세요. 필요한 이동과 오차를 구하세요. 실행에서는 현재 명령을 확인합니다.`,reflection:"마지막 명령을 수정해 도형을 닫는 일과, 도형 실행 후 로봇을 원래 자세로 돌려놓는 일이 왜 별개인지 설명하세요.",
    concept:[choice("repairConcept","마지막 이동의 X가 필요한 값보다 20 mm 크면?","x-error",[["x-error","끝점은 P1보다 X가 20 mm 크다"],["y-error","끝점은 P1보다 Y가 20 mm 크다"],["no-error","도형은 정확히 닫힌다"]],"P3 좌표에 마지막 변화량을 더해 끝점을 구하세요.")],
    relations:[choice("repairRelation","도형을 닫는 마지막 변화량은?","negative-sum",[["negative-sum","앞선 두 이동의 변화량 합에 −1을 곱한다"],["same-sum","앞선 두 이동의 변화량을 더한다"],["zero","X와 Y를 모두 0으로 한다"]],"닫힌 도형에서는 모든 변화량의 합이 0입니다.")],
    calculation:[number("returnX","정확히 닫기 위한 P3 → P1의 ΔX",a.x-c.x,"P1의 X − P3의 X로 계산하세요."),number("returnY","정확히 닫기 위한 P3 → P1의 ΔY",a.y-c.y,"P1의 Y − P3의 Y로 계산하세요."),number("closingError","가정한 잘못된 명령의 닫힘 오차",20,"Y와 Z가 맞더라도 X 오차가 남습니다.")],
    prediction:[choice("returnPrediction","도형이 닫힌 다음 로봇은 어디로 복귀해야 하나요?","saved-pose",[["saved-pose","실행 직전에 저장한 관절 자세"],["p1","항상 P1에 머무르기"],["zero","항상 모든 관절각 0도"]],"도형 시작점 P1과 사용자가 실행을 누르기 전 로봇 자세는 서로 다를 수 있습니다.")],
  };
}

function circleQuestions(index:number,sequence:ShapeLessonStep[],center:{x:number;y:number}):Pick<ShapeLesson,"title"|"instruction"|"reflection"|"concept"|"relations"|"calculation"|"prediction"> {
  const p=sequence.filter(s=>s.coords).map(s=>s.coords!),a=p[0],b=p[1],via=sequence.find(s=>s.via)?.via??a;
  const radius=Math.hypot(a.x-center.x,a.y-center.y),angle=norm(Math.atan2(a.y-center.y,a.x-center.x))*180/Math.PI;
  const quarter=point(center.x+(a.y-center.y),center.y-(a.x-center.x));
  const midpoint=point((a.x+b.x)/2,(a.y+b.y)/2),viaRadius=Math.hypot(via.x-center.x,via.y-center.y);
  const arc=arcGeometry(a,via,b),sweep=Math.abs(arc?.sweep??0),arcLength=arc?arc.radius*sweep:distance(a,b),chordLength=distance(a,b);
  const onCircle=Math.abs(viaRadius-radius)<=0.1;
  const facts=`중심 O(${show(center.x)}, ${show(center.y)}), 시작 P1(${show(a.x)}, ${show(a.y)}). 시계방향으로 네 원호를 연결합니다`;
  const startFacts=`중심 O(${show(center.x)}, ${show(center.y)}), 시작 P1(${show(a.x)}, ${show(a.y)})`;
  const endRadius=Math.hypot(b.x-center.x,b.y-center.y),endAngle=norm(Math.atan2(b.y-center.y,b.x-center.x))*180/Math.PI;
  const cardinal=Math.abs(endAngle)<1e-7?"+X":Math.abs(endAngle-90)<1e-7?"+Y":Math.abs(endAngle-180)<1e-7?"−X":Math.abs(endAngle-270)<1e-7?"−Y":null;
  const endDirection=cardinal?`${cardinal} 방향`:`+X축에서 반시계방향 ${show(endAngle)}° 방향`;
  const endPosition=Math.abs(endRadius-radius)<1e-7?"P1과 같은 거리만큼":"중심에서 "+show(endRadius)+" mm만큼";
  const radiusRelation=choice("radiusRelation","중심 O와 P1로 반지름을 구하는 관계식은?","distance",[["distance","√((P1X − OX)² + (P1Y − OY)²)"],["x","P1의 X 좌표"],["sum","P1X + P1Y"]],"중심에서 점까지의 거리를 구하세요. 원은 XY 평면에 놓여 있습니다.");
  const trajectory=choice("arcPrediction","현재 첫 MoveC는 어떤 경로를 만드나요?",arc?"via-arc":"line",[["via-arc","시작점·경유점·끝점을 지나는 원호"],["line","세 점이 일직선이라 직선 경로"],["always-circle","경유점에 관계없이 표시된 중심의 원"]],"세 점이 한 직선 위에 있지 않으면 그 세 점으로 원호가 정해집니다. 표시된 중심과 일치하는지는 별도로 확인해야 합니다.");
  if(index===0) return {
    title:"끝점과 경유점으로 원 그리기",instruction:`${startFacts}. P2는 O에서 ${endDirection}으로 ${endPosition} 떨어져 있습니다. 반지름을 구하고 네 원호의 끝점·경유점과 닫힘 좌표를 모두 계산하세요.`,reflection:"반지름이 점의 좌표 자체가 아니라 중심과 점 사이의 거리인 이유를 설명하세요.",
    concept:[choice("radiusConcept","반지름은 무엇인가요?","center-distance",[["center-distance","중심에서 원 위의 점까지의 거리"],["diameter","원의 양끝 사이의 거리"],["x-position","점의 X 좌표"]],"중심에서 원 위 여러 점까지 선분을 그려 비교하세요.")],relations:[radiusRelation],
    calculation:[number("radius","O → P1의 반지름",radius,"중심과 P1 좌표의 차이를 이용하세요."),number("p2x","현재 P2의 X",b.x,"중심과 P2의 상대 위치를 확인하세요.")],prediction:[trajectory],
  };
  if(index===1) return {
    title:"각도에서 원 위 좌표로",instruction:`${startFacts}. 현재 P1의 각도는 +X축 기준 반시계방향 ${show(angle)}°입니다. P1에서 시계방향 90° 회전한 목표점을 구하세요.`,reflection:"시계방향 회전에서 각도가 줄어드는 것과 X·Y 좌표가 달라지는 관계를 설명하세요.",
    concept:[choice("angleConcept","P1에서 시계방향 90° 회전하면 각도는?","minus",[["minus","현재 각도에서 90°를 뺀다"],["plus","현재 각도에 90°를 더한다"],["double","현재 각도를 2배로 한다"]],"+X축에서 반시계방향을 양의 각도로 정의했습니다.")],
    relations:[choice("angleRelation","중심 (OX, OY), 반지름 r, 각도 θ인 점의 좌표는?","trig",[["trig","(OX + r cosθ, OY + r sinθ)"],["swap","(OX + r sinθ, OY + r cosθ)"],["no-center","(r cosθ, r sinθ)"]],"중심의 위치에 반지름 벡터의 X·Y 성분을 더합니다.")],
    calculation:[number("quarterX","90° 시계 회전한 목표점 X",quarter.x,"중심에 대한 (ΔX, ΔY)는 시계방향 90°에서 (ΔY, −ΔX)가 됩니다."),number("quarterY","90° 시계 회전한 목표점 Y",quarter.y,"회전한 상대 좌표에 중심 좌표를 더하세요."),number("quarterAngle","목표점의 각도 (0 이상 360 미만)",norm((angle-90)*Math.PI/180)*180/Math.PI,"음수 각도이면 360°를 더해 같은 방향으로 표현하세요.","°")],prediction:[trajectory],
  };
  if(index===2) return {
    title:"중심을 옮겨 원 배치하기",instruction:`${facts}. 중심과 모든 경로점을 함께 X로 +20 mm 옮긴 원을 예상하세요. 실행에서는 현재 원을 관찰하고 비교합니다.`,reflection:"중심과 경로점을 함께 옮길 때 반지름이 유지되는 이유를 좌표 차이로 설명하세요.",
    concept:[choice("centerTranslation","같은 원을 오른쪽으로 옮기려면?","all",[["all","중심·끝점·경유점을 모두 같은 양만큼 옮긴다"],["center-only","중심 표시만 옮긴다"],["via-only","경유점만 옮긴다"]],"MoveC는 끝점과 경유점으로 경로를 만듭니다. 중심 표시만 바꿔서는 경로가 바뀌지 않습니다.")],
    relations:[choice("centerRelation","X로 +20 mm 평행이동하는 식은?","all-x",[["all-x","중심과 모든 경로점의 X에 20을 더한다"],["radius","반지름에 20을 더한다"],["all-y","모든 Y에 20을 더한다"]],"같은 이동량을 중심과 각 점에 적용하세요.")],
    calculation:[number("shiftedCenterX","이동 후 중심 X",center.x+20,"현재 중심 X에 20을 더하세요."),number("shiftedP2x","이동 후 P2의 X",b.x+20,"현재 P2의 X에 같은 20을 더하세요."),number("radius","이동 후 반지름",radius,"중심과 점을 함께 옮기면 두 좌표의 차이는 그대로입니다.")],
    prediction:[choice("shiftPrediction","두 원의 궤적을 비교하면?","translated",[["translated","크기는 같고 위치만 X로 20 mm 다르다"],["larger","이동한 원의 반지름이 20 mm 크다"],["unchanged","궤적의 위치도 같다"]],"평행이동과 반지름 변경을 구분하세요.")],
  };
  if(index===3) return {
    title:"반지름으로 원의 크기 바꾸기",instruction:`${facts}. 중심을 고정하고 중심에서 각 점까지의 벡터를 1.5배로 늘린 원을 예상하세요. 실행에서는 현재 원을 관찰합니다.`,reflection:"원의 확대에서 중심을 빼고 상대 좌표를 늘린 다음 중심을 다시 더해야 하는 이유를 설명하세요.",
    concept:[choice("scaleConcept","원을 1.5배 확대할 때 고정할 것은?","center",[["center","원의 중심"],["p1","원 위의 모든 점"],["radius","반지름"]],"중심이 같은 원을 더 크게 만드는 상황입니다.")],
    relations:[choice("scaleRelation","확대 후 점 P′를 구하는 식은?","relative",[["relative","O + 1.5(P − O)"],["global","1.5P"],["add","P + 1.5"]],"중심 기준 상대 좌표를 확대해야 중심이 움직이지 않습니다.")],
    calculation:[number("scaledRadius","확대 후 반지름",radius*1.5,"현재 반지름에 1.5를 곱하세요."),number("scaledP2x","확대 후 P2의 X",center.x+1.5*(b.x-center.x),"중심 X + 1.5 × (P2의 X − 중심 X)."),number("scaledP2y","확대 후 P2의 Y",center.y+1.5*(b.y-center.y),"중심 Y + 1.5 × (P2의 Y − 중심 Y).")],
    prediction:[choice("scalePrediction","확대 후 원의 둘레는?","factor",[["factor","원래 둘레의 1.5배"],["square","원래 둘레의 2.25배"],["same","원래 둘레와 같다"]],"둘레 2πr와 넓이 πr²를 구분하세요.")],
  };
  if(index===4) return {
    title:"경유점이 원 위에 있는지 진단하기",instruction:`${facts}. 첫 경유점 V12와 선분 P1P2의 중점을 비교하세요. V12의 조건은 경로 계획에 제시됩니다.`,reflection:"시작점과 끝점이 같아도 경유점을 바꾸면 원호가 달라지는 이유를 설명하세요. 현의 중점과 원호의 중점도 구분하세요.",
    concept:[choice("viaConcept","표시한 중심과 반지름의 원을 따라가려면 경유점은?","same-circle",[["same-circle","중심에서의 거리가 반지름과 같은 점"],["chord-midpoint","항상 시작점과 끝점의 좌표 평균"],["anywhere","아무 점이나 가능"]],"원 위의 모든 점은 중심으로부터 같은 거리에 있습니다.")],relations:[radiusRelation],
    calculation:[number("viaRadius","O → 경유점 V 거리",viaRadius,"중심과 실제 경유점 좌표의 차이를 이용하세요."),number("midpointRadius","O → 선분 P1P2의 중점 거리",Math.hypot(midpoint.x-center.x,midpoint.y-center.y),"먼저 끝점 좌표의 평균으로 선분 중점을 구한 뒤 중심에서의 거리를 구하세요.")],
    prediction:[choice("viaPrediction","현재 경유점 V는 표시한 원 위에 있나요?",onCircle?"on":"off",[["on","중심과의 거리가 반지름과 같아 원 위에 있다"],["off","중심과의 거리가 달라 다른 원호를 만든다"]],"O → V 거리와 O → P1 거리를 비교하세요.")],
  };
  return {
    title:"원호와 직선 중 경로 선택하기",instruction:`${facts}. 첫 MoveC 원호와 같은 두 끝점을 잇는 MoveL 직선을 비교하세요. 원호의 중심각은 ${show(sweep*180/Math.PI)}°, 그 원호의 반지름은 ${show(arc?.radius??0)} mm입니다.`,reflection:"끝점이 같아도 MoveC와 MoveL의 이동거리와 지나가는 곳이 달라지는 이유를 설명하세요.",
    concept:[choice("arcVsChord","MoveC를 같은 끝점의 MoveL로 바꾸면?","chord",[["chord","두 끝점을 바로 잇는 직선이 된다"],["same","경유점을 지나는 같은 원호가 된다"],["full-circle","한 바퀴 도는 원이 된다"]],"MoveL은 경유점 없이 현재점과 끝점을 직선으로 연결합니다.")],
    relations:[choice("arcRelation","중심각 θ를 라디안으로 나타낼 때 원호 길이는?","r-theta",[["r-theta","r × |θ|"],["two-r","2r"],["pi-r-square","πr²"]],"한 바퀴 각도 2π일 때 길이가 2πr임을 이용하세요.")],
    calculation:[number("arcLength","첫 MoveC의 원호 길이",arcLength,"표시된 원호의 반지름에 라디안 중심각을 곱하세요."),number("chordLength","같은 끝점을 잇는 직선거리",chordLength,"두 끝점의 좌표 차이에 피타고라스 관계를 적용하세요."),number("arcExtra","원호가 직선보다 긴 거리",arcLength-chordLength,"원호 길이에서 직선 길이를 빼세요.")],
    prediction:[choice("pathChoice","MoveL과 현재 MoveC의 경로 길이를 비교하면?",arcLength-chordLength>0.1?"line-shorter":"same",[["line-shorter","MoveL 직선이 더 짧다"],["arc-shorter","MoveC 원호가 더 짧다"],["same","두 길이가 같다"]],"궤적은 끝점뿐 아니라 중간에 어디를 지나는지로 달라집니다.")],
  };
}

/** Prominent givens and the task to solve; calculated answers stay in the questions. */
function problemBrief(shape:ShapeLessonShape,index:number,sequence:ShapeLessonStep[],targetSequence:ShapeLessonStep[]|undefined,center:{x:number;y:number}):ShapeLessonBrief {
  const p=sequence.filter(step=>step.coords).map(step=>step.coords!);
  const xyz=(v:ShapeLessonPoint)=>`(${show(v.x)}, ${show(v.y)}, ${show(v.z)})`;
  const xy=(v:{x:number;y:number})=>`(${show(v.x)}, ${show(v.y)})`;
  if(shape==="사각형") {
    const s=SQUARES[index],start=targetSequence![0].coords!;
    const dimensions=`가로(X) ${s.width} mm · 세로(Y) ${s.height} mm`;
    const directions=`P1 → P2: ${s.xDir>0?"+X":"−X"} · P2 → P3: ${s.yDir>0?"+Y":"−Y"}`;
    const common={contextLabel:"목표 시작점 · (X, Y, Z) mm",contextValue:`P1 ${xyz(start)}`,
      conditionLabel:"목표 직사각형",conditionValue:`${dimensions}\n${directions}`};
    if(index===0)return {...common,focus:"네 변의 좌표 관계를 정하고, P2·P3·P4와 마지막 닫힘 좌표를 모두 구하세요."};
    if(index===1)return {...common,focus:"각 축의 이동 방향을 반영해, 두 변을 이동한 P3를 구하세요."};
    if(index===2)return {...common,conditionLabel:"현재 크기와 변경 가정",conditionValue:`${dimensions}\n${directions}\n가로만 +20 mm · 세로 유지`,
      focus:"가로를 늘린 뒤의 P2, 둘레, 넓이를 예상하세요.",note:"길이를 늘리는 것은 계산에서의 가정입니다. 실행에서는 현재 프로그램의 직사각형을 관찰합니다."};
    if(index===3)return {...common,focus:"P4의 좌표와 넓이를 구하세요. P4는 P1과 같은 X, P3와 같은 Y에 놓습니다."};
    if(index===4)return {...common,focus:"네 변을 직선으로 그릴 명령을 고르고, 총길이와 한 바퀴 후 좌표 변화량을 비교하세요."};
    return {...common,contextLabel:"목표 시작점 / 현재 명령 · (X, Y, Z) mm",contextValue:`목표 P1 ${xyz(start)}\n현재 P3 ${xyz(p[2])}`,
      focus:"목표에 필요한 P3를 계산하고, 현재 명령의 오차를 찾아 수정하세요.",note:"목표 직사각형의 조건은 고정됩니다. 실행에는 직접 편집한 현재 좌표와 이동 명령이 사용됩니다."};
  }
  if(shape==="삼각형") {
    const [a,b,c]=p,last=p[p.length-1];
    const common={contextLabel:"주어진 시작점 · (X, Y, Z) mm",contextValue:`P1 ${xyz(a)}`};
    if(index===0)return {...common,conditionLabel:"살펴볼 이동",conditionValue:"첫 변 P1 → P2 · 돌아오는 변 P3 → P1",
      focus:"P2·P3와 마지막 닫힘 P1의 좌표를 모두 계획하세요. 첫 변의 직선거리와 돌아올 때의 ΔY도 구하세요."};
    if(index===1)return {...common,conditionLabel:"마지막 이동의 조건",conditionValue:"P1 → P2 → P3를 이은 뒤, 삼각형을 닫기",
      focus:"P3 다음에 도착할 좌표와 필요한 ΔY를 직접 정하세요."};
    if(index===2)return {...common,conditionLabel:"평행이동 가정",conditionValue:"모든 점을 X로 +20 mm · Y로 −20 mm",
      focus:"이동 후 P2와 첫 변의 길이를 예상하고, 현재 삼각형과 비교하세요.",note:"평행이동은 계산에서의 가정입니다. 실행에서는 현재 프로그램의 삼각형을 관찰합니다."};
    if(index===3)return {...common,conditionLabel:"비교할 거리",conditionValue:`경유점을 직선으로 이은 총길이 ↔ 시작·끝 사이 거리\n현재 마지막 점 ${xyz(last)} mm`,
      focus:"각 구간을 더한 거리와 처음·마지막 점만으로 구한 거리를 비교하세요."};
    if(index===4)return {...common,conditionLabel:"검토할 학생의 계산",conditionValue:"P1 → P2 거리 = |ΔX| + |ΔY| + |ΔZ|",
      focus:"직선거리와 축을 따라 가는 거리를 계산하고, 두 값의 차이를 해석하세요."};
    return {...common,conditionLabel:"잘못 입력한 마지막 이동 · 가정",conditionValue:`P3에서 ΔX ${show(a.x-c.x+20)} mm\nΔY ${show(a.y-c.y)} mm · ΔZ ${show(a.z-c.z)} mm`,
      focus:"정확히 닫기 위한 이동량과, 가정한 명령의 닫힘 오차를 구하세요.",note:"잘못된 마지막 이동은 문제의 가정입니다. 실행에서는 현재 프로그램의 명령과 복귀 동작을 확인합니다."};
  }
  const [a,b]=p,via=sequence.find(step=>step.via)?.via??a;
  const common={contextLabel:"현재 중심과 경로점 · (X, Y) mm",contextValue:`O ${xy(center)}\nP1 ${xy(a)}`};
  if(index===0) {
    const radius=Math.hypot(a.x-center.x,a.y-center.y),endRadius=Math.hypot(b.x-center.x,b.y-center.y);
    const angle=norm(Math.atan2(b.y-center.y,b.x-center.x))*180/Math.PI;
    const cardinal=Math.abs(angle)<1e-7?"+X":Math.abs(angle-90)<1e-7?"+Y":Math.abs(angle-180)<1e-7?"−X":Math.abs(angle-270)<1e-7?"−Y":null;
    const direction=cardinal?`${cardinal} 방향`:`+X축에서 반시계방향 ${show(angle)}°`;
    const separation=Math.abs(endRadius-radius)<1e-7?"O → P1과 같은 거리":`O에서 ${show(endRadius)} mm`;
    return {...common,conditionLabel:"다음 점 P2의 조건",conditionValue:`O에서 ${direction}\n${separation}`,
      focus:"중심과 시작점으로 반지름을 구하고, P2·P3·P4와 네 경유점, 마지막 닫힘 P1의 좌표를 모두 계획하세요."};
  }
  if(index===1) {
    const angle=norm(Math.atan2(a.y-center.y,a.x-center.x))*180/Math.PI;
    return {...common,conditionLabel:"회전 조건",conditionValue:`현재 P1: +X축 기준 반시계방향 ${show(angle)}°\nP1에서 시계방향 90° 회전`,
      focus:"회전한 목표점의 X·Y 좌표와 각도를 구하세요."};
  }
  if(index===2)return {...common,conditionLabel:"평행이동 가정",conditionValue:"중심과 모든 경로점을 함께 X로 +20 mm",
    focus:"이동 후 중심 X, P2의 X, 반지름을 예상하세요.",note:"평행이동은 계산에서의 가정입니다. 실행에서는 현재 프로그램의 원을 관찰합니다."};
  if(index===3)return {...common,conditionLabel:"확대 가정",conditionValue:"중심 O 고정 · 중심에서 각 점까지의 벡터를 1.5배",
    focus:"확대 후 반지름과 P2의 좌표를 구하세요.",note:"확대는 계산에서의 가정입니다. 실행에서는 현재 프로그램의 원을 관찰합니다."};
  if(index===4)return {...common,conditionLabel:"비교할 경유점",conditionValue:"첫 경유점 V12와 선분 P1P2의 중점 비교",
    focus:"O에서 V와 선분 중점까지의 거리를 구하고, V가 표시한 원 위에 있는지 판단하세요."};
  const arc=arcGeometry(a,via,b),sweep=Math.abs(arc?.sweep??0);
  return {...common,conditionLabel:"첫 원호의 조건",conditionValue:`중심각 ${show(sweep*180/Math.PI)}° · 원호 반지름 ${show(arc?.radius??0)} mm\n같은 P1·P2를 잇는 MoveC와 MoveL 비교`,
    focus:"원호 길이와 직선거리, 두 경로의 길이 차이를 구하세요."};
}

function triangleConditions(a:ShapeLessonPoint,b:ShapeLessonPoint,c:ShapeLessonPoint) {
  const delta=(from:ShapeLessonPoint,to:ShapeLessonPoint)=>`(ΔX, ΔY, ΔZ) = (${show(to.x-from.x)}, ${show(to.y-from.y)}, ${show(to.z-from.z)}) mm`;
  return `시작 P1(${show(a.x)}, ${show(a.y)}, ${show(a.z)}). P1 → P2: ${delta(a,b)}. P2 → P3: ${delta(b,c)}. P3에서 P1으로 돌아와 삼각형을 닫습니다`;
}

/** Every full drawing needs a full learner plan; focused task questions are additional evidence. */
function completePathPlanning(shape:ShapeLessonShape,taskIndex:number,sequence:ShapeLessonStep[],targetSequence:ShapeLessonStep[]|undefined,center:{x:number;y:number}) {
  const target=targetSequence??sequence,points=target.filter(step=>step.coords).map(step=>step.coords!);
  const start=points[0],vertexCount=shape==="삼각형"?3:4;
  const radiusKey=shape==="동그라미"?taskIndex===0?"radius":"planRadius":undefined;
  const rows:ShapePathPlanRow[]=[],calculation:LessonQuestion[]=[],relations:LessonQuestion[]=[];
  const addRow=(label:string,kind:ShapePathPlanRow["kind"],xKey:string,yKey:string,value:ShapeLessonPoint,sequenceIndex:number,hint:string)=>{
    rows.push({label,kind,xKey,yKey,z:value.z,r:value.r,sequenceIndex});
    calculation.push(number(xKey,`${label}의 X`,value.x,hint),number(yKey,`${label}의 Y`,value.y,hint));
  };
  for(let index=1;index<vertexCount;index++) {
    const hint=shape==="동그라미"?"중심을 기준으로 각도를 90°씩 줄이고, X = OX + r cosθ, Y = OY + r sinθ를 적용하세요. 별도 조건이 있으면 그 각도와 반지름을 사용합니다.":"직전 점의 좌표에 이 변의 부호 있는 변화량을 더하세요. 변화량이 0인 축의 좌표는 유지합니다.";
    addRow(`P${index+1}`,"vertex",`p${index+1}x`,`p${index+1}y`,points[index],index,hint);
  }
  addRow("닫힘 P1","closure","closeX","closeY",start,vertexCount,"도형을 닫을 마지막 좌표는 그리기 시작한 P1과 같습니다. 장비의 실행 전 자세와 구분하세요.");
  let instruction:string;
  if(shape==="동그라미") {
    const radius=Math.hypot(start.x-center.x,start.y-center.y),startAngle=norm(Math.atan2(start.y-center.y,start.x-center.x))*180/Math.PI;
    const onCircle=(angle:number)=>point(center.x+radius*Math.cos(angle*Math.PI/180),center.y+radius*Math.sin(angle*Math.PI/180));
    const special:string[]=[];
    for(let index=1;index<=4;index++) {
      const label=`V${index}${index===4?1:index+1}`,value=target[index]?.via;
      // Every preset has an explicit via. A removed via is a visible invalid program,
      // while its mathematical plan still specifies the intended quarter-arc midpoint.
      const via=value??onCircle(startAngle-90*(index-1)-45);
      addRow(label,"via",`via${index}${index===4?1:index+1}x`,`via${index}${index===4?1:index+1}y`,via,index,"원호 중간 각도는 시작 각도에서 45°를 뺀 값입니다. X = OX + r cosθ, Y = OY + r sinθ로 계산하세요.");
      const nominalEnd=index===4?start:onCircle(startAngle-90*index),nominalVia=onCircle(startAngle-90*(index-1)-45);
      for(const [name,actual,nominal] of [[`P${index+1}`,points[index],nominalEnd],[label,via,nominalVia]] as const) {
        if(!actual||distance(actual,nominal)<=1e-6)continue;
        const angle=norm(Math.atan2(actual.y-center.y,actual.x-center.x))*180/Math.PI;
        special.push(`${index===4&&name==="P5"?"현재 마지막 명령":name}: O에서 거리 ${show(Math.hypot(actual.x-center.x,actual.y-center.y))} mm, +X축 기준 ${show(angle)}°, Z=${show(actual.z)} mm`);
      }
    }
    calculation.unshift(number(radiusKey!,"기본 경로의 반지름 r",radius,"P1과 중심 O의 좌표 차이에 피타고라스 관계를 적용하세요."));
    // Show each via before its endpoint, in the order the robot will traverse them.
    rows.sort((a,b)=>a.sequenceIndex-b.sequenceIndex||(a.kind==="via"?-1:b.kind==="via"?1:0));
    relations.push(
      choice("radiusRelation","중심 O와 P1로 반지름을 구하는 관계식은?","distance",[["distance","√((P1X − OX)² + (P1Y − OY)²)"],["x","P1의 X 좌표"],["sum","P1X + P1Y"]],"반지름은 중심과 원 위 점 사이의 거리입니다."),
      choice("circleStepRelation","시계방향으로 다음 90° 원호를 그릴 때 끝점의 각도는?","minus-quarter",[["minus-quarter","현재 각도 − 90°"],["plus-quarter","현재 각도 + 90°"],["same","현재 각도와 같음"]],"+X축에서 반시계방향을 양의 각도로 정합니다."),
      choice("circleViaRelation","90° 원호 중간의 경유점 각도는?","minus-half-quarter",[["minus-half-quarter","현재 원호 시작 각도 − 45°"],["minus-quarter","현재 원호 시작 각도 − 90°"],["coordinate-average","시작점과 끝점 좌표의 평균"]],"원호 중간 각도와 두 점을 잇는 직선의 중점을 구분하세요."),
    );
    instruction=`중심 O(${show(center.x)}, ${show(center.y)}), P1(${show(start.x)}, ${show(start.y)}), 시작 각도 ${show(startAngle)}°. 시계방향 90°씩 P2 → P3 → P4 → P1로 닫습니다. 경유점 V12·V23·V34·V41은 각 원호의 시작 각도에서 45° 뺀 위치입니다. X = OX + r cosθ, Y = OY + r sinθ로 끝점과 경유점을 모두 구하세요. 소수 둘째 자리까지 입력해도 됩니다. 모든 점의 Z는 ${show(start.z)} mm입니다.${special.length?` 별도 프로그램 조건: ${special.join("; ")}. 닫힘 계획은 P1로 정하고 현재 마지막 명령과 비교하세요.`:""}`;
  } else if(shape==="사각형") {
    const dx=points[1].x-start.x,dy=points[2].y-points[1].y;
    const signs=(value:number,axis:string)=>`${value>=0?"+":"−"}${axis}`;
    const options:[string,string][]=[
      ["x-forward",`X만 ${signs(dx,"X")} 방향 가로 길이만큼 이동`],
      ["y-forward",`Y만 ${signs(dy,"Y")} 방향 세로 길이만큼 이동`],
      ["x-return",`X만 ${signs(-dx,"X")} 방향 가로 길이만큼 이동`],
      ["y-return",`Y만 ${signs(-dy,"Y")} 방향 세로 길이만큼 이동`],
    ];
    ["12","23","34","41"].forEach((edge,index)=>{
      const axis=index%2===0?"X":"Y",fixed=axis==="X"?"Y":"X";
      const delta=[dx,dy,-dx,-dy][index];
      const hint=`P${edge[0]} → P${edge[1]}에서는 ${fixed}를 유지하고 ${axis}를 ${signs(delta,axis)} 방향으로 바꿉니다.${index===3?" P1로 닫으려면 P2 → P3의 Y 이동을 되돌려야 합니다.":""}`;
      const question=choice(`edge${edge}`,`P${edge[0]} → P${edge[1]}의 좌표 변화 관계`,options[index][0],options,hint);
      question.feedback=Object.fromEntries(options.filter(([value])=>value!==question.answer).map(([value])=>[
        value, value.startsWith(axis.toLowerCase())
          ? `이동 축 ${axis}는 맞지만 방향이 반대입니다. ${hint}`
          : `이 구간에서 유지해야 할 ${fixed}축을 선택했습니다. ${hint}`,
      ]));
      relations.push(question);
    });
    instruction=`P1에서 시작해 P2·P3·P4와 마지막 닫힘 P1의 좌표를 모두 입력하세요. 네 변은 X → Y → X → Y 순서로 이동하며, 뒤의 두 변은 앞의 두 변과 반대 방향입니다. 모든 점의 Z는 ${show(start.z)} mm입니다.`;
  } else {
    ["12","23"].forEach(edge=>relations.push(choice(`edge${edge}`,`P${edge[0]} → P${edge[1]}의 좌표 관계`,"add-delta",[["add-delta",`P${edge[1]} = P${edge[0]} + 주어진 (ΔX, ΔY, ΔZ)`],["subtract-delta",`P${edge[1]} = P${edge[0]} − 주어진 (ΔX, ΔY, ΔZ)`],["absolute-delta",`P${edge[1]} = 변화량 자체를 절대좌표로 사용`]],"이동량은 좌표가 아닙니다. 출발 좌표에 부호 있는 변화량을 더하세요.")));
    relations.push(choice("edge31","P3 → P1로 닫는 좌표 변화 관계","negative-sum",[["negative-sum","앞선 두 변화량을 더한 값에 −1을 곱함"],["same-sum","앞선 두 변화량을 그대로 더함"],["zero","각 축의 변화량을 모두 0으로 함"]],"닫힌 경로에서는 각 축의 전체 변화량 합이 0입니다."));
    instruction=`${triangleConditions(points[0],points[1],points[2])}. 주어진 변화량으로 P2·P3를 계산하고 마지막 닫힘 P1 좌표도 직접 입력하세요. 표의 Z는 주어진 ΔZ로 정한 조건입니다.`;
  }
  return {pathPlan:{start:{...start},radiusKey,rows,requiredKeys:[...relations.map(question=>question.key),...calculation.map(question=>question.key)],instruction},relations,calculation};
}

/** The selected task is finite; edits change its mathematics without replacing its context. */
export function getShapeLesson(shape:ShapeLessonShape,index:number,sequenceOverride?:SequenceInput,circleCenterOverride?:{x:number;y:number},motionMode:"MoveJ"|"MoveL"="MoveL"):ShapeLesson {
  const taskIndex=Math.max(0,Math.min(SHAPE_LESSON_COUNT-1,Math.floor(Number.isFinite(index)?index:0)));
  const baseline=baseSequence(shape,taskIndex,motionMode);
  const motionSteps=sequenceOverride?.filter((s):s is ShapeLessonStep=>s.type==="MoveJ"||s.type==="MoveL"||s.type==="MoveC");
  const sequence=(motionSteps&&motionSteps.filter(s=>s.coords).length>=baseline.length?motionSteps:baseline).map(cloneStep);
  const c=CIRCLES[taskIndex],circleCenter=circleCenterOverride?{...circleCenterOverride}:{x:c.x,y:c.y};
  const targetSequence=shape==="사각형"?squareSequence(taskIndex,"MoveL"):undefined;
  const questions=shape==="사각형"?squareQuestions(taskIndex,sequence,targetSequence!):shape==="삼각형"?triangleQuestions(taskIndex,sequence):circleQuestions(taskIndex,sequence,circleCenter);
  const planning=completePathPlanning(shape,taskIndex,sequence,targetSequence,circleCenter);
  const appendFocus=(required:LessonQuestion[],focus:LessonQuestion[])=>[...required,...focus.filter(question=>!required.some(item=>item.key===question.key))];
  const brief=problemBrief(shape,taskIndex,sequence,targetSequence,circleCenter);
  if(shape==="삼각형")brief.conditionValue=`P1 → P2: ΔX ${show(sequence[1].coords!.x-sequence[0].coords!.x)}, ΔY ${show(sequence[1].coords!.y-sequence[0].coords!.y)}, ΔZ ${show(sequence[1].coords!.z-sequence[0].coords!.z)} mm\nP2 → P3: ΔX ${show(sequence[2].coords!.x-sequence[1].coords!.x)}, ΔY ${show(sequence[2].coords!.y-sequence[1].coords!.y)}, ΔZ ${show(sequence[2].coords!.z-sequence[1].coords!.z)} mm\n${brief.conditionValue}`;
  const taskKind = (["practice", "transfer", "representative", "practice", "representative", "transfer"] as const)[taskIndex];
  return {id:`${shape==="사각형"?"square":shape==="삼각형"?"triangle":"circle"}-v3-${taskIndex+1}`,difficulty:DIFFICULTIES[taskIndex],taskKind,sequence,targetSequence,circleCenter,brief,...questions,
    pathPlan:planning.pathPlan,relations:appendFocus(planning.relations,questions.relations),calculation:appendFocus(planning.calculation,questions.calculation)};
}
export function shapeLessonFields(lesson:ShapeLesson) {
  return [...lesson.concept,...lesson.relations,...lesson.calculation,...lesson.prediction].map(({key,label,unit,options})=>({key,label,unit,options:options?.map(o=>({...o}))}));
}
export function shapeLessonExpected(lesson:ShapeLesson):Record<string,number|string> {
  return Object.fromEntries([...lesson.concept,...lesson.relations,...lesson.calculation,...lesson.prediction].map(q=>[q.key,q.answer]));
}
export function shapeLessonAnswerMatches(question:LessonQuestion,value:unknown,tolerance=0.1) {
  if(typeof question.answer==="string")return value===question.answer;
  if(typeof value!=="number"&&typeof value!=="string")return false;
  const normalized=String(value).trim();
  if(!normalized)return false;
  const parsed=Number(normalized);
  return Number.isFinite(parsed)&&Math.abs(parsed-question.answer)<=tolerance+1e-9;
}
export function shapeLessonFeedback(question:LessonQuestion,value:string) {
  return question.feedback?.[value]??question.hint;
}
/** Circumcircle used by MoveC: retain edited vias instead of assuming an ideal circle. */
function arcGeometry(a:ShapeLessonPoint,b:ShapeLessonPoint,c:ShapeLessonPoint) {
  const d=2*(a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y));
  if(Math.abs(d)<1e-6)return null;
  const aa=a.x*a.x+a.y*a.y,bb=b.x*b.x+b.y*b.y,cc=c.x*c.x+c.y*c.y;
  const x=(aa*(b.y-c.y)+bb*(c.y-a.y)+cc*(a.y-b.y))/d;
  const y=(aa*(c.x-b.x)+bb*(a.x-c.x)+cc*(b.x-a.x))/d;
  const start=Math.atan2(a.y-y,a.x-x),end=Math.atan2(c.y-y,c.x-x),via=Math.atan2(b.y-y,b.x-x);
  const cw=norm(start-end),cwVia=norm(start-via);
  return {x,y,radius:Math.hypot(a.x-x,a.y-y),start,sweep:cwVia<=cw+1e-6?-cw:2*Math.PI-cw};
}
function sequencesMatch(actual:ShapeLessonStep[],target:ShapeLessonStep[],tolerance=0.1) {
  const samePoint=(a:ShapeLessonPoint|undefined,b:ShapeLessonPoint|undefined)=>!a&&!b||!!a&&!!b&&["x","y","z","r"].every(key=>Math.abs(a[key as keyof ShapeLessonPoint]-b[key as keyof ShapeLessonPoint])<=tolerance);
  return actual.length===target.length&&actual.every((step,index)=>
    (index===0||step.type===target[index].type)&&samePoint(step.coords,target[index].coords)&&samePoint(step.via,target[index].via));
}
/** A nominal target exists separately only where a task asks students to diagnose a program. */
export function shapeLessonMatchesTarget(lesson:ShapeLesson) {
  return !lesson.targetSequence||sequencesMatch(lesson.sequence,lesson.targetSequence);
}
function sampleSequence(sequence:ShapeLessonStep[]):LabeledPoint[] {
  const steps=sequence.filter(s=>s.coords),path:ShapeLessonPoint[]=[];
  if(!steps.length)return path;
  path.push({...steps[0].coords!});
  for(let i=1;i<steps.length;i++) {
    const step=steps[i],a=steps[i-1].coords!,c=step.coords!;
    const arc=step.type==="MoveC"&&step.via?arcGeometry(a,step.via,c):null;
    if(arc)for(let j=1;j<16;j++) {
      const t=j/16,angle=arc.start+arc.sweep*t;
      path.push({x:arc.x+arc.radius*Math.cos(angle),y:arc.y+arc.radius*Math.sin(angle),z:a.z+(c.z-a.z)*t,r:a.r+(c.r-a.r)*t});
    }
    path.push({...c});
  }
  return path;
}
/** Desired mathematical path, kept independent from the intentional square fault. */
export function shapeLessonTargetPath(lesson:ShapeLesson):LabeledPoint[] {
  return sampleSequence(lesson.targetSequence??lesson.sequence);
}
/** Command-coordinate preview; MoveJ interiors still come from the robot's executed trace. */
export function shapeLessonProgramPath(lesson:ShapeLesson):LabeledPoint[] {
  return sampleSequence(lesson.sequence);
}
/** The framework separates choosing relationships from expressing the complete plan. */
export function shapeLessonStages(lesson:ShapeLesson):[LessonQuestion[],LessonQuestion[],LessonQuestion[]] {
  return [lesson.concept,lesson.relations,[...lesson.calculation,...lesson.prediction]];
}
function enteredNumber(draft:Record<string,string>,key:string):number|null {
  const raw=draft[key];
  if(typeof raw!=="string"||raw.trim()==="")return null;
  const value=Number(raw);return Number.isFinite(value)?value:null;
}
/** Completeness never marks an incorrect prediction correct; challenge mode keeps its evidence. */
export function hasCompleteShapePlan(lesson:ShapeLesson,draft:Record<string,string>):boolean {
  const questions=shapeLessonStages(lesson).flat();
  return lesson.pathPlan.requiredKeys.every(key=>{
    const question=questions.find(item=>item.key===key);
    return !!question&&(question.options?question.options.some(option=>option.value===draft[key]):enteredNumber(draft,key)!==null);
  });
}
function enteredPlanPoint(row:ShapePathPlanRow,draft:Record<string,string>):LabeledPoint|null {
  const x=enteredNumber(draft,row.xKey),y=enteredNumber(draft,row.yKey);
  return x===null||y===null?null:{x,y,z:row.z,r:row.r,label:`${row.label} 예측`};
}
/** Partial plans show only coordinate pairs actually entered, never hidden target XY values. */
export function shapeLessonStudentPoints(lesson:ShapeLesson,draft:Record<string,string>):LabeledPoint[] {
  return lesson.pathPlan.rows.flatMap(row=>{
    const point=enteredPlanPoint(row,draft);return point?[point]:[];
  });
}
/** The preview is made from learner coordinates and vias, independently of the robot program. */
export function shapeLessonStudentPath(lesson:ShapeLesson,draft:Record<string,string>):LabeledPoint[] {
  if(!hasCompleteShapePlan(lesson,draft))return [];
  return shapeLessonStudentPreview(lesson,draft);
}
/** Connect only consecutive entered points. Missing values never come from the answer or program. */
export function shapeLessonStudentPreview(lesson:ShapeLesson,draft:Record<string,string>):LabeledPoint[] {
  const source=lesson.targetSequence??lesson.sequence,start=source[0]?.coords;
  if(!start)return [];
  const sequence:ShapeLessonStep[]=[{type:"MoveJ",label:"P1",coords:{...start}}];
  for(const row of lesson.pathPlan.rows.filter(item=>item.kind!=="via")) {
    const coords=enteredPlanPoint(row,draft);
    const viaRow=lesson.pathPlan.rows.find(item=>item.kind==="via"&&item.sequenceIndex===row.sequenceIndex);
    const via=viaRow?enteredPlanPoint(viaRow,draft):undefined;
    if(!coords||(viaRow&&!via))break;
    sequence.push({type:via?"MoveC":"MoveL",label:row.label,coords,via:via??undefined});
  }
  if(sequence.length<2)return [];
  return sampleSequence(sequence).map(({x,y,z,r})=>({x,y,z,r,label:""}));
}

export type ShapePlanningFocus = {
  label:string; axis:"x"|"y"|null; pointLabel?:string;
  directionPoints:(ShapeLessonPoint & {label:string})[];
  activeSegment:(ShapeLessonPoint & {label:string})[];
};
/** A direction sketch is a student's choice applied to the given lengths, not an answer overlay. */
export function shapePlanningFocus(lesson:ShapeLesson,draft:Record<string,string>,key:string|null):ShapePlanningFocus {
  const question=shapeLessonStages(lesson).flat().find(item=>item.key===key);
  const row=lesson.pathPlan.rows.find(item=>item.xKey===key||item.yKey===key);
  const focus:ShapePlanningFocus={label:question?.label??"좌표축과 주어진 P1을 기준으로 생각하세요.",
    axis:row?(row.xKey===key?"x":"y"):null,pointLabel:row?.label,directionPoints:[],activeSegment:[]};
  if(!lesson.id.startsWith("square-"))return focus;
  const points=(lesson.targetSequence??lesson.sequence).filter(step=>step.coords).map(step=>step.coords!);
  const dx=points[1].x-points[0].x,dy=points[2].y-points[1].y;
  const choices:Record<string,[number,number]>={"x-forward":[dx,0],"y-forward":[0,dy],"x-return":[-dx,0],"y-return":[0,-dy]};
  const selected=key?choices[draft[key]]:undefined;
  if(selected)focus.axis=selected[0]!==0?"x":"y";
  if(key==="squareAxis"&&(draft[key]==="x"||draft[key]==="y"))focus.axis=draft[key];
  focus.directionPoints=[{...lesson.pathPlan.start,label:"P1"}];
  for(const [index,edge] of ["12","23","34","41"].entries()) {
    const move=choices[draft[`edge${edge}`]];
    if(!move)break;
    const from=focus.directionPoints.at(-1)!;
    const to={...from,x:from.x+move[0],y:from.y+move[1],label:index===3?"닫힘 예측":`P${index+2} 예측`};
    focus.directionPoints.push(to);
    if(key===`edge${edge}`)focus.activeSegment=[from,to];
  }
  return focus;
}
