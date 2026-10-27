const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
function evaluate(source, deps = {}) {
  const exports = {};
  new Function('exports','require',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(exports,name=>{
    assert.ok(name in deps,name); return deps[name];
  }); return exports;
}
const curriculum = evaluate(read('curriculum.ts'));
const cell = evaluate(read('processCell.ts'),{'./curriculum':curriculum});
const model = evaluate(read('processKinematics.ts')).PROCESS_MODEL;
const answers = scenario => Object.fromEntries(scenario.questions.flatMap(q=>q.fields.map(f=>[f.key,f.expected])));
const run = (level, variant=0, edits={}) => {
  const scenario = cell.processScenario(level,variant);
  return {scenario,...cell.compileProcess(model,scenario,{...answers(scenario),...edits})};
};
const near = (a,b,tolerance=.2) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<=tolerance;

test('four industrial scenarios execute valid FK/IK paths for all condition variants',()=>{
  assert.deepEqual(cell.PROCESS_LEVELS.map(l=>l.level),[1,2,3,4]);
  for(const level of [1,2,3,4]) for(const variant of [0,1,2]) {
    const result=run(level,variant);
    assert.equal(result.outcome.passed,true,`${level}/${variant}: ${result.outcome.issues}`);
    assert.equal(result.outcome.completedPieces,level===4?4:1);
    assert.ok(result.outcome.observations.length>0);
    for(const frame of result.frames) for(const robot of Object.values(frame.robots))
      assert.deepEqual(robot.pose,model.fk(robot.joints),'evidence must record actual FK, not commanded interpolation');
    const initial=result.frames[0];
    assert.deepEqual(result.outcome.finalFrame.robots,initial.robots,'both robots restore their exact starting joints/coordinates');
    assert.ok(result.frames.every((f,i)=>i===0||f.atMs>=result.frames[i-1].atMs));
  }
});

test('the same physical handoff point transforms reversibly into the opposing B frame',()=>{
  const scenario=cell.processScenario(3),b=scenario.robots[1];
  assert.deepEqual(cell.worldToLocal(scenario.handoff,b),{x:350,y:-40,z:220,r:-180});
  assert.deepEqual(cell.localToWorld(cell.worldToLocal(scenario.handoff,b),b),scenario.handoff);
  const arbitrary={...b,yaw:37,origin:{x:80,y:-200,z:40,r:0}};
  assert.ok(near(cell.worldToLocal(cell.localToWorld({x:55,y:34,z:80,r:20},arbitrary),arbitrary),{x:55,y:34,z:80},1e-7));
});

test('a conveyor visibly moves material and stops before any robot picks it',()=>{
  const result=run(2,2),stop=result.frames.findIndex(f=>f.event==='belt-stopped'),grip=result.frames.findIndex(f=>f.event==='A-grip');
  assert.ok(stop>0&&grip>stop);
  const moving=result.frames.slice(0,stop+1);
  assert.equal(moving[0].workpieces[0].top.y,-170);
  assert.equal(moving.at(-1).workpieces[0].top.y,-30);
  assert.ok(moving.some(f=>f.workpieces[0].top.y>-170&&f.workpieces[0].top.y<-30));
  for(const frame of moving) { assert.ok(frame.robots.A.pose.z>=299.9); assert.equal(frame.workpieces[0].owner,null); }
  assert.ok(result.frames.slice(grip).every(f=>f.beltProgress===1));
});

test('entering belt displacement as position really misses and never attaches the block',()=>{
  const result=run(2,0,{beltY:60});
  assert.equal(result.outcome.passed,false);
  assert.equal(result.outcome.completedPieces,0);
  assert.ok(result.outcome.observations.some(o=>o.robot==='A'&&o.target.y===60&&Math.abs(o.observed.y-60)<.2));
  assert.ok(result.frames.some(f=>f.event==='grip-miss'));
  assert.ok(result.frames.every(f=>f.workpieces.every(w=>w.owner===null)));
  assert.ok(near(result.outcome.finalFrame.workpieces[0].top,result.scenario.source));
  assert.deepEqual(result.outcome.finalFrame.robots,result.frames[0].robots);
});

test('wrong destination executes entered position but cannot pass on prediction alone',()=>{
  const result=run(1,0,{targetY:-90,approachY:-90});
  assert.equal(result.outcome.passed,false);
  assert.equal(result.outcome.completedPieces,0);
  assert.ok(Math.abs(result.outcome.finalFrame.workpieces[0].top.y+90)<.2);
  assert.ok(result.frames.some(f=>f.event==='place-miss'));
  assert.deepEqual(result.outcome.finalFrame.robots,result.frames[0].robots);
});

test('handoff releases onto the table, clears A, then transfers unique ownership to B',()=>{
  const result=run(3),release=result.frames.findIndex(f=>f.event==='handoff-release'),clear=result.frames.findIndex(f=>f.event==='A-cleared'),grip=result.frames.findIndex(f=>f.event==='B-grip');
  assert.ok(release>0&&clear>release&&grip>clear);
  assert.equal(result.frames[release].workpieces[0].owner,null);
  assert.ok(near(result.frames[release].workpieces[0].top,result.scenario.handoff));
  assert.equal(result.frames[grip].workpieces[0].owner,'B');
  const initialB=result.frames[0].robots.B;
  for(const frame of result.frames.slice(0,clear+1)) assert.deepEqual(frame.robots.B,initialB);
  assert.equal(result.frames[0].workpieces[0].placed,false,'later placement cannot mutate earlier snapshots');
  for(const frame of result.frames) for(const piece of frame.workpieces) if(piece.owner)
    assert.ok(near(piece.top,cell.localToWorld(frame.robots[piece.owner].pose,result.scenario.robots.find(r=>r.id===piece.owner)),1e-7));
});

test('B cannot pick using A origin or A axis sign and leaves the actual handoff block in place',()=>{
  for(const edits of [{handoffX:300},{handoffY:40}]) {
    const result=run(3,0,edits);
    assert.equal(result.outcome.passed,false);
    assert.ok(result.frames.some(f=>f.event==='handoff-release'));
    assert.ok(!result.frames.some(f=>f.event==='B-grip'));
    assert.ok(near(result.outcome.finalFrame.workpieces[0].top,result.scenario.handoff));
    assert.deepEqual(result.outcome.finalFrame.robots,result.frames[0].robots);
  }
});

test('full cell feeds four independently tracked blocks into distinct row-major tray cells',()=>{
  const result=run(4,1),final=result.outcome.finalFrame;
  assert.equal(result.frames[0].workpieces.length,1);
  assert.equal(result.frames.filter(f=>f.event==='feed').length,3);
  assert.equal(result.frames.filter(f=>f.event==='handoff-release').length,4);
  assert.equal(result.frames.filter(f=>f.event==='B-grip').length,4);
  assert.equal(final.workpieces.length,4);
  for(let i=0;i<4;i++) {
    assert.equal(final.workpieces[i].placed,true);
    assert.equal(final.workpieces[i].owner,null);
    assert.ok(near(final.workpieces[i].top,result.scenario.tray.points[i]));
  }
  assert.equal(result.frames[0].workpieces.length,1,'supplying later blocks must not mutate initial frame');
});

test('all tray variants clear the conveyor sensor and teach the displayed B-frame positions',()=>{
  for(const variant of [0,1,2]) {
    const scenario=cell.processScenario(4,variant),{belt,tray}=scenario;
    // Scene footprint: tray table extends 35 mm beyond the outer slot centers;
    // the sensor extends 17 + 6 mm beyond the conveyor's half-width.
    const tableLeft=Math.min(...tray.points.map(p=>p.x))-35;
    const sensorRight=belt.from.x+belt.width/2+17+6;
    assert.ok(tableLeft-sensorRight>=10,`variant ${variant}: tray overlaps the conveyor sensor`);
    const robotB=scenario.robots.find(robot=>robot.id==='B');
    const localPoints=tray.points.map(point=>cell.worldToLocal(point,robotB));
    const question=scenario.questions.find(q=>q.id==='tray');
    for(let i=0;i<3;i++) {
      const point=localPoints[i];
      assert.ok(question.givens[i].includes(`(${point.x}, ${point.y}, ${point.z})`),
        'student givens and physical tray slots must describe the same coordinates');
    }
    for(const point of localPoints) for(const z of [point.z,300]) {
      const target={...point,z},joints=model.ik(target.x,target.y,target.z,target.r);
      assert.ok(joints,`variant ${variant}: B cannot approach or place in a tray slot`);
      assert.ok(near(model.fk(joints),target));
    }
  }
});

test('wrong tray pitch preserves the successful prefix and never invents placed blocks',()=>{
  for(const edits of [{columnStep:-40},{rowStep:-40},{columnStep:0}]) {
    const result=run(4,0,edits);
    assert.equal(result.outcome.passed,false);
    assert.ok(result.outcome.completedPieces>=1&&result.outcome.completedPieces<4);
    assert.ok(result.outcome.issues.length>0);
    assert.equal(result.outcome.completedPieces,result.outcome.finalFrame.workpieces.filter(p=>p.placed).length);
    assert.deepEqual(result.outcome.finalFrame.robots,result.frames[0].robots);
  }
});

test('unreachable and missing inputs stop without fabricating an IK solution or a completion',()=>{
  for(const edits of [{handoffX:5000},{handoffX:NaN}]) {
    const result=run(3,0,edits);
    assert.equal(result.outcome.passed,false);
    assert.equal(result.outcome.completedPieces,0);
    assert.ok(result.outcome.issues.length>0);
    for(const frame of result.frames) for(const robot of Object.values(frame.robots))
      assert.ok(Object.values(robot.pose).every(Number.isFinite));
    assert.deepEqual(result.outcome.finalFrame.robots,result.frames[0].robots);
  }
});

test('initialization rejects a mismatched FK/IK model instead of emitting false poses',()=>{
  assert.throws(()=>cell.initialProcessFrame({...model,fk(j){return {...model.fk(j),x:9000}}},cell.processScenario(1)),/순기구학/);
  assert.throws(()=>cell.initialProcessFrame({...model,ik(){return null}},cell.processScenario(1)),/역기구학/);
});

test('belt timing matches speed times duration and each feed starts only after prior pickup',()=>{
  for(const variant of [0,1,2]) for(const level of [2,4]) {
    const result=run(level,variant),belt=result.scenario.belt;
    assert.equal(belt.speedMmPerSec*belt.travelSeconds,belt.travel);
    assert.equal(belt.to.y,belt.from.y+belt.speedMmPerSec*belt.travelSeconds);
    const feeds=[result.frames[0],...result.frames.filter(f=>f.event==='feed')];
    const stops=result.frames.filter(f=>f.event==='belt-stopped');
    assert.equal(stops.length,level===4?4:1);
    for(let i=0;i<stops.length;i++) {
      assert.ok(Math.abs(stops[i].atMs-feeds[i].atMs-belt.travelSeconds*1000)<1e-6);
      assert.ok(near(stops[i].workpieces[i].top,belt.to));
      const grip=result.frames.find(f=>f.event==='A-grip'&&f.workpieces[i]?.owner==='A');
      assert.ok(grip.atMs>stops[i].atMs);
      if(i>0) assert.notEqual(feeds[i].workpieces[i-1].owner,null);
    }
    assert.match(result.scenario.id,level===4?/^cell-v5-4-/:/^cell-v4-/);
    const question=result.scenario.questions.find(q=>q.id==='conveyor');
    assert.ok(question.givens.some(g=>g.includes('mm/s')));
    assert.ok(question.givens.some(g=>g.includes('운전 시간')));
  }
});

test('premature handoff choices stop visibly before B approaches the shared station',()=>{
  for(const level of [3,4]) for(const variant of [0,1,2]) for(const handoffReady of [0,1]) {
    const result=run(level,variant,{handoffReady});
    assert.equal(result.outcome.passed,false);
    assert.equal(result.outcome.completedPieces,0);
    const blocked=result.frames.find(f=>f.event==='handoff-blocked');
    assert.ok(blocked,'the chosen condition causes an observable refusal');
    assert.equal(blocked.workpieces[0].owner,handoffReady===0?'A':null);
    assert.ok(!result.frames.some(f=>f.event==='B-enter-handoff'||f.event==='B-grip'));
    assert.ok(result.outcome.issues.some(issue=>issue.includes('인계 구역')));
    for(const frame of result.frames) assert.deepEqual(frame.robots.B,result.frames[0].robots.B);
    assert.deepEqual(result.outcome.finalFrame.robots,result.frames[0].robots);
  }
});

test('pipeline overlaps next pickup and prior packing while keeping one owner per robot',()=>{
  for(const variant of [0,1,2]) {
    const result=run(4,variant);
    assert.ok(result.frames.some(f=>f.workpieces.some(p=>p.owner==='A')&&f.workpieces.some(p=>p.owner==='B')),
      `variant ${variant}: both robots carry different blocks concurrently`);
    assert.ok(result.frames.some((f,i)=>i>0&&f.workpieces.some(p=>p.owner==='B')&&
      !near(f.robots.A.pose,result.frames[i-1].robots.A.pose,1e-5)),
      'A actually prepares the next block while B handles the preceding block');
    assert.ok(result.frames.some(f=>f.beltProgress>0&&f.beltProgress<1&&f.workpieces.some(p=>p.owner==='B')),
      'a running conveyor overlaps B packing');
    for(const frame of result.frames) {
      assert.equal(new Set(frame.workpieces.map(p=>p.id)).size,frame.workpieces.length);
      for(const robot of result.scenario.robots) {
        assert.ok(frame.workpieces.filter(p=>p.owner===robot.id).length<=1);
        for(const piece of frame.workpieces.filter(p=>p.owner===robot.id))
          assert.ok(near(piece.top,cell.localToWorld(frame.robots[robot.id].pose,robot),1e-7));
      }
    }
    assert.equal(result.frames[0].processStatus.completed,0);
    assert.equal(result.outcome.finalFrame.processStatus.completed,4);
    assert.notStrictEqual(result.frames[0].processStatus,result.frames[1].processStatus);
    for(let i=1;i<result.frames.length;i++) for(const piece of result.frames[i].workpieces) {
      const previous=result.frames[i-1].workpieces.find(p=>p.id===piece.id);
      if(previous&&previous.owner!==piece.owner) assert.ok(near(piece.top,previous.top),`owner transition teleported ${piece.id}`);
    }
  }
});

test('shared station reservations cover actual approach, release, pickup and clearance',()=>{
  for(const level of [3,4]) for(const variant of [0,1,2]) {
    const result=run(level,variant),handoff=result.scenario.handoff;
    for(const frame of result.frames) {
      const inside=result.scenario.robots.filter(robot=>{
        const tcp=cell.localToWorld(frame.robots[robot.id].pose,robot);
        return Math.abs(tcp.x-handoff.x)<=55&&Math.abs(tcp.y-handoff.y)<=55;
      });
      assert.ok(inside.length<=1,`both robots occupy station at ${frame.atMs}`);
      for(const robot of inside) assert.equal(frame.processStatus.handoff,robot.id,`unreserved ${robot.id} approach at ${frame.atMs}`);
      if(frame.processStatus.handoff==='ready') {
        assert.equal(inside.length,0);
        assert.ok(frame.workpieces.some(p=>!p.owner&&!p.placed&&near(p.top,handoff)));
      }
    }
    const firstClear=result.frames.findIndex(f=>f.event==='A-cleared');
    const firstBEntry=result.frames.findIndex(f=>f.event==='B-enter-handoff');
    const firstAReturn=result.frames.findIndex(f=>f.event==='A-returned');
    assert.ok(firstBEntry>firstClear&&firstBEntry<firstAReturn,'B starts after clearance without waiting for A home');
  }
});

test('concurrent snapshots and event arrays are deterministic, independent replay records',()=>{
  const first=run(4,2),second=run(4,2);
  assert.deepEqual(first.frames,second.frames);
  for(const frame of first.frames) {
    if(frame.event) assert.deepEqual(frame.events,[frame.event]);
    assert.equal(frame.processStatus.completed,frame.workpieces.filter(p=>p.placed).length);
  }
  const eventFrames=first.frames.filter(f=>f.events);
  assert.notStrictEqual(eventFrames[0].events,eventFrames[1].events);
  first.frames[0].processStatus.A='changed';
  assert.notEqual(first.frames[1].processStatus.A,'changed');
  eventFrames[0].events.push('changed');
  assert.ok(!eventFrames[1].events.includes('changed'));
});

test('wrong coordinates preserve the completed prefix and block actual handoff crossings',()=>{
  for(const [variant,edits,completed,event] of [[0,{beltY:40},0,'handoff-path-blocked'],[2,{rowStep:-150},2,'place-miss']]) {
    const result=run(4,variant,edits),handoff=result.scenario.handoff;
    assert.equal(result.outcome.passed,false);
    assert.equal(result.outcome.completedPieces,completed,'already packed prefix survives a later failed command');
    assert.ok(result.frames.some(f=>f.event===event));
    assert.deepEqual(result.outcome.finalFrame.robots,result.frames[0].robots);
    for(const frame of result.frames) for(const robot of result.scenario.robots) {
      assert.ok(frame.workpieces.filter(p=>p.owner===robot.id).length<=1);
      const tcp=cell.localToWorld(frame.robots[robot.id].pose,robot);
      if(Math.abs(tcp.x-handoff.x)<=55&&Math.abs(tcp.y-handoff.y)<=55)
        assert.equal(frame.processStatus.handoff,robot.id);
    }
  }
});

test('basic transport executes the entered height and compares it with the stated vertical displacement',()=>{
  for(const level of [1,2]) {
    const result=run(level,0,{travelZ:280});
    assert.equal(result.outcome.passed,false,'a physically completed transport is not a correct height calculation');
    assert.equal(result.outcome.completedPieces,1);
    const carried=result.frames.filter(frame=>frame.workpieces.some(piece=>piece.owner==='A'));
    assert.ok(carried.some(frame=>Math.abs(frame.robots.A.pose.z-280)<.2));
    assert.ok(carried.every(frame=>frame.robots.A.pose.z<=280.2));
    assert.equal(result.outcome.checks.find(check=>check.key==='travelZ').actual,280);
    assert.deepEqual(result.outcome.finalFrame.robots,result.frames[0].robots);
  }
});

test('unsafe height and invalid transport order stop before picking, with an explicit plan finding',()=>{
  for(const edits of [{travelZ:220},{transferOrder:0},{transferOrder:2}]) {
    const result=run(1,0,edits);
    assert.equal(result.outcome.passed,false);
    assert.ok(result.frames.every(frame=>frame.workpieces[0].owner===null));
    assert.equal(result.outcome.observations.length,0);
    assert.ok(result.outcome.issues.some(message=>message.includes('시작하지')||message.includes('실행 전에')));
    assert.deepEqual(result.outcome.finalFrame.robots,result.frames[0].robots);
  }
});

test('comparison distinguishes the task goal, the student command and the FK-observed contact',()=>{
  const result=run(1,0,{targetX:310,targetY:-90,approachX:310,approachY:-90});
  const observation=result.outcome.observations.find(item=>item.label==='놓을 위치로 수직 하강');
  assert.equal(observation.target.x,310);
  assert.equal(observation.target.y,-90);
  assert.ok(near(observation.observed,observation.target));
  assert.ok(near(observation.goal,result.scenario.destination));
  assert.ok(!near(observation.goal,observation.observed));
  assert.ok(observation.atMs>0);
});

test('concurrent contact events retain the acting robot and its actual world TCP', () => {
  const result = run(4);
  const contactEvents = new Set(['A-grip', 'B-grip', 'handoff-release', 'A-cleared', 'B-cleared', 'placed']);
  const contacts = result.frames.filter(frame => contactEvents.has(frame.event));
  assert.ok(contacts.length >= 20);
  for (const frame of contacts) {
    const id = ['B-grip', 'B-cleared', 'placed'].includes(frame.event) ? 'B' : 'A';
    assert.equal(frame.eventRobot, id, frame.event);
    const robot = result.scenario.robots.find(robot => robot.id === id);
    assert.ok(near(frame.eventPoint, cell.localToWorld(frame.robots[id].pose, robot)), frame.event);
  }
  assert.equal(result.outcome.finalFrame.eventRobot, undefined, 'contact metadata must not leak to later frames');
  assert.equal(result.outcome.finalFrame.eventPoint, undefined);
});

test('all three student horizontal routes execute distinct paths to the same destination', () => {
  for (const level of [1, 2]) for (const routeChoice of [0, 1, 2]) {
    const result = run(level, 0, { routeChoice });
    assert.equal(result.outcome.passed, true, result.outcome.issues.join(', '));
    const lifted = result.frames.find(frame => frame.event === 'A-lifted');
    const above = result.frames.find(frame => frame.event === 'A-above');
    const corner = result.frames.find(frame => frame.event === 'A-corner');
    assert.ok(lifted && above);
    assert.ok(near(above.robots.A.pose, { ...result.scenario.destination, z: 300 }));
    const carried = result.frames.filter(frame => frame.atMs >= lifted.atMs && frame.atMs <= above.atMs);
    assert.ok(carried.every(frame => Math.abs(frame.robots.A.pose.z - 300) < .2));
    if (routeChoice === 0) assert.equal(corner, undefined);
    else assert.ok(near(corner.robots.A.pose, routeChoice === 1
      ? { x: result.scenario.destination.x, y: result.scenario.source.y, z: 300 }
      : { x: result.scenario.source.x, y: result.scenario.destination.y, z: 300 }));
  }
});

test('an inconsistent approach or a fully assembled wrong order is reported before movement', () => {
  for (const edits of [{ approachX: 320 }, { approachY: -90 }, { transferOrder: 2134 }]) {
    const result = run(1, 0, edits);
    assert.equal(result.outcome.passed, false);
    assert.equal(result.outcome.observations.length, 0);
    assert.ok(result.frames.every(frame => frame.workpieces.every(piece => piece.owner === null)));
    assert.ok(!result.frames.some(frame => ['A-lifted', 'A-above', 'placed'].includes(frame.event)));
    assert.ok(result.outcome.issues.some(issue => edits.transferOrder ? issue.includes('순서') : issue.includes('P3')));
  }
});

test('an unreachable horizontal corner never becomes an observed arrival', () => {
  const result = run(1, 0, { targetX: 1000, approachX: 1000, routeChoice: 1 });
  assert.equal(result.outcome.passed, false);
  assert.ok(result.frames.some(frame => frame.event === 'A-lifted'));
  assert.ok(result.outcome.issues.some(issue => issue.includes('역기구학')));
  assert.ok(!result.frames.some(frame => ['A-corner', 'A-above', 'placed'].includes(frame.event)));
  assert.ok(!result.outcome.observations.some(item => item.label === 'X 먼저 경유'));
});

test('all 24 packing orders drive block-to-slot assignments and recorded contact coordinates in every variant', () => {
  for (const variant of [0, 1, 2]) {
    const scenario = cell.processScenario(4, variant);
    const orders = scenario.questions.flatMap(q => q.fields).find(f => f.key === 'packingOrder').accepted;
    assert.equal(orders.length, 24);
    for (const order of orders) {
      const supplied = { ...answers(scenario), packingOrder: order };
      const plan = cell.processPackingPlan(scenario, supplied);
      const compiled = cell.compileProcess(model, scenario, supplied);
      assert.equal(compiled.outcome.passed, true, `${variant}/${order}: ${compiled.outcome.issues}`);
      const placements = compiled.frames.filter(frame => frame.event === 'placed');
      assert.deepEqual(placements.map(frame => frame.eventTraySlot), String(order).split('').map(n => Number(n) - 1));
      for (const item of plan) {
        const placed = compiled.outcome.finalFrame.workpieces.find(piece => piece.id === item.pieceId);
        assert.equal(placed.traySlot, item.slot);
        assert.ok(near(placed.top, scenario.tray.points[item.slot]));
        const observed = compiled.outcome.observations.find(p => p.robot === 'B' && p.pieceId === item.pieceId && p.label === '놓을 위치로 수직 하강');
        assert.equal(observed.traySlot, item.slot);
        assert.ok(near(observed.target, item.command));
        assert.ok(near(observed.observed, item.goal));
      }
    }
  }
});

test('a mistaken fourth-slot coordinate drives the robot and remains distinct from the physical goal', () => {
  const result = run(4, 0, { packingOrder: 4132, packingX: 268 });
  assert.equal(result.outcome.passed, false);
  assert.equal(result.outcome.completedPieces, 0);
  const miss = result.frames.find(frame => frame.event === 'place-miss');
  assert.equal(miss.eventTraySlot, 3); assert.equal(miss.eventPieceId, 'piece-1');
  const contact = result.outcome.observations.find(p => p.robot === 'B' && p.label === '놓을 위치로 수직 하강');
  assert.equal(contact.target.x, 268); assert.equal(contact.goal.x, 260);
  assert.ok(near(contact.target, contact.observed));
  assert.ok(!near(contact.goal, contact.observed));
});

test('missing or duplicated packing slots cannot silently become a default plan', () => {
  for (const packingOrder of [NaN, 123, 1123, 1235]) {
    const result = run(4, 0, { packingOrder });
    assert.equal(result.outcome.passed, false);
    assert.ok(!result.frames.some(frame => frame.event === 'A-grip'));
  }
});

test('saved earlier level-four conditions still reproduce their original row-first plan', () => {
  const scenario = cell.processScenario(4);
  delete scenario.tray.predictionSlot; scenario.id = 'cell-v4-4-0';
  scenario.questions.at(-1).fields = scenario.questions.at(-1).fields.filter(f => !f.key.startsWith('packing'));
  const compiled = cell.compileProcess(model, scenario, answers(scenario));
  assert.equal(compiled.outcome.passed, true);
  assert.deepEqual(compiled.outcome.finalFrame.workpieces.map(p => p.traySlot), [0, 1, 2, 3]);
});
