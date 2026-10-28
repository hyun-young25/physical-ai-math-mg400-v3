import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {SquareDiagnosisPanel} from "../src/SquareDiagnosisPanel";
import {SquareReplayControls,SquareObservedDiagram} from "../src/SquareComparisonView";
import {RobotScene} from "../src/Robot3D";
import TutorWindow from "../src/TutorWindow";
import {getShapeLesson,shapeLessonExpected} from "../src/shapeLearning";
import {diagnoseSquare,squareFeedbackPlan,squareCondition,squarePlannedVertices} from "../src/squareMismatchDiagnosis";
import {publishSquareVisual,clearSquareVisual,squareVisualSnapshot} from "../src/squareVisualizationStore";
import {squareFeedbackKey,squareEvidenceTag} from "../src/squareComparisonVisual";
import {SHAPE_HOME_JOINTS,shapeFK} from "../src/shapeKinematics";
const lesson=getShapeLesson("사각형",0),correct=Object.fromEntries(Object.entries(shapeLessonExpected(lesson)).map(([k,v])=>[k,String(v)]));
let count=0;
function build(name:string,prior=0){
 const answers={...correct,...(name==="open"?{closeY:"-200"}:name==="arithmetic"?{p3y:String(-50-prior*10),p4y:String(-50-prior*10)}:{})};
 let observed=squarePlannedVertices(lesson,answers)!;
 if(name==="hardware")observed=observed.map(p=>({...p,x:p.x+2,y:p.y+.5}));
 const source=name==="hardware"?"hardware":"dt";
 const diagnosis=diagnoseSquare(lesson,answers,{source,observedVertices:observed,...(name==="unreachable"?{rejected:{x:100,y:100}}:{})})!;
 const plan=squareFeedbackPlan(diagnosis,prior,"challenge",name==="match"?"arithmetic":undefined);
 const context={task:"square",answers:JSON.stringify(answers),execution:"[]",history:"fixture-"+(++count),attempts:count,
  judgment:JSON.stringify({diagnosis:{...diagnosis,name:diagnosis.type==="axis-swap"?"축·길이 뒤바뀜":diagnosis.label,levelLabel:plan?.levelLabel??""}})};
 return {key:context.history,feedbackKey:squareFeedbackKey(context as any,diagnosis.evidence),stage:6,diagnosis,plan,
  observed:name==="unreachable"?[]:observed,target:squareCondition(lesson)!.target.map((p,i)=>({...p,z:0,label:"P"+(i+1)})),
  priorSameType:prior,supportMode:"challenge" as const,tag:squareEvidenceTag(context as any)};
}
function Screen(){
 const [v,setV]=useState(()=>build("open")),[open,setOpen]=useState(false);
 React.useLayoutEffect(()=>{publishSquareVisual("fixture",v);return()=>clearSquareVisual("fixture");},[v]);
 (window as any).__visualSnapshot=squareVisualSnapshot;
 const change=(name:string,prior=0)=>{setV(build(name,prior));setOpen(false);};
 return <><nav style={{display:"flex",gap:8,flexWrap:"wrap",padding:8}}>{["open","arithmetic","unreachable","match","hardware"].map(n=><button key={n} onClick={()=>change(n)}>{n}</button>)}
 <button onClick={()=>change("arithmetic",1)}>repeat2</button><button onClick={()=>change("arithmetic",2)}>repeat3</button><button onClick={()=>change("arithmetic",3)}>repeat4</button>
 <button onClick={()=>clearSquareVisual("fixture")}>revise</button></nav>
 <main className="test-layout"><div className="test-scene"><RobotScene joints={{...SHAPE_HOME_JOINTS}} coords={shapeFK(SHAPE_HOME_JOINTS)} endEffector="pen" shapeStudyViewKey={1}/></div>
 <div className="test-panel"><SquareDiagnosisPanel diagnosis={v.diagnosis} plan={v.plan} priorSameType={v.priorSameType} supportMode="challenge" plannedVertices={v.target}/>
 <SquareObservedDiagram/><SquareReplayControls/><p>화면 버전: 진단 시각화 v2</p></div></main>
 <TutorWindow open={open} onToggle={()=>setOpen(!open)} contextLabel="검증용 사각형" pending={false} status="기본 안내" messages={v.tag?[{id:v.key,role:"tutor",text:v.plan?.question??"",source:"rules",evidence:v.tag}]:[]} onSend={()=>{}} quickActions={[]} storageFailed={false} mode="trial" onModeChange={()=>{}}/>
 </>;
}
createRoot(document.getElementById("root")!).render(<Screen/>);
