// Run from artifacts/robot-control: node --test src/suctionCup.test.cjs
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),THREE=require('three');
const api={};
new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'suctionCupGeometry.ts'),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(api,name=>{assert.equal(name,'three');return THREE;});
const parts=[
  [.0101,.0101,.014,32,-.102],
  [.0101,.0135,.010,32,-.114],
  [.0135,.0135,.002,48,-.120],
];
function fixture(){
  const root=new THREE.Group();root.rotation.x=-Math.PI/2;root.scale.setScalar(1000);
  const wrist=new THREE.Group();wrist.position.set(.066,.017,.031);root.add(wrist);
  const cup=api.createSuctionCup();wrist.add(cup);return {root,wrist,cup};
}
test('rounded connector preserves cup dimensions, caps and local transform',()=>{
  const cup=api.createSuctionCup();assert.equal(cup.children.length,3);
  cup.children.forEach((mesh,i)=>{
    const [rt,rb,h,n,z]=parts[i],source=new THREE.CylinderGeometry(rt,rb,h,n),old=source.toNonIndexed();
    for(const name of ['position','normal','uv'])assert.deepEqual(mesh.geometry.getAttribute(name).array,old.getAttribute(name).array);
    assert.deepEqual(mesh.position.toArray(),[0,0,z]);assert.deepEqual(mesh.rotation.toArray(),[Math.PI/2,0,0,'XYZ']);
    assert.deepEqual(mesh.geometry.groups,old.groups);
    assert.equal(mesh.material[0].transparent,false);assert.ok(mesh.material[0].map);assert.equal(mesh.material[1].map,null);
    source.dispose();old.dispose();
  });api.disposeSuctionCup(cup);
});
test('unequal circumferential bands cover every visible half while caps remain plain',()=>{
  const cup=api.createSuctionCup(),texture=cup.children[0].material[0].map;
  for(const mesh of cup.children)assert.equal(mesh.material[0].map,texture,'same markings on all three cup parts');
  assert.equal(new Set(api.SUCTION_MARKS.map(m=>m.width)).size,3);
  assert.ok(api.SUCTION_MARKS.every(m=>m.color[2]>m.color[0]&&m.color[2]>m.color[1]),'all direction marks stay in the blue family');
  assert.ok(api.SUCTION_MARKS.some(m=>m.color[0]<40&&m.color[1]<70),'one high-contrast index mark is navy');
  assert.ok(api.SUCTION_MARKS.some(m=>m.color[1]>150&&m.color[2]>220),'one direction mark is sky blue');
  for(let offset=0;offset<512;offset++){
    let marked=0;
    for(let x=0;x<256;x++)if(texture.image.data[((offset+x)%512)*4]!==208)marked++;
    assert.ok(marked>35&&marked<220,`plain surface and a direction mark remain visible at offset ${offset}`);
  }
  assert.equal(texture.colorSpace,THREE.SRGBColorSpace);api.disposeSuctionCup(cup);
});
function pixel(hit){
  if(!hit)return '-';
  const material=hit.object.material[hit.face.materialIndex],map=material.map;
  if(!map)return 'cap';
  const x=Math.floor(((hit.uv.x%1+1)%1)*map.image.width);
  return String(map.image.data[x*4]);
}
test('surface rotates one-to-one with the existing J4 transform while the on-axis TCP stays fixed',()=>{
  const {root,wrist,cup}=fixture();const probe=new THREE.Vector3(.0101,0,-.102),tip=new THREE.Vector3(0,0,-.120);
  root.updateMatrixWorld(true);const homeTip=tip.clone().applyMatrix4(wrist.matrixWorld),homeProbe=probe.clone().applyMatrix4(wrist.matrixWorld);
  for(const angle of [-180,-90,-15,0,15,45,90,180,0]){
    wrist.rotation.z=THREE.MathUtils.degToRad(angle);root.updateMatrixWorld(true);
    assert.ok(tip.clone().applyMatrix4(wrist.matrixWorld).distanceTo(homeTip)<1e-10);
    const actual=probe.clone().applyMatrix4(wrist.matrixWorld);
    const expected=homeProbe.clone().sub(homeTip).applyAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(angle)).add(homeTip);
    assert.ok(actual.distanceTo(expected)<1e-10,`angle ${angle}`);
  }
  assert.ok(probe.clone().applyMatrix4(wrist.matrixWorld).distanceTo(homeProbe)<1e-10,'Home restores the surface direction');
  api.disposeSuctionCup(cup);
});
test('small home and side projections change surface colour when J4 rotates',()=>{
  const {root,wrist,cup}=fixture();root.scale.setScalar(1);wrist.position.set(0,0,0);
  for(const view of [[.10,-.068,.17],[0,-.068,.20],[.20,-.068,0]]){
    const camera=new THREE.OrthographicCamera(-.019,.019,.0178,-.0178,.001,10);
    camera.position.set(...view);camera.lookAt(0,-.108,0);camera.updateMatrixWorld(true);
    const ray=new THREE.Raycaster(),signatures=[];
    for(const angle of [-67.25,-48.75,-35.75,...Array.from({length:24},(_,i)=>i*15)]){
      wrist.rotation.z=THREE.MathUtils.degToRad(angle);root.updateMatrixWorld(true);
      const samples=[];
      for(let y=0;y<24;y++)for(let x=0;x<24;x++){
        ray.setFromCamera(new THREE.Vector2((x+.5)/12-1,1-(y+.5)/12),camera);
        const hit=ray.intersectObject(cup,true)[0];samples.push(pixel(hit));
      }
      assert.ok(samples.filter(c=>Number(c)!==208).length>10,'direction mark visible at '+angle);
      signatures.push(samples.join(','));
    }
    assert.equal(new Set(signatures).size,27,'even a 24px crop distinguishes orientations through the full turn');
  }api.disposeSuctionCup(cup);
});
test('production component places cup and TCP under the same J4 group, without the floating cue',()=>{
  const source=fs.readFileSync(path.join(__dirname,'Robot3D.tsx'),'utf8');
  const ast=ts.createSourceFile('Robot3D.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const nodes=[];function visit(n){nodes.push(n);ts.forEachChild(n,visit);}visit(ast);
  const group=nodes.find(n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='group'&&n.openingElement.attributes.getText(ast).includes('ref={j4Ref}'));
  assert.ok(group);const text=group.getText(ast);
  assert.match(text,/<SuctionCup sourceRef=\{suctionSourceRef\}\/>/);
  // Read the selected-tool expression rather than matching one obsolete TCP
  // literal. Both tools must track their visible lower end in the J4 group.
  const evaluate=(node,bindings={})=>{
    if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node))return evaluate(node.expression,bindings);
    if(ts.isNumericLiteral(node))return Number(node.text);
    if(ts.isStringLiteral(node))return node.text;
    if(ts.isIdentifier(node)){assert.ok(node.text in bindings,`Unknown binding ${node.text}`);return bindings[node.text];}
    if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.MinusToken)return -evaluate(node.operand,bindings);
    if(ts.isArrayLiteralExpression(node))return node.elements.map(value=>evaluate(value,bindings));
    if(ts.isConditionalExpression(node))return evaluate(evaluate(node.condition,bindings)?node.whenTrue:node.whenFalse,bindings);
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsEqualsEqualsToken)return evaluate(node.left,bindings)===evaluate(node.right,bindings);
    assert.fail(`Unsupported tool expression: ${node.getText()}`);
  };
  const attribute=(node,name)=>{
    const opening=ts.isJsxElement(node)?node.openingElement:node;
    const value=opening.attributes.properties.find(prop=>ts.isJsxAttribute(prop)&&prop.name.getText()===name);
    assert.ok(value&&ts.isJsxExpression(value.initializer),`Missing ${name}`);return value.initializer.expression;
  };
  const inside=(node,parent)=>{for(let current=node;current;current=current.parent)if(current===parent)return true;return false;};
  const tracker=nodes.find(node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(ast)==='mesh'&&node.openingElement.attributes.getText(ast).includes('ref={endEffTrackerRef}'));
  assert.ok(tracker&&inside(tracker,group),'TCP tracker must share the J4 group');
  const penAst=ts.createSourceFile('shapeKinematics.ts',fs.readFileSync(path.join(__dirname,'shapeKinematics.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  let penTip;
  function findPenTip(node){if(ts.isVariableDeclaration(node)&&node.name.getText(penAst)==='SHAPE_PEN_TIP_LOCAL_Z')penTip=evaluate(node.initializer);ts.forEachChild(node,findPenTip);}
  findPenTip(penAst);assert.equal(penTip,-.144);
  const position=attribute(tracker,'position');
  const suctionPosition=evaluate(position,{endEffector:'suction',SHAPE_PEN_TIP_LOCAL_Z:penTip});
  const penPosition=evaluate(position,{endEffector:'pen',SHAPE_PEN_TIP_LOCAL_Z:penTip});
  assert.deepEqual(suctionPosition,[0,0,-.121]);
  assert.ok(Math.abs(suctionPosition[2]-(parts[2][4]-parts[2][2]/2))<1e-12,'suction TCP is at the cup lip, not its centre');
  const toolBranch=nodes.find(node=>ts.isConditionalExpression(node)&&node.condition.getText(ast)==='endEffector === "pen"'&&ts.isJsxSelfClosingElement(node.whenFalse)&&node.whenFalse.tagName.getText(ast)==='SuctionCup');
  assert.ok(toolBranch&&inside(toolBranch,group));
  const penRod=nodes.find(node=>ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='Cyl'&&inside(node,toolBranch.whenTrue));
  assert.ok(penRod,'rendered pen rod is in the selected pen branch');
  const penCentre=evaluate(attribute(penRod,'p'));
  const penHeight=evaluate(attribute(penRod,'h'));
  assert.deepEqual(evaluate(attribute(penRod,'rot'),{PI2:Math.PI/2}),[Math.PI/2,0,0]);
  assert.deepEqual(penPosition,[penCentre[0],penCentre[1],penCentre[2]-penHeight/2]);
  assert.doesNotMatch(text,/geometry=\{link5DisplayG\}/,'fixed housing must not rotate with J4');
  assert.match(text,/endEffector === "pen" \? \([\s\S]*?\) : <SuctionCup sourceRef=\{suctionSourceRef\}\/>/);
  assert.match(source,/j4Ref\.current\.rotation\.z\s*=\s*a4 \* dd/);
  assert.doesNotMatch(source,/showJ4MotionCue/);
});
test('unmount releases all cup geometries, shared materials and texture exactly once',()=>{
  const cup=api.createSuctionCup();let geometries=0,materials=0,textures=0;
  cup.children.forEach(mesh=>mesh.geometry.addEventListener('dispose',()=>geometries++));
  new Set(cup.children[0].material).forEach(m=>m.addEventListener('dispose',()=>materials++));
  cup.children[0].material[0].map.addEventListener('dispose',()=>textures++);api.disposeSuctionCup(cup);
  assert.equal(geometries,3);assert.equal(materials,2);assert.equal(textures,1);
});
