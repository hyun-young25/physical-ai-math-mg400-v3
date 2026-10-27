const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const exported={};
new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'shapeLearning.ts'),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(exported,name=>{throw new Error(`Unexpected runtime dependency: ${name}`);});
const {getShapeLesson,shapeLessonFields,shapeLessonExpected,shapeLessonAnswerMatches,shapeLessonTargetPath,shapeLessonProgramPath,shapeLessonMatchesTarget,shapeLessonStudentPoints,shapeLessonStudentPath,shapeLessonStages,hasCompleteShapePlan,SHAPE_LESSON_COUNT}=exported;
const clone=value=>JSON.parse(JSON.stringify(value));
const near=(actual,expected,eps=1e-8)=>assert.ok(Math.abs(actual-expected)<eps,`${actual} != ${expected}`);

for(const shape of ['사각형','삼각형','동그라미'])test(`${shape}: six bounded, closed tasks progress through basic, applied and diagnostic mathematics`,()=>{
  assert.equal(SHAPE_LESSON_COUNT,6);
  const lessons=Array.from({length:6},(_,i)=>getShapeLesson(shape,i));
  assert.deepEqual(lessons.map(l=>l.difficulty),['기초','기초','응용','응용','심화','심화']);
  assert.equal(new Set(lessons.map(l=>l.id)).size,6);
  assert.equal(new Set(lessons.map(l=>l.title)).size,6);
  // A progression changes the question being investigated, not only point coordinates.
  assert.equal(new Set(lessons.map(l=>l.concept.map(q=>q.key).join(','))).size,6);
  for(const lesson of lessons){
    assert.ok(lesson.relations.length>=3);assert.equal(lesson.prediction.length,1);
    assert.ok(lesson.concept.length>=1&&lesson.concept.length<=2);
    assert.ok(lesson.calculation.length>=lesson.pathPlan.rows.length*2);
    const fields=shapeLessonFields(lesson),expected=shapeLessonExpected(lesson);
    assert.equal(new Set(fields.map(f=>f.key)).size,fields.length);
    assert.deepEqual(Object.keys(expected),fields.map(f=>f.key));
    assert.ok(fields.every(f=>!('answer' in f)&&!('hint' in f)),'form metadata must not disclose answers');
    for(const q of [...lesson.concept,...lesson.relations,...lesson.calculation,...lesson.prediction]){
      assert.ok(q.hint);assert.ok(shapeLessonAnswerMatches(q,String(q.answer)));
      if(q.options)assert.ok(q.options.some(option=>option.value===q.answer));
      else assert.ok(Number.isFinite(q.answer));
    }
    const points=lesson.sequence.flatMap(s=>[s.coords,s.via].filter(Boolean));
    for(const p of points){assert.ok(p.x>=170-1e-8&&p.x<=330+1e-8);assert.ok(Math.abs(p.y)<=100+1e-8);assert.equal(p.z,0);}
    assert.deepEqual(lesson.sequence.at(-1).coords,lesson.sequence[0].coords);
    assert.ok(lesson.sequence.at(-1).label.includes('복귀'),'closing step retains existing UI lock');
    const target=shapeLessonTargetPath(lesson);
    assert.deepEqual(target[0],target.at(-1));
    assert.deepEqual(shapeLessonStudentPoints(lesson,{}),[],'no entered predictions means no leaked answer points');
  }
});

