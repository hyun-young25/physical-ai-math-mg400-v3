// Pure lesson tests stay anonymous and exercise the old storage contract.
// Authentication/outbox behavior is separately tested in learningSync.test.cjs.
const fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const squareModules={};
function squareDependency(name){
  if(squareModules[name])return squareModules[name];
  const exports=squareModules[name]={};
  new Function("exports","require",ts.transpileModule(
    fs.readFileSync(path.join(__dirname,name+".ts"),"utf8"),{
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
    }).outputText)(exports,dependency=>squareDependency(dependency.replace("./","")));
  return exports;
}
module.exports = {
  "./squareAttemptHistory":{useSquareAttemptHistory:()=>({items:[],reviewed:null,capture:()=>{},meta:{owner:"test",selected:"",items:[]}}),SquareAttemptHistory:()=>null,SquareAttemptReview:()=>null},
  "./paperRectangleTask": squareDependency("paperRectangleTask"),
  "./useSquareVisual": {useSquareVisual:()=>({visual:null})},
  "./squareComparisonVisual": squareDependency("squareComparisonVisual"),
  "./squareVisualizationStore": { publishSquareVisual:()=>{},clearSquareVisual:()=>{} },
  "./SquareComparisonView": { SquareReplayControls:"SquareReplayControls",SquareObservedDiagram:"SquareObservedDiagram" },
  "./squareLearningFlow": squareDependency("squareLearningFlow"),
  "./squareMismatchDiagnosis": squareDependency("squareMismatchDiagnosis"),
  "./SquareDiagnosisPanel": { SquareDiagnosisPanel: "SquareDiagnosisPanel" },
  "./LearningAiFeedback": { LearningAiFeedback: () => null, useLearningAi: context => ({context,request:()=>Promise.resolve()}) },
  "./learningAiContext": { makeFeedbackContext: () => ({}), numericFeedbackContext:()=>({}) },
  "./learningClient": { getLearningUser: () => null },
  "./learningSync": {
    LEARNING_CONTENT_VERSION: "test-content",
    getEvidenceItem: key => global.localStorage.getItem(key),
    setEvidenceItem: (key, value) => global.localStorage.setItem(key, value),
    removeEvidenceItem: key => global.localStorage.removeItem(key),
    recordLearningAction: () => {},
  },
};
