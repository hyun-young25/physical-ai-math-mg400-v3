// Run from artifacts/robot-control: node --test src/link5Appearance.test.cjs
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),THREE=require('three');
const api={};
new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'link5Appearance.ts'),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(api,name=>{assert.equal(name,'three');return THREE;});

test('link5 cleanup removes the lower protrusion without mutating the source STL',()=>{
  const geometry=new THREE.BufferGeometry();
  const original=new Float32Array([
    0,0,0, .02,0,0, 0,.02,0,
    0,0,-.05, .02,0,-.07, 0,.02,-.07,
    0,0,-.08, .02,0,-.08, 0,.02,-.08,
  ]);
  geometry.setAttribute('position',new THREE.BufferAttribute(original.slice(),3));
  const before=Array.from(geometry.getAttribute('position').array);
  const cleaned=api.cleanLink5Silhouette(geometry);
  assert.deepEqual(Array.from(geometry.getAttribute('position').array),before);
  assert.ok(Array.from(cleaned.getAttribute('position').array).every((_,i,a)=>i%3!==2||a[i]>=api.LINK5_CLEAN_UNDERSIDE_Z-1e-6));
  assert.equal(cleaned.getAttribute('position').count,12);
  const position=cleaned.getAttribute('position');
  const cap=[];
  for(let i=6;i<12;i++) cap.push([position.getX(i),position.getY(i),position.getZ(i)]);
  assert.deepEqual(cap.map(p=>p.slice(0,2).map(v=>Math.round(v*1000)/1000)),[
    [0,0],[0,.02],[.02,.02],[0,0],[.02,.02],[.02,0],
  ]);
  assert.ok(cap.every(p=>Math.abs(p[2]-api.LINK5_CLEAN_UNDERSIDE_Z)<1e-6));
  const normal=cleaned.getAttribute('normal');
  assert.ok(Array.from({length:6},(_,i)=>normal.getZ(i+6)).every(z=>z<-.99));
});

test('link5 finish colours the cleaned housing and collar',()=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([
    0,0,0, .02,0,-.058, 0,.02,-.062,
  ],3));
  api.applyLink5Finish(geometry);
  assert.equal(geometry.getAttribute('color').count,geometry.getAttribute('position').count);
  const color=geometry.getAttribute('color');
  const top=new THREE.Color().fromBufferAttribute(color,0);
  assert.ok(top.getHexString()==='c4c8cc');
  assert.ok(new THREE.Color().fromBufferAttribute(color,1).getHex()!==top.getHex());
});

test('production fixes the cleaned housing around the real J4 output group',()=>{
  const source=fs.readFileSync(path.join(__dirname,'Robot3D.tsx'),'utf8');
  assert.match(source,/cleanLink5Silhouette\(l5G\)/);
  assert.match(source,/applyLink5Finish\(cleaned\)/);
  const ast=ts.createSourceFile('Robot3D.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const nodes=[];function visit(n){nodes.push(n);ts.forEachChild(n,visit);}visit(ast);
  const j4=nodes.find(n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(ast)==='group'&&n.openingElement.attributes.getText(ast).includes('ref={j4Ref}'));
  assert.ok(j4);assert.doesNotMatch(j4.getText(ast),/geometry=\{link5DisplayG\}/);
  assert.match(source,/<group position=\{\[0\.066, 0\.017, 0\.031\]\}>\s*<mesh geometry=\{link5DisplayG\} material=\{link5M\}\/>[\s\S]*?<group ref=\{j4Ref\}>/);
});