test('square tasks retain six calibrated rectangle conditions and require every corner before drawing',()=>{
  const conditions=[
    [200,100,100,200,1,-1], [320,-80,100,160,-1,1],
    [180,-60,120,150,1,1], [310,80,90,140,-1,-1],
    [190,90,130,180,1,-1], [320,-75,110,150,-1,1],
  ];
  conditions.forEach(([x,y,w,h,xd,yd],index)=>{
    const lesson=getShapeLesson('사각형',index),target=lesson.targetSequence;
    assert.deepEqual(target.map(step=>[step.coords.x,step.coords.y]),[[x,y],[x+xd*w,y],[x+xd*w,y+yd*h],[x,y+yd*h],[x,y]]);
    assert.ok(["p2x","p2y","p3x","p3y","p4x","p4y","closeX","closeY"].every(key=>lesson.calculation.some(question=>question.key===key)));
    assert.ok(!lesson.calculation.some(question=>question.key==='distance'),'do not ask perimeter again as movement distance');
    assert.equal(shapeLessonMatchesTarget(lesson),index!==5);
  });
  const basic=shapeLessonExpected(getShapeLesson('사각형',0));
  assert.equal(basic.squareAxis,'x');assert.equal(basic.p2x,300);assert.equal(basic.p2y,100);
  const negative=shapeLessonExpected(getShapeLesson('사각형',1));
  assert.equal(negative.negativeDirection,'decrease');assert.equal(negative.p3x,220);assert.equal(negative.p3y,80);
  const width=shapeLessonExpected(getShapeLesson('사각형',2));
  assert.equal(width.expandedP2x,320);assert.equal(width.expandedPerimeter,580);assert.equal(width.expandedArea,21000);
  const fourth=shapeLessonExpected(getShapeLesson('사각형',3));
  assert.equal(fourth.p4x,310);assert.equal(fourth.p4y,-60);assert.equal(fourth.area,12600);
  const plan=shapeLessonExpected(getShapeLesson('사각형',4));
  assert.equal(plan.perimeter,620);assert.equal(plan.netX,0);assert.equal(plan.netY,0);
});

test('square diagnosis preserves a closed but distorted program independently of mathematical answers',()=>{
  const fault=getShapeLesson('사각형',5),expected=shapeLessonExpected(fault);
  assert.equal(fault.sequence[2].coords.x,230);assert.equal(fault.targetSequence[2].coords.x,210);
  assert.equal(expected.p3x,210);assert.equal(expected.p3y,75);assert.equal(expected.p3Error,20);
  assert.equal(expected.programMatch,'mismatch');assert.equal(shapeLessonMatchesTarget(fault),false);
  assert.deepEqual(fault.sequence[0].coords,fault.sequence.at(-1).coords,'distorted program must still close');
  assert.notDeepEqual(shapeLessonTargetPath(fault),shapeLessonProgramPath(fault));
  const edited=clone(fault.sequence);edited[2].coords.x=210;
  const repaired=getShapeLesson('사각형',5,edited),answer=shapeLessonExpected(repaired);
  assert.equal(shapeLessonMatchesTarget(repaired),true);assert.equal(answer.programMatch,'match');assert.equal(answer.p3Error,0);
  assert.equal(answer.p3x,210);assert.deepEqual(shapeLessonTargetPath(repaired),shapeLessonTargetPath(fault));
  assert.deepEqual(shapeLessonTargetPath(repaired),shapeLessonProgramPath(repaired));
  assert.equal(fault.sequence[2].coords.x,230,'neither evaluation nor a new condition repairs earlier programs');
});

test('square target checking permits another approach command but detects edge, via and orientation edits',()=>{
  const basic=getShapeLesson('사각형',0),seq=clone(basic.sequence);
  seq[0].type='MoveL';assert.equal(shapeLessonMatchesTarget(getShapeLesson('사각형',0,seq)),true);
  seq[1].type='MoveJ';assert.equal(shapeLessonMatchesTarget(getShapeLesson('사각형',0,seq)),false);
  assert.equal(shapeLessonExpected(getShapeLesson('사각형',0,seq)).trajectory,'joint');
  seq[1].type='MoveL';seq[2].coords.r=10;
  assert.equal(shapeLessonMatchesTarget(getShapeLesson('사각형',0,seq)),false);
  seq[2].coords.r=0;seq[2].via={...seq[1].coords};
  assert.equal(shapeLessonMatchesTarget(getShapeLesson('사각형',0,seq)),false);
  const joint=getShapeLesson('사각형',4,undefined,undefined,'MoveJ');
  assert.equal(shapeLessonExpected(joint).trajectory,'joint');assert.equal(shapeLessonMatchesTarget(joint),false);
  for(const shape of ['삼각형','동그라미'])assert.equal(shapeLessonMatchesTarget(getShapeLesson(shape,0)),true);
});

