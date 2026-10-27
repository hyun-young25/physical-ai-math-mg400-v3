const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'App.tsx'),'utf8');
const robot=fs.readFileSync(path.join(__dirname,'Robot3D.tsx'),'utf8');

test('home guide distinguishes joint angles from TCP coordinates before manipulation',()=>{
  assert.match(app,/activeNav === null && <div className="absolute left-3 z-20"/);
  assert.match(app,/관절 J1–J4[\s\S]*각 관절의 각도를 바꿉니다/);
  assert.match(app,/좌표 X·Y·Z·R[\s\S]*TCP의 위치와 자세를 바꿉니다/);
  assert.match(app,/① 안내 선택[\s\S]*② 같은 색 ± 버튼으로 관찰[\s\S]*③ 안내를 닫고 직접 조작/);
  assert.match(app,/aria-pressed=\{jointGuideOpen\}/);
  assert.match(app,/aria-pressed=\{coordGuideOpen\}/);
});

test('the introductory home card collapses after the first control and remains manually reopenable',()=>{
  assert.match(app,/physical-ai-home-intro-seen-v1/);
  assert.match(app,/const dismissHomeIntro = useCallback/);
  assert.match(app,/const startJog[\s\S]*?dismissHomeIntro\(\)/);
  assert.match(app,/const startJoint[\s\S]*?dismissHomeIntro\(\)/);
  assert.match(app,/aria-pressed=\{homeIntroOpen\}[\s\S]*?>처음 사용 안내<\/button>/);
  assert.match(app,/homeIntroOpen && !jointGuideOpen && !coordGuideOpen/);
  assert.match(app,/aria-label="처음 사용 안내 닫기"/);
});

test('coordinate guide keeps one focused 3D cue without the large TCP teaching card',()=>{
  assert.match(app,/compactCoordinateHelp=\{isAxesLesson \|\| isCoordinateLesson \|\| coordGuideOpen\}/);
  assert.match(app,/같은 색 ± 버튼을 누르며 TCP 변화를 관찰하세요/);
});

test('R guidance uses the same navy family without covering the tool motion',()=>{
  assert.match(app,/r: \{ color:"#1e3a8a"/);
  assert.match(app,/leftColor=\{cx === "r" \? "#1e3a8a"/);
  assert.match(robot,/r:"#1e3a8a"/);
  assert.match(robot,/const radius = 30, sweep = Math\.PI \* 0\.68/);
  assert.match(robot,/Two short arrowed arcs communicate both R directions/);
  assert.doesNotMatch(robot,/torusGeometry args=\{\[65, 7/);
});

test('Z guidance shows both directions beside the TCP instead of losing Z-minus below the floor',()=>{
  assert.match(robot,/if \(axis === "z"\)/);
  assert.match(robot,/const xOffset = 42, half = 46, tipH = 10/);
  assert.match(robot,/>Z\+<\/div>/);
  assert.match(robot,/>Z−<\/div>/);
});

test('coordinate guide keeps the TCP endpoint subtle and non-emissive',()=>{
  assert.match(robot,/const SPHERE_R = 3/);
  assert.match(robot,/color="#dbeafe" roughness=\{0\.65\}/);
  assert.doesNotMatch(robot,/function TcpCrosshair/);
  assert.doesNotMatch(robot,/color="#eab308" emissive="#eab308" emissiveIntensity=\{9\}/);
});

test('joint guide uses the same part-highlight language for J1 through J4',()=>{
  assert.match(app,/아래에서 같은 색 J± 버튼을 누르며 변화를 관찰하세요/);
  for(const joint of ['j1','j2','j3','j4']) assert.match(robot,new RegExp(`highlightJoint === "${joint}"`));
  assert.doesNotMatch(robot,/J[134] rotation (axis )?indicator/);
  assert.doesNotMatch(robot,/>J4 회전축<\/div>/);
  assert.match(robot,/h=\{0\.030\} p=\{\[0,0,-0\.022\]/,'J4 highlight stays above the spring and cup markings');
  const link5=fs.readFileSync(path.join(__dirname,'link5Appearance.test.cjs'),'utf8');
  assert.match(link5,/fixed housing must not rotate with J4|fixes the cleaned housing around the real J4 output group/);
});
