const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const load=(name,deps={})=>{const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,name),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(exports,n=>{assert.ok(n in deps,n);return deps[n];});return exports;};
const c=load('curriculum.ts'),learning=load('coordinateLearning.ts',{'./curriculum':c}),a=load('coordinateApplication.ts',{'./curriculum':c,'./coordinateLearning':learning});
const raw=v=>Object.fromEntries(['x','y','z'].map(k=>[k,String(v[k])]));
test('absolute, relative and mixed commands carry the object through the same ordered work targets without changing R',()=>{
 for(const variant of ['absolute','relative','mixed']){
  let from={...a.APPLICATION_START,r:76},held=false;const entries=[];
  for(const [i,s] of a.APPLICATION_STEPS.transfer.entries()){
   if(s.action==='grip'){assert.ok(a.applicationMatches(from,a.APPLICATION_PICK));held=true;continue;}
   if(s.action==='release'){assert.ok(held);assert.ok(a.applicationMatches(from,a.APPLICATION_PLACE));held=false;continue;}
   const mode=variant==='mixed'?(i%2?'relative':'absolute'):variant;
   const argument=mode==='absolute'?s.target:c.poseDifference(from,s.target),to=a.applicationTarget(from,mode,raw(argument));
   assert.ok(a.applicationMatches(to,s.target));assert.equal(to.r,76);assert.equal(a.applicationPathError('transfer',from,to,held),null);
   entries.push({action:'move',mode,status:'reached'});from=to;
  }
  assert.equal(held,false);assert.deepEqual(from,{...a.APPLICATION_PLACE,z:60,r:76});assert.equal(entries.length,6);
  assert.equal(a.applicationRepresentation({entries}),variant==='mixed'?'절대·상대 혼합':variant==='absolute'?'모두 절대':'모두 상대');
 }
});
test('relative correction uses actual partial position; absolute specifies a fixed target; inputs remain unchanged',()=>{
 const from={x:280,y:-30,z:17.3,r:-32},input={x:'20',y:'0',z:'42.7'},copy=structuredClone(input);
 assert.deepEqual(a.applicationTarget(from,'relative',input),{x:300,y:-30,z:60,r:-32});
 assert.deepEqual(a.applicationTarget(from,'absolute',input),{x:20,y:0,z:42.7,r:-32});assert.deepEqual(input,copy);
 for(const value of ['', ' ', 'Infinity', 'NaN','1e999'])assert.equal(a.applicationTarget(from,'relative',{...input,z:value}),null);
 assert.equal(a.applicationMatches({x:NaN,y:0,z:0},{x:0,y:0,z:0}),false);
});
test('virtual work rejects crossing below the work surface and moving a held block horizontally before lifting',()=>{
 const from={...a.APPLICATION_PICK,r:0};
 assert.match(a.applicationPathError('transfer',from,{...from,z:-1},false),/Z=0/);
 assert.match(a.applicationPathError('transfer',from,{...from,y:50,z:60},true),/먼저/);
 assert.equal(a.applicationPathError('transfer',from,{...from,z:60},true),null);
 assert.equal(a.applicationPathError('transfer',{...from,z:60},{...from,y:50,z:60},true),null);
 assert.equal(a.applicationPathError('position',from,{...from,z:-1},false),null);
});

function assignedRun(mode,pairId='pair-1'){
 let from={...a.APPLICATION_START,r:25};const entries=[];
 for(const [i,s] of a.APPLICATION_STEPS.transfer.entries()){
  const argument=mode==='absolute'?{...s.target}:c.poseDifference(from,{...s.target,r:25});
  const to={...s.target,r:25};
  entries.push({id:`${mode}-${i}`,step:i,action:s.action,from:{...from},target:{...s.target},status:'reached',
    ...(s.action==='move'?{mode,argument,to}:{})});from=to;
 }
 return {id:mode,task:'transfer',source:'dt',startedAt:'2026-09-13',from:{...a.APPLICATION_START,r:25},entries,completed:true,pairId,requiredMode:mode};
}
test('two-method comparison requires separate complete absolute and relative runs from one pair',()=>{
 const absolute=assignedRun('absolute'),relative=assignedRun('relative');
 assert.equal(a.transferPair([absolute],'pair-1').complete,false);
 assert.equal(a.transferPair([absolute,assignedRun('relative','other')],'pair-1').complete,false);
 const before=structuredClone([absolute,relative]),pair=a.transferPair([absolute,relative],'pair-1');
 assert.equal(pair.complete,true);assert.equal(pair.rows.length,8);
 assert.deepEqual(pair.rows[3].absolute.argument,{x:300,y:-50,z:60});
 // Contact is Z=20; a 40 mm lift reaches the absolute transport height Z=60.
 assert.equal(pair.rows[3].relative.from.z,20);
 assert.deepEqual(pair.rows[3].relative.argument,{x:0,y:0,z:40});
 assert.deepEqual(pair.rows[7].relative.argument,{x:0,y:0,z:60},'retreat from the Z=0 placement is a separate 60 mm rise');
 assert.deepEqual(pair.rows[3].absolute.to,pair.rows[3].relative.to);
 assert.deepEqual([absolute,relative],before);
});
test('free, mixed, incomplete, wrong-target and interrupted runs cannot satisfy an assigned method',()=>{
 const valid=assignedRun('absolute');
 for(const mutation of [
  r=>delete r.pairId,r=>r.requiredMode='relative',r=>r.completed=false,r=>r.source='hardware',
  r=>r.from.x=200,r=>r.entries.pop(),r=>r.entries[0].mode='relative',r=>r.entries[3].status='stopped',
  r=>r.entries[4].to.y=-50,r=>r.entries[6].from.y=-50,r=>r.entries[2].action='release',
  r=>r.entries[1].step=0,r=>delete r.entries[0].to,
 ]){const r=structuredClone(valid);mutation(r);assert.equal(a.completedTransferRun(r,'absolute'),false);}
});
test('a corrected run retains errors and compares only the successful entries without erasing the first run',()=>{
 const absolute=assignedRun('absolute'),relative=assignedRun('relative');
 const missed={...relative.entries[0],id:'missed',status:'missed',argument:{x:40,y:-100,z:0},to:{x:290,y:-50,z:60,r:25}};
 relative.entries[0]={...relative.entries[0],from:{...missed.to},argument:{x:10,y:0,z:0}};
 relative.entries.unshift(missed);
 const pair=a.transferPair([absolute,relative],'pair-1');assert.equal(pair.complete,true);
 assert.equal(pair.rows[0].relative.id,'relative-0');assert.equal(relative.entries[0].status,'missed');
 const interrupted=structuredClone(relative);interrupted.id='retry';interrupted.completed=false;
 assert.equal(a.transferPair([absolute,relative,interrupted],'pair-1').relative.id,'relative');
});