test('square student overlays preserve entered wrong predictions and never use target answers as inputs',()=>{
  const lesson=getShapeLesson('사각형',5);
  assert.deepEqual(shapeLessonStudentPoints(lesson,{}),[]);
  assert.deepEqual(shapeLessonStudentPoints(lesson,{p3x:'230'}),[]);
  assert.deepEqual(shapeLessonStudentPoints(lesson,{p3x:'230',p3y:'70'}),[{x:230,y:70,z:0,r:0,label:'P3 예측'}]);
  const expanded=getShapeLesson('사각형',2);
  assert.deepEqual(shapeLessonStudentPoints(expanded,{expandedP2x:'310'}),[],'a hypothetical X alone must not invent a full point');
  const plan=getShapeLesson('사각형',4);
  assert.deepEqual(shapeLessonStudentPoints(plan,{netX:'8',netY:'-5'}),[],'displacement answers must not silently supply unentered planned points');
});

test('circle endpoints, vias and sampled paths stay exactly on each intended circle',()=>{
  for(let i=0;i<6;i++){
    const lesson=getShapeLesson('동그라미',i),{circleCenter:c}=lesson,a=lesson.sequence[0].coords;
    const radius=Math.hypot(a.x-c.x,a.y-c.y);
    for(const p of [...lesson.sequence.flatMap(s=>[s.coords,s.via].filter(Boolean)),...shapeLessonTargetPath(lesson)]){
      near(Math.hypot(p.x-c.x,p.y-c.y),radius);
    }
    assert.equal(shapeLessonTargetPath(lesson).length,65);
    assert.equal(lesson.sequence.slice(1).every(s=>s.type==='MoveC'),true);
  }
});

test('edited triangle points update distance, signed return, axis feedback and actual open-path diagnosis',()=>{
  const original=getShapeLesson('삼각형',0),seq=clone(original.sequence);
  seq[1].coords={x:250,y:-20,z:12,r:0};
  const updated=getShapeLesson('삼각형',0,seq),answers=shapeLessonExpected(updated);
  near(answers.distance,Math.hypot(120,12));assert.equal(answers.axisChange,'y');assert.equal(answers.returnY,180);
  assert.ok(updated.instruction.includes('(0, -120, 12)'),'edited displacement including Z must be available without disclosing P2');
  assert.equal(updated.pathPlan.rows.find(row=>row.label==='P2').z,12);
  seq.at(-1).coords.x+=20;
  assert.equal(shapeLessonExpected(getShapeLesson('삼각형',1,seq)).closurePrediction,'open');
  assert.deepEqual(original,getShapeLesson('삼각형',0),'questions and overrides must not mutate earlier lessons');
});

test('triangle translation and path-vs-displacement tasks use edited geometry rather than fixed answers',()=>{
  const seq=getShapeLesson('삼각형',2).sequence;
  seq[1].coords.x=305;seq[1].coords.y=35;
  const translated=shapeLessonExpected(getShapeLesson('삼각형',2,seq));
  assert.equal(translated.translatedP2x,325);assert.equal(translated.translatedP2y,15);
  near(translated.distance,Math.hypot(105,-25));
  seq.at(-1).coords={...seq[0].coords,x:seq[0].coords.x+10};
  const expected=shapeLessonExpected(getShapeLesson('삼각형',3,seq));
  near(expected.displacement,10);
  near(expected.pathLength,seq.slice(1).reduce((sum,s,i)=>sum+Math.hypot(s.coords.x-seq[i].coords.x,s.coords.y-seq[i].coords.y),0));
});

test('choice of MoveJ changes triangle trajectory prediction without changing circle arcs',()=>{
  const triangle=getShapeLesson('삼각형',0,undefined,undefined,'MoveJ');
  assert.equal(shapeLessonExpected(triangle).trajectory,'joint');
  assert.ok(triangle.sequence.every(s=>s.type==='MoveJ'));
  const circle=getShapeLesson('동그라미',0,undefined,undefined,'MoveJ');
  assert.equal(circle.sequence[0].type,'MoveJ');assert.ok(circle.sequence.slice(1).every(s=>s.type==='MoveC'));
});

