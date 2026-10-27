const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(file,deps={}){const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(exports,n=>{assert.ok(n in deps,n);return deps[n]});return exports;}
const fk=load('fkLearning.ts'),learning=load('kinematicsLearning.ts',{'./fkLearning':fk});
// Read the actual application FK/IK, including its rounding; do not substitute a
// higher precision solver that could hide errors in DT result comparisons.
const app=fs.readFileSync(path.join(__dirname,'App.tsx'),'utf8');
const readFunction=name=>ts.transpileModule(app.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0],{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const physicalFK=new Function('ARM_L1','ARM_L2',`${readFunction('fkMG400')}; return fkMG400`)(175,175);
const physicalIK=new Function('ARM_L1','ARM_L2',`${readFunction('ikMG400')}; return ikMG400`)(175,175);
const {offsetX,offsetZ}=learning.LEARNING_MODEL;
const model={
 fk:j=>{const p=physicalFK(j.j1,j.j2,j.j3);return{x:p.x+offsetX,y:p.y,z:p.z+offsetZ,r:j.j4}},
 ik:(x,y,z,r,hint)=>{const j=physicalIK(x-offsetX,y,z-offsetZ,hint);return j?{...j,j4:r}:null},
};
test('FK tasks isolate shoulder, relative elbow, then base/tool orientation with stated reference poses',()=>{
 const tasks=learning.FK_EXERCISES;
 assert.equal(tasks.length,3);
 assert.deepEqual(tasks[0].reference,fk.FK_REFERENCE);
 assert.deepEqual(tasks[1].reference,tasks[0].input);
 assert.deepEqual(tasks[2].reference,tasks[1].input);
 const changed=t=>Object.keys(t.input).filter(k=>t.input[k]!==t.reference[k]);
 assert.deepEqual(tasks.map(changed),[['j2'],['j3'],['j1','j4']]);
 const first=learning.fkObservation(model,tasks[0].input,tasks[0].reference);
 assert.equal(first.height,'increase');assert.equal(first.reach,'decrease');
 const second=learning.fkObservation(model,tasks[1].input,tasks[1].reference);
 assert.equal(second.rho,262.5);assert.ok(Math.abs(second.z-110.4)<0.1);
 const third=learning.fkObservation(model,tasks[2].input,tasks[2].reference);
 assert.equal(third.z,second.z);assert.equal(third.r,45);assert.notEqual(third.y,second.y);
 for(const task of tasks){const values=learning.fkObservation(model,task.input,task.reference);assert.ok(task.fields.every(field=>values[field.key]!==undefined));}
});
test('reachable IK tasks expose angle answers and round-trip through the application model within stated tolerance',()=>{
 const first=learning.ikObservation(model,learning.IK_EXERCISES[0].target);
 const higher=learning.ikObservation(model,learning.IK_EXERCISES[1].target);
 for(const [index,r] of [first,higher].entries()){
  assert.ok(r.joints);assert.equal(r.expected.reachable,'yes');assert.equal(r.expected.restored,'same');
  assert.ok(r.residual<=learning.KINEMATICS_TOLERANCE);
  assert.ok(learning.IK_EXERCISES[index].fields.every(field=>r.expected[field.key]!==undefined));
  assert.ok(r.joints.j3<=0);
 }
 assert.equal(first.joints.j1,higher.joints.j1);
 assert.ok(Math.abs(higher.joints.j3)<Math.abs(first.joints.j3));
 assert.ok(Math.abs(first.joints.j1-19.93)<0.1);
});
test('unreachable task has no fabricated angles, position, or zero residual, and a changed target can recover',()=>{
 const outside=learning.ikObservation(model,learning.IK_EXERCISES[2].target);
 assert.ok(Math.abs(outside.expected.distance-390)<1e-8);
 assert.equal(outside.expected.reachable,'no');assert.equal(outside.expected.restored,'none');
 assert.equal(outside.joints,null);assert.equal(outside.pose,null);assert.equal(outside.residual,null);
 const corrected=learning.ikObservation(model,{x:400,y:0,z:0,r:0});
 assert.ok(corrected.joints);assert.equal(corrected.expected.restored,'same');
 assert.equal(learning.kinematicsCanAdvance(true,'ik',2,false,false),false);
 assert.equal(learning.kinematicsCanAdvance(true,'ik',2,true,false),false);
 assert.equal(learning.kinematicsCanAdvance(false,'ik',2,true,true),false);
 assert.equal(learning.kinematicsCanAdvance(true,'ik',2,true,true),true);
});
test('DT observation begins at the problem reference, ends at exact calculated angles, and never invokes IK',()=>{
 for(const task of learning.FK_EXERCISES){
  const frames=learning.kinematicsFrames({...model,ik:()=>assert.fail('FK interpolation must not select an IK branch')},task.reference,task.input);
  assert.equal(frames.length,121);assert.deepEqual(frames[0].joints,task.reference);
  assert.deepEqual(frames.at(-1).joints,task.input);
  assert.deepEqual(frames.at(-1).pose,model.fk(task.input));
 }
});
