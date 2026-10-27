// Run from artifacts/robot-control: node --test src/suctionZoom.test.cjs
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),THREE=require('three');
function load(name,deps){
  const api={},source=fs.readFileSync(path.join(__dirname,name),'utf8');
  new Function('exports','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText)(api,n=>{assert.ok(n in deps,n);return deps[n];});
  return api;
}
const cupAPI=load('suctionCupGeometry.ts',{three:THREE});
const zoom=load('suctionZoom.ts',{three:THREE});
function fixture(){const wrist=new THREE.Group(),cup=cupAPI.createSuctionCup();wrist.add(cup);return {wrist,cup};}
class Renderer {
  constructor(){this.viewport=new THREE.Vector4(0,0,900,700);this.scissor=new THREE.Vector4(2,3,800,600);this.scissorTest=false;this.color=new THREE.Color('#ebebeb');this.alpha=.8;this.autoClear=false;this.shadowMap={autoUpdate:true};this.calls=[];}
  getViewport(v){return v.copy(this.viewport)}setViewport(...args){this.viewport=args[0] instanceof THREE.Vector4?args[0].clone():new THREE.Vector4(...args)}
  getScissor(v){return v.copy(this.scissor)}setScissor(...args){this.scissor=args[0] instanceof THREE.Vector4?args[0].clone():new THREE.Vector4(...args)}
  getScissorTest(){return this.scissorTest}setScissorTest(v){this.scissorTest=v}
  getClearColor(c){return c.copy(this.color)}getClearAlpha(){return this.alpha}setClearColor(c,a){this.color=new THREE.Color(c);this.alpha=a}
  render(scene,camera){this.calls.push({scene,camera,viewport:this.viewport.clone(),scissor:this.scissor.clone(),scissorTest:this.scissorTest,autoClear:this.autoClear,shadowAutoUpdate:this.shadowMap.autoUpdate});if(this.fail)throw Error('render error')}
  getSize(v){return v.set(900,700)}
  snapshot(){return {viewport:this.viewport.toArray(),scissor:this.scissor.toArray(),test:this.scissorTest,color:this.color.getHex(),alpha:this.alpha,clear:this.autoClear,shadow:this.shadowMap.autoUpdate}}
}
test('zoom uses the actual cup resources and live J4 transform without mutating or reparenting the robot',()=>{
  const {wrist,cup}=fixture(),view=new zoom.SuctionZoomView();const original=cup.parent,position=cup.position.clone();
  for(const angle of [-67.25,-48.75,-35.75,90,-180,0]){
    wrist.rotation.z=THREE.MathUtils.degToRad(angle);assert.ok(Math.abs(view.sync(cup)-angle)<1e-10);
    assert.ok(view.rotation.quaternion.angleTo(wrist.quaternion)<1e-7);assert.equal(cup.parent,original);assert.deepEqual(cup.position,position);
    const clone=view.rotation.children[0];assert.notEqual(clone,cup);
    clone.children.forEach((mesh,i)=>{assert.equal(mesh.geometry,cup.children[i].geometry);assert.equal(mesh.material[0],cup.children[i].material[0]);assert.equal(mesh.material[0].map,cup.children[i].material[0].map)});
  }
  assert.ok(Math.abs(view.rotation.rotation.z)<1e-10,'Home orientation is read immediately');view.release();cupAPI.disposeSuctionCup(cup);
});
test('closing and reopening zoom never disposes shared cup resources and accepts a remounted robot',()=>{
  const {cup}=fixture(),view=new zoom.SuctionZoomView();let disposed=0;
  cup.children.forEach(m=>m.geometry.addEventListener('dispose',()=>disposed++));cup.children[0].material[0].map.addEventListener('dispose',()=>disposed++);
  view.sync(cup);const first=view.rotation.children[0];view.release();assert.equal(view.rotation.children.length,0);assert.equal(disposed,0);
  view.sync(cup);assert.notEqual(view.rotation.children[0],first);
  const other=fixture();other.wrist.rotation.z=.7;view.sync(other.cup);assert.equal(view.rotation.children.length,1);assert.equal(view.rotation.children[0].children[0].geometry,other.cup.children[0].geometry);
  view.release();assert.equal(disposed,0);cupAPI.disposeSuctionCup(cup);cupAPI.disposeSuctionCup(other.cup);
});
test('inset viewport follows resized, shifted and CSS-scaled canvases without applying DPR twice',()=>{
  assert.deepEqual(zoom.suctionZoomViewport({left:100,top:60,width:900,height:700},{left:114,top:440,width:280,height:180},{x:900,y:700}),{x:14,y:140,width:280,height:180});
  assert.deepEqual(zoom.suctionZoomViewport({left:10,top:20,width:450,height:350},{left:17,top:210,width:140,height:90},{x:900,y:700}),{x:14,y:140,width:280,height:180});
  assert.equal(zoom.suctionZoomViewport({left:0,top:0,width:0,height:1},{left:0,top:0,width:1,height:1},{x:1,y:1}),null);
  assert.equal(zoom.suctionZoomViewport({left:0,top:0,width:900,height:700},{left:910,top:0,width:100,height:100},{x:900,y:700}),null);
});
test('inset drawing confines clearing to its rectangle and restores renderer state even on failure',()=>{
  const renderer=new Renderer(),view=new zoom.SuctionZoomView(),before=renderer.snapshot(),rect={x:14,y:140,width:280,height:180};
  zoom.drawSuctionZoom(renderer,view,rect);assert.deepEqual(renderer.snapshot(),before);
  const call=renderer.calls[0];assert.deepEqual(call.viewport.toArray(),[14,140,280,180]);assert.deepEqual(call.scissor,call.viewport);
  assert.equal(call.scissorTest,true);assert.equal(call.autoClear,true);assert.equal(call.shadowAutoUpdate,false);
  renderer.fail=true;assert.throws(()=>zoom.drawSuctionZoom(renderer,view,rect),/render error/);assert.deepEqual(renderer.snapshot(),before);
});
test('R3F pass draws after live-joint updates, then displays the same angle and preserves the main camera',()=>{
  const frames=[],cleanup=[];
  const component=load('SuctionZoom.tsx',{react:{useMemo:fn=>fn(),useEffect:fn=>cleanup.push(fn())},'react/jsx-runtime':require('react/jsx-runtime'),'@react-three/fiber':{useFrame:(fn,priority)=>frames.push({fn,priority})},three:THREE,'./suctionZoom':zoom});
  const {wrist,cup}=fixture(),renderer=new Renderer(),mainScene=new THREE.Scene(),mainCamera=new THREE.PerspectiveCamera();mainCamera.position.set(650,380,850);
  renderer.domElement={getBoundingClientRect:()=>({left:0,top:0,width:900,height:700})};
  const slotRef={current:{getBoundingClientRect:()=>({left:14,top:400,width:280,height:180})}},angleRef={current:{textContent:''}};
  const sourceRef={current:cup};component.SuctionZoomPass({sourceRef,slotRef,angleRef});assert.equal(frames[0].priority,1);
  for(const angle of [-67.25,-35.75,0]){
    wrist.rotation.z=THREE.MathUtils.degToRad(angle);renderer.calls=[];frames[0].fn({gl:renderer,scene:mainScene,camera:mainCamera});
    assert.equal(renderer.calls[0].scene,mainScene);assert.equal(renderer.calls[0].camera,mainCamera);assert.equal(renderer.calls.length,2);
    assert.equal(angleRef.current.textContent,angle.toFixed(2)+'°');assert.deepEqual(mainCamera.position.toArray(),[650,380,850]);
  }
  sourceRef.current=null;renderer.calls=[];frames[0].fn({gl:renderer,scene:mainScene,camera:mainCamera});assert.equal(renderer.calls.length,1,'main scene renders while model loads');
  cleanup.forEach(fn=>fn?.());cupAPI.disposeSuctionCup(cup);
});
test('production UI mounts zoom only when requested on Home, leaving the lesson and motion controls in place',()=>{
  const app=fs.readFileSync(path.join(__dirname,'App.tsx'),'utf8'),robot=fs.readFileSync(path.join(__dirname,'Robot3D.tsx'),'utf8');
  assert.match(app,/suctionZoomOpen=\{activeNav === null && suctionZoomOpen\}/);
  assert.match(app,/if \(activeNav !== null\) setSuctionZoomOpen\(false\)/);
  assert.match(app,/aria-label="흡착기 확대보기" aria-expanded=\{suctionZoomOpen\}/);
  assert.match(robot,/showSuctionZoom && <SuctionZoomPass/);assert.match(robot,/showSuctionZoom && <SuctionZoomPanel/);
  assert.match(robot,/!!suctionZoomOpen && endEffector === "suction"/);
  assert.match(app,/startJoint\("j4",\s+1\)/);assert.match(app,/startJoint\("j4",\s+-1\)/);
  assert.match(app,/axis === "r"[\s\S]*?rotationJogDelta\(speedRef\.current, dir\)/);
  assert.match(app,/k === "j4"[\s\S]*?rotationJogDelta\(speedRef\.current, dir\)/);
});
test('the complete cup stays within the inset at narrow and wide sizes through a full turn',()=>{
  const {wrist,cup}=fixture(),view=new zoom.SuctionZoomView(),renderer=new Renderer();
  for(const [width,height]of [[100,200],[250,180],[300,100]])for(const angle of [0,45,90,135,180,225,270,315]){
    wrist.rotation.z=THREE.MathUtils.degToRad(angle);view.sync(cup);
    zoom.drawSuctionZoom(renderer,view,{x:0,y:0,width,height});view.scene.updateMatrixWorld(true);view.camera.updateMatrixWorld(true);
    view.rotation.traverse(object=>{if(!object.isMesh)return;const points=object.geometry.getAttribute('position');
      for(let i=0;i<points.count;i++){const p=new THREE.Vector3().fromBufferAttribute(points,i).applyMatrix4(object.matrixWorld).project(view.camera);assert.ok(Math.abs(p.x)<.95&&Math.abs(p.y)<.95&&Math.abs(p.z)<1,`clipped at ${width}x${height}, ${angle}`);}
    });
  }view.release();cupAPI.disposeSuctionCup(cup);
});
test('the optional panel closes via its button or Escape and removes the keyboard listener',()=>{
  const listeners=new Map(),cleanups=[];let closed=0;
  const previous=global.window;global.window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{assert.equal(listeners.get(name),fn);listeners.delete(name)}};
  try{
    const component=load('SuctionZoom.tsx',{react:{useEffect:fn=>cleanups.push(fn()),useMemo:fn=>fn()},'react/jsx-runtime':require('react/jsx-runtime'),'@react-three/fiber':{useFrame:()=>{}},three:THREE,'./suctionZoom':zoom});
    const panel=component.SuctionZoomPanel({slotRef:{current:null},angleRef:{current:null},onClose:()=>closed++});
    const nodes=[];function visit(node){if(!node||typeof node!=='object')return;nodes.push(node);for(const child of [node.props?.children].flat())visit(child)}visit(panel);
    const close=nodes.find(n=>n.type==='button');assert.equal(close.props['aria-label'],'흡착기 확대보기 닫기');close.props.onClick();
    listeners.get('keydown')({key:'Escape'});listeners.get('keydown')({key:'ArrowRight'});assert.equal(closed,2);
    cleanups.forEach(fn=>fn?.());assert.equal(listeners.size,0);
  }finally{global.window=previous;}
});