test('circle relative transforms use the edited center and points',()=>{
  const seq=getShapeLesson('동그라미',1).sequence,center={x:230,y:10};
  seq[0].coords={x:250,y:50,z:0,r:0};seq.at(-1).coords={...seq[0].coords};
  const angle=shapeLessonExpected(getShapeLesson('동그라미',1,seq,center));
  near(angle.quarterX,270);near(angle.quarterY,-10);
  const scaled=shapeLessonExpected(getShapeLesson('동그라미',3,seq,center));
  near(scaled.scaledRadius,Math.hypot(20,40)*1.5);
  near(scaled.scaledP2x,center.x+1.5*(seq[1].coords.x-center.x));
  near(scaled.scaledP2y,center.y+1.5*(seq[1].coords.y-center.y));
});

test('basic circle instructions give geometric conditions without disclosing requested P2 coordinates',()=>{
  for(const i of [0,1]){
    const lesson=getShapeLesson('동그라미',i),b=lesson.sequence[1].coords;
    assert.ok(!lesson.instruction.includes(`P2(${b.x}, ${b.y})`));
    assert.ok(!lesson.instruction.includes('다음 P2('));
  }
  const seq=getShapeLesson('동그라미',0).sequence;
  seq[1].coords.x=320;
  const edited=getShapeLesson('동그라미',0,seq);
  assert.equal(shapeLessonExpected(edited).p2x,320);
  assert.ok(edited.instruction.includes('중심에서 70 mm'));
});

