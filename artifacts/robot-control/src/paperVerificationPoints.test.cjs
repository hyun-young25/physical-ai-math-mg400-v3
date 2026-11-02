const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const target=path.join(__dirname,"paperCoordinateStudy.ts"),exports_={};
new Function("exports","require",ts.transpileModule(fs.readFileSync(target,"utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(exports_,name=>{
  if(name==="./paperDiagnosisLabel")return {PAPER_AXIS_SWAP_CANDIDATE:"axis-swap"};
  if(name==="./originMissing")return {omitsOrigin:()=>false};
  throw new Error(`Unexpected import ${name}`);
});

test("verification labels are based on physical paper coordinates, not point names",()=>{
  const targets=[
    {name:"P1",xCm:0,yCm:0},
    {name:"P2",xCm:2,yCm:3},
    {name:"P3",xCm:9,yCm:3},
    {name:"P4",xCm:2,yCm:12},
  ];
  const split=exports_.classifyPaperVerificationPoints(targets);
  assert.deepEqual(split.currentVerificationPoints,["P1","P2","P3","P4"]);
  assert.deepEqual(split.independentVerificationPoints,["P2","P3","P4"]);
  assert.deepEqual(split.constructionOverlaps,[
    {targetPoint:"P1",constructionPoint:"O"},
  ]);
  assert.deepEqual(exports_.paperVerificationPointGuide(targets),{
    current:"P1·P2·P3·P4",
    independent:"P2·P3·P4",
    excluded:"P1=O",
  });
});

test("a retry with only non-overlapping points labels every point independent",()=>{
  const targets=[
    {name:"P1",xCm:2,yCm:3},
    {name:"P2",xCm:9,yCm:3},
    {name:"P3",xCm:9,yCm:12},
    {name:"P4",xCm:2,yCm:12},
  ];
  assert.deepEqual(exports_.paperVerificationPointGuide(targets),{
    current:"P1·P2·P3·P4",
    independent:"P1·P2·P3·P4",
    excluded:"없음",
  });
});

test("criteria reject name-only independence for new runs and normalize legacy runs without editing them",()=>{
  const targets=[{name:"P1",xCm:0,yCm:0},{name:"P2",xCm:9,yCm:3}];
  const correct={recordId:"attempt",frameId:"frame",planHash:"plan",targetSet:"initial",
    modelConstructionPoints:["O","X","Y"],...exports_.classifyPaperVerificationPoints(targets),
    positionToleranceMm:2,rotationToleranceDeg:2,rationale:"검증 기준",confirmedAt:1};
  assert.equal(exports_.paperVerificationPointsMatch(correct,targets),true);
  assert.equal(exports_.paperVerificationPointsAreValid(correct,targets),true);
  const wrong={...correct,currentVerificationPoints:undefined,constructionOverlaps:undefined,
    independentVerificationPoints:targets.map(point=>point.name)};
  assert.equal(exports_.paperVerificationPointsMatch(wrong,targets),false);
  assert.equal(exports_.paperVerificationPointsAreValid(wrong,targets),false);
  assert.equal(exports_.paperVerificationPointsAreValid(wrong,targets,true),true);
  const canonical=exports_.canonicalPaperVerificationCriteria(wrong,targets);
  assert.deepEqual(canonical.independentVerificationPoints,["P2"]);
  assert.deepEqual(canonical.constructionOverlaps,[{targetPoint:"P1",constructionPoint:"O"}]);
  assert.equal(wrong.independentVerificationPoints.length,2,"old saved record is not rewritten");
});