test('changed MoveC via updates diagnosis and preview to the actual three-point arc',()=>{
  const base=getShapeLesson('동그라미',4),seq=clone(base.sequence),a=seq[0].coords,b=seq[1].coords;
  seq[1].via={...seq[1].via,x:seq[1].via.x-12};
  const updated=getShapeLesson('동그라미',4,seq,base.circleCenter);
  assert.equal(shapeLessonExpected(updated).viaPrediction,'off');
  assert.notDeepEqual(shapeLessonTargetPath(updated),shapeLessonTargetPath(base));
  // Collinear MoveC follows the executor's straight fallback, not a fictitious nominal circle.
  seq[1].via={...a,x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  const straight=getShapeLesson('동그라미',0,seq,base.circleCenter);
  assert.equal(shapeLessonExpected(straight).arcPrediction,'line');
  assert.deepEqual(shapeLessonTargetPath(straight)[1],b);
  const compared=shapeLessonExpected(getShapeLesson('동그라미',5,seq,base.circleCenter));
  near(compared.arcLength,compared.chordLength);near(compared.arcExtra,0);assert.equal(compared.pathChoice,'same');
});

test('circle arc/chord comparison calculates exact quarter-circle length and keeps original overrides independent',()=>{
  const base=getShapeLesson('동그라미',5),expected=shapeLessonExpected(base);
  near(expected.arcLength,40*Math.PI);near(expected.chordLength,80*Math.sqrt(2));
  near(expected.arcExtra,40*Math.PI-80*Math.sqrt(2));
  const seq=clone(base.sequence),center={...base.circleCenter};
  const withOverride=getShapeLesson('동그라미',5,seq,center);
  seq[0].coords.x=0;center.x=0;
  assert.notEqual(withOverride.sequence[0].coords.x,0);assert.notEqual(withOverride.circleCenter.x,0);
});

test('student points use only complete entered XY pairs, including deliberately wrong closure and vias',()=>{
  const triangle=getShapeLesson('삼각형',1);
  assert.deepEqual(shapeLessonStudentPoints(triangle,{closeX:'123'}),[]);
  const wrong=shapeLessonStudentPoints(triangle,{closeX:'123',closeY:'-9'});
  assert.equal(wrong[0].x,123);assert.equal(wrong[0].y,-9);assert.ok(wrong[0].label);
  const circle=getShapeLesson('동그라미',1);
  assert.deepEqual(shapeLessonStudentPoints(circle,{p2x:'Infinity',p2y:'30'}),[]);
  const points=shapeLessonStudentPoints(circle,{p2x:'280',p2y:'30',via12x:'275',via12y:'25',p3x:'999'});
  assert.deepEqual(points.map(point=>[point.label,point.x,point.y]),[['V12 예측',275,25],['P2 예측',280,30]]);
});

test('numeric checking rejects blanks and nonfinite input and permits 0.1 mm rounding',()=>{
  const question={answer:12};
  for(const invalid of ['', ' ',undefined,null,NaN,Infinity,'Infinity','not a number',{},true])assert.equal(shapeLessonAnswerMatches(question,invalid),false);
  assert.equal(shapeLessonAnswerMatches(question,'12.1'),true);
  assert.equal(shapeLessonAnswerMatches(question,'11.9'),true);
  assert.equal(shapeLessonAnswerMatches(question,'12.11'),false);
  assert.equal(shapeLessonAnswerMatches({answer:'xy'},'xy'),true);
  assert.equal(shapeLessonAnswerMatches({answer:'xy'},'x'),false);
});

test('lesson index stays within the finite course and unrelated sequence actions are excluded',()=>{
  assert.equal(getShapeLesson('삼각형',-5).id,'triangle-v3-1');
  assert.equal(getShapeLesson('동그라미',999).id,'circle-v3-6');
  assert.equal(getShapeLesson('동그라미',NaN).id,'circle-v3-1');
  const sequence=getShapeLesson('삼각형',0).sequence;
  assert.deepEqual(getShapeLesson('삼각형',0,[...sequence,{type:'GRIP',label:'grip'}]).sequence,sequence);
  assert.equal(getShapeLesson('삼각형',0,[]).sequence.length,4);
});

test('all preset paths and line interiors are reachable in the actual calibrated lesson FK/IK model',()=>{
  const load=(file,deps={})=>{
    const result={};
    new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
    }).outputText)(result,name=>{assert.ok(name in deps,name);return deps[name];});
    return result;
  };
  const fk=load('fkLearning.ts'),learning=load('kinematicsLearning.ts',{'./fkLearning':fk});
  const app=fs.readFileSync(path.join(__dirname,'App.tsx'),'utf8');
  const readFunction=name=>ts.transpileModule(app.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0],{
    compilerOptions:{target:ts.ScriptTarget.ES2022},
  }).outputText;
  const {l1,l2,offsetX,offsetZ}=learning.LEARNING_MODEL;
  const physicalFK=new Function('ARM_L1','ARM_L2',`${readFunction('fkMG400')}; return fkMG400`)(l1,l2);
  const physicalIK=new Function('ARM_L1','ARM_L2',`${readFunction('ikMG400')}; return ikMG400`)(l1,l2);
  for(const shape of ['사각형','삼각형','동그라미'])for(let index=0;index<SHAPE_LESSON_COUNT;index++){
    const lesson=getShapeLesson(shape,index),samples=[...shapeLessonTargetPath(lesson),...shapeLessonProgramPath(lesson)];
    if(shape!=='동그라미')for(const sequence of [lesson.sequence,lesson.targetSequence].filter(Boolean))for(let i=1;i<sequence.length;i++){
      const a=sequence[i-1].coords,b=sequence[i].coords;
      for(let j=1;j<20;j++){
        const t=j/20;samples.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,r:0});
      }
    }
    let hint=-1;
    for(const [sampleIndex,target] of samples.entries()){
      const joints=physicalIK(target.x-offsetX,target.y,target.z-offsetZ,hint);
      assert.ok(joints,`${lesson.id} sample ${sampleIndex} must have a lesson-model IK solution`);
      const pose=physicalFK(joints.j1,joints.j2,joints.j3);
      const error=Math.hypot(pose.x+offsetX-target.x,pose.y-target.y,pose.z+offsetZ-target.z);
      assert.ok(error<=learning.KINEMATICS_TOLERANCE,`${lesson.id} sample ${sampleIndex} FK residual ${error} exceeds tolerance`);
      hint=joints.j3;
    }
  }
});


const completeDraft=lesson=>Object.fromEntries(Object.entries(shapeLessonExpected(lesson)).map(([key,value])=>[key,String(value)]));
for(const shape of ['사각형','삼각형','동그라미'])test(`${shape}: every course condition requires its whole path, closure and relevant relations`,()=>{
  for(let index=0;index<SHAPE_LESSON_COUNT;index++){
    const lesson=getShapeLesson(shape,index),draft=completeDraft(lesson),rows=lesson.pathPlan.rows;
    assert.ok(lesson.id.includes('-v3-'),'old one-vertex evidence must not unlock the new course');
    assert.equal(hasCompleteShapePlan(lesson,draft),true);
    assert.equal(rows.filter(row=>row.kind==='closure').length,1);
    assert.equal(rows.filter(row=>row.kind==='vertex').length,shape==='삼각형'?2:3);
    assert.equal(rows.filter(row=>row.kind==='via').length,shape==='동그라미'?4:0);
    const stages=shapeLessonStages(lesson);
    assert.deepEqual(stages,[lesson.concept,lesson.relations,[...lesson.calculation,...lesson.prediction]]);
    for(const key of lesson.pathPlan.requiredKeys){
      const missing={...draft};delete missing[key];
      assert.equal(hasCompleteShapePlan(lesson,missing),false,`${lesson.id}: missing ${key}`);
      assert.deepEqual(shapeLessonStudentPath(lesson,missing),[],`${lesson.id}: partial plan must not reveal a full path`);
      for(const value of ['', ' ', 'Infinity', 'NaN'])assert.equal(hasCompleteShapePlan(lesson,{...draft,[key]:value}),false);
    }
    const partial={p2x:draft.p2x,p2y:draft.p2y};
    assert.equal(shapeLessonStudentPoints(lesson,partial).length,1);
    assert.deepEqual(shapeLessonStudentPath(lesson,partial),[],'P2 alone cannot produce a finished drawing');
    const path=shapeLessonStudentPath(lesson,draft);
    assert.equal(path.length,shape==='동그라미'?65:shape==='삼각형'?4:5);
    const target=shapeLessonTargetPath(lesson);
    assert.equal(path.length,target.length);
    path.forEach((point,index)=>{
      for(const axis of ['x','y','z','r'])near(point[axis],target[index][axis]);
    });
    assert.equal(shapeLessonStudentPoints(lesson,draft).length,rows.length);
  }
});

test('wrong complete plans remain visible as predictions and never rewrite the execution program',()=>{
  const lesson=getShapeLesson('사각형',0),before=clone(lesson.sequence),draft=completeDraft(lesson);
  draft.p3x='321';draft.p3y='-95';draft.closeX='205';
  assert.equal(hasCompleteShapePlan(lesson,draft),true,'completeness is distinct from correctness in challenge mode');
  const path=shapeLessonStudentPath(lesson,draft);
  assert.equal(path[2].x,321);assert.equal(path[2].y,-95);
  assert.equal(path.at(-1).x,205);assert.notDeepEqual(path[0],path.at(-1),'never secretly close an incorrect plan');
  assert.deepEqual(clone(lesson.sequence),before);
  assert.ok(!shapeLessonAnswerMatches(lesson.calculation.find(question=>question.key==='p3x'),draft.p3x));
  const fault=getShapeLesson('사각형',5),correctPlan=shapeLessonStudentPath(fault,completeDraft(fault));
  assert.equal(correctPlan[2].x,210);assert.equal(fault.sequence[2].coords.x,230,'intentional fault must still require program repair');
});

test('circle preview follows all four entered vias rather than substituting target arc midpoints',()=>{
  const lesson=getShapeLesson('동그라미',0),draft=completeDraft(lesson),original=shapeLessonStudentPath(lesson,draft);
  draft.via23x=String(Number(draft.via23x)+8);
  const revised=shapeLessonStudentPath(lesson,draft);
  assert.deepEqual(revised.slice(0,17),original.slice(0,17));
  assert.notDeepEqual(revised.slice(17,32),original.slice(17,32));
  assert.deepEqual(revised[32],original[32],'edited via changes the second arc but preserves its entered endpoint');
  assert.deepEqual(lesson.sequence,getShapeLesson('동그라미',0).sequence);
});

test('triangle givens require deriving unknown vertices instead of disclosing their absolute coordinates',()=>{
  for(let index=0;index<SHAPE_LESSON_COUNT;index++){
    const lesson=getShapeLesson('삼각형',index),[a,b,c]=lesson.sequence.map(step=>step.coords);
    const givens=[lesson.instruction,lesson.brief.contextValue,lesson.brief.conditionValue,lesson.pathPlan.instruction].join(' ');
    for(const [label,value] of [['P2',b],['P3',c]]){
      assert.ok(!givens.includes(`${label}(${value.x}, ${value.y}, ${value.z})`));
      assert.ok(!givens.includes(`${label} (${value.x}, ${value.y}, ${value.z})`));
    }
    assert.ok(givens.includes('ΔX')&&givens.includes('ΔY')&&givens.includes('ΔZ'));
    const expected=shapeLessonExpected(lesson);
    assert.equal(expected.p2x,a.x+(b.x-a.x));assert.equal(expected.p3y,b.y+(c.y-b.y));
  }
});

test('given plan origin stays fixed to the square target when the program start is edited',()=>{
  const lesson=getShapeLesson('사각형',0),seq=clone(lesson.sequence);
  seq[0].coords.x=215;seq.at(-1).coords.x=215;
  const edited=getShapeLesson('사각형',0,seq),draft=completeDraft(edited);
  assert.equal(edited.pathPlan.start.x,200);
  assert.equal(shapeLessonStudentPath(edited,draft)[0].x,200);
  assert.equal(edited.sequence[0].coords.x,215);
});

test('direction previews retain wrong student choices, stop at an unanswered edge and highlight the selected segment',()=>{
  const lesson=getShapeLesson('사각형',0),start=lesson.pathPlan.start;
  const draft={edge12:'x-return',edge23:'y-forward',edge41:'y-return'};
  const focus=exported.shapePlanningFocus(lesson,draft,'edge23');
  assert.equal(focus.axis,'y');assert.equal(focus.directionPoints.length,3);
  assert.deepEqual(focus.directionPoints.map(p=>[p.x,p.y]),[[start.x,start.y],[start.x-100,start.y],[start.x-100,start.y-200]]);
  assert.deepEqual(focus.activeSegment,focus.directionPoints.slice(1));
  assert.equal(exported.shapePlanningFocus(lesson,{},'edge12').directionPoints.length,1);
  assert.equal(exported.shapePlanningFocus(lesson,{p2x:'12'},'p2x').pointLabel,'P2');
});

test('coordinate previews connect only completed consecutive inputs and never fill missing endpoints or circle vias',()=>{
  const square=getShapeLesson('사각형',0);
  const draft={p2x:'275',p2y:'90',p4x:'200',p4y:'0'};
  let path=exported.shapeLessonStudentPreview(square,draft);
  assert.equal(path.length,2);assert.deepEqual([path.at(-1).x,path.at(-1).y],[275,90]);
  assert.equal(hasCompleteShapePlan(square,draft),false);assert.deepEqual(shapeLessonStudentPath(square,draft),[]);
  assert.deepEqual(exported.shapeLessonStudentPreview(square,{p2x:'275'}),[]);
  assert.deepEqual(exported.shapeLessonStudentPreview(square,{p2x:'Infinity',p2y:'90'}),[]);
  const circle=getShapeLesson('동그라미',0),expected=shapeLessonExpected(circle);
  const end=circle.pathPlan.rows.find(r=>r.kind!=='via');
  const via=circle.pathPlan.rows.find(r=>r.kind==='via'&&r.sequenceIndex===end.sequenceIndex);
  const partial=Object.fromEntries([end.xKey,end.yKey].map(key=>[key,String(expected[key])]));
  assert.deepEqual(exported.shapeLessonStudentPreview(circle,partial),[]);
  for(const key of [via.xKey,via.yKey])partial[key]=String(expected[key]);
  path=exported.shapeLessonStudentPreview(circle,partial);
  assert.equal(path.length,17);near(path.at(-1).x,Number(partial[end.xKey]));near(path.at(-1).y,Number(partial[end.yKey]));
});

test('square feedback distinguishes the wrong axis, reversed sign and final closure condition in all variants',()=>{
  for(let index=0;index<6;index++){
    const lesson=getShapeLesson('사각형',index);
    const first=lesson.relations.find(q=>q.key==='edge12'),last=lesson.relations.find(q=>q.key==='edge41');
    const wrongAxis=exported.shapeLessonFeedback(first,'y-forward'),wrongSign=exported.shapeLessonFeedback(first,'x-return');
    assert.match(wrongAxis,/유지해야 할 Y축/);assert.match(wrongSign,/축 X는 맞지만 방향이 반대/);assert.notEqual(wrongAxis,wrongSign);
    assert.match(exported.shapeLessonFeedback(last,'y-forward'),/P1로 닫으려면.*되돌려/);
    assert.equal(exported.shapeLessonFeedback(first,''),first.hint);
  }
});
