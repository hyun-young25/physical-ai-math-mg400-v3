import type { FeedbackContext } from "./learningAiContext";

type Row=Record<string,unknown>;
const object=(v:unknown):Row=>v&&typeof v==="object"&&!Array.isArray(v)?v as Row:{};
const parse=(s:string):unknown=>{try{return JSON.parse(s);}catch{return null;}};
export type SubmissionError={key:string;label:string;detail?:string;value?:unknown;expected?:unknown};
export type SubmissionAssessment={correct:boolean;errors:SubmissionError[];keys:string[]};
/** Read only explicit objective verdicts. Never classify prose, motion status or missing results. */
export function submittedAssessment(c:FeedbackContext):SubmissionAssessment|null {
  const raw=parse(c.judgment),j=object(raw);
  if(j.currentDraftPendingCheck||j.status==="unconfirmed")return null;
  const checks:{key:string;correct:boolean;error:SubmissionError}[]=[];
  const add=(key:string,correct:boolean,row:Row={})=>checks.push({key,correct,error:{
    key,label:String(row.label??key),detail:typeof row.feedback==="string"?row.feedback:undefined,
    value:row.value,expected:row.expected,
  }});
  const fields=Array.isArray(raw)?raw:Array.isArray(j.fields)?j.fields:Array.isArray(j.rows)?j.rows:[];
  fields.forEach((value,i)=>{
    const row=object(value),key=String(row.key??`${row.field??"항목"}${row.axis??i+1}`);
    if(typeof row.matched==="boolean")add(key,row.matched,row);
    else if(typeof row.correct==="boolean")add(key,row.correct,row);
  });
  Object.entries(object(j.fieldStatuses)).forEach(([key,status])=>{
    if(status==="correct"||status==="incorrect")add(key,status==="correct");
  });
  for(const key of ["comparisonCorrect","ruleCorrect","requirementsCorrect","predictionsCorrect"])
    if(typeof j[key]==="boolean")add(key,j[key]===true||(key!=="predictionsCorrect"&&j.reviewCorrect===true));
  if((c.task.startsWith("axis-")||c.task.startsWith("coordinate-application-"))
    &&(j.status==="correct"||j.status==="incorrect")&&!checks.length){
    const errors=Array.isArray(j.errors)?j.errors:object(j.previousSubmission).errors;
    if(j.status==="incorrect"&&Array.isArray(errors)&&errors.length)
      errors.forEach(key=>add(String(key),false));
    else add("수치·관계 판정",j.status==="correct");
  }
  if(!checks.length)return null;
  return {correct:checks.every(row=>row.correct),errors:checks.filter(row=>!row.correct).map(row=>row.error),keys:checks.map(row=>row.key)};
}

const labels:Record<string,string>={
  axis:"변하는 축·유지되는 축",sign:"증가·감소의 부호",distance:"이동 거리",
  relation:"이동 조건의 설명",comparisonCorrect:"절대·상대 명령의 도착점 비교",ruleCorrect:"좌표 관계식",
  requirementsCorrect:"요구 조건",predictionsCorrect:"도착점 예측",
  deltaX:"X 변화량",deltaY:"Y 변화량",deltaZ:"Z 변화량",targetZ:"목표 높이",deltaZ2:"높이 변화량",
};
const errorLabel=(e:SubmissionError)=>{
  const axis=e.key.match(/^(delta|absoluteEnd|relativeEnd)([xyz])$/i);
  return labels[e.key]??(axis?`${axis[1].toLowerCase()==="delta"?"변화량":axis[1].toLowerCase()==="absoluteend"?"절대 명령 도착점":"상대 명령 도착점"} ${axis[2].toUpperCase()}`:e.label);
};
export function automaticHint(c:FeedbackContext,a:SubmissionAssessment,attempt:number,wrongCount:number,previous?:SubmissionAssessment):string {
  const root=object(parse(c.condition)),p=object(root.problem??root.condition??root);
  const errors=a.errors.map(errorLabel).join("·");
  const step=typeof p.step==="number"?` · 단계 ${p.step+1}`:"";
  const prefix=`자동 피드백${step} · 제출 ${attempt}회${a.correct?"":` · 오답 ${wrongCount}회`}\n`;
  if(c.task==="square"&&!a.correct) {
    const items=a.errors.map(error=>{
      const value=error.value===undefined||String(error.value).trim()===""?"미입력":String(error.value);
      return `• ${error.label}: 내 입력 「${value}」\n${error.detail??"문제의 기준점과 이동 방향, 유지되는 축을 다시 확인해 주세요."}`;
    }).join("\n");
    const count=object(parse(c.judgment)).errorCount;
    return prefix+`아직 확인할 항목이 있어요.${typeof count==="number"?` 확인할 항목은 ${count}개이며 아래 항목부터 살펴봐요.`:""} 오답 상태에서는 실제 로봇을 실행할 수 없어요.\n`+
      (typeof p.instruction==="string"?`문제 조건: ${p.instruction.slice(0,260)}\n`:"")+`${items}\n`+
      (wrongCount>1?"1. 앞서 안내한 관계식에 내 값을 넣고 검산해 보세요.\n2. 각 변에서 바뀌는 축과 부호를 따로 적어 보세요.\n3. 수정 후 단계 확인을 다시 눌러 주세요. 막힌 항목을 질문하면 이어서 도와드릴게요."
        :"1. 문제에 주어진 시작점·길이·방향을 찾아보세요.\n2. 위 힌트로 틀린 항목부터 고쳐 보세요.\n3. 다시 확인한 뒤 예측 저장 → DT 실행·비교 순서로 진행해요.");
  }
  if(a.correct){
    const fixed=previous?.errors.map(errorLabel).join("·");
    const confirmed=a.keys.filter(key=>!previous?.keys.includes(key)).map(key=>errorLabel({key,label:key})).join("·");
    return prefix+(fixed?`앞서 확인이 필요했던 ${fixed}을 올바르게 고쳤습니다. 같은 기준점·축·단위로 다시 확인한 점이 좋아요.`
      :confirmed?`이번에 확인한 ${confirmed} 항목이 기존 판정과 일치합니다. 풀이의 근거는 별도로 확인하세요.`
      :"같은 항목을 다시 제출했고 기존 판정과 일치합니다. 앞서 확인한 기준을 유지하며 풀이 근거를 점검하세요.");
  }
  const detailed=wrongCount>1;
  if(wrongCount>=3){
    const first=a.errors[0],input=object(parse(c.answers));
    const value=first?.value??input[first?.key??""];
    const evidence=typeof value==="number"||typeof value==="string"?`현재 ${first?errorLabel(first):"항목"} 입력은 ${value}입니다. `:"";
    if(c.task.startsWith("axis-")){
      const condition=object(p.condition),goal=object(condition.goal),reference=object(condition.reference);
      const axis=String(goal.axis??object(p.task).axis??"x").toUpperCase();
      const delta=input[`delta${axis}`];
      if(first?.key==="distance"&&typeof reference.distance==="number"){
        const half=String(condition.relation).includes("half"),twice=String(condition.relation).includes("double");
        if(half||twice)return prefix+(wrongCount===3
          ?`앞서 ${half?"2로 나누는":"2를 곱하는"} 계산을 설명했어요. 이번에는 역산해 보세요. 현재 Δ${axis}=${delta??"미입력"}의 크기를 ${half?"두 배":"절반"}로 바꾸면 기준 이동 거리 ${reference.distance} mm로 돌아와야 합니다. 출발 좌표가 아니라 이동 거리로 확인하세요.`
          :`기준 이동 거리 ${reference.distance} mm, 조건에 따른 새 이동 거리, ${axis}축의 방향 부호를 세 칸으로 나눠 적어 보세요. 앞서 계산과 역산을 확인했으니 이번에는 내 Δ${axis}=${delta??"미입력"}가 그중 어느 값인지 설명해 주세요. 막히는 칸을 질문하면 그 부분부터 이어 설명할 수 있습니다.`);
      }
      if(first?.key==="axis")return prefix+`${axis}축을 기준으로 한 축씩 검산해 보세요. X·Y·Z 각각에 대해 ‘움직이는가 → 변화량을 쓰는가’를 적고 유지되는 축은 Δ=0으로 분리하세요. 앞 설명에서 헷갈리는 것은 로봇 기준축인가요, 화면의 시점인가요?`;
      if(first?.key==="sign")return prefix+"앞서 증가·감소의 부호를 설명했으니 이번에는 ‘출발 + 내 변화량 = 예상 도착’으로 검산하세요. 부호를 반대로 했을 때 목표에서 가까워지는지 멀어지는지 좌표값으로 비교해 보세요.";
    }
    return prefix+`${evidence}앞서 관계식을 설명했으니 이번에는 검산으로 확인하세요. ${c.task.startsWith("coordinate-")?"출발 좌표 A에 내 변화량 Δ를 더해 도착 좌표 B와 대조하고, 각 명령에서 원점과 출발점 중 어느 것을 기준으로 하는지 표시하세요.":"각 항의 기준점·단위를 적고 내 값을 관계식에 대입한 뒤 계산을 역순으로 확인하세요."} 아직 다른 항목은 ${errors}입니다. 어느 축이나 계산 항에서 막히는지 구체적으로 질문해 주세요.`;
  }
  if(c.task.startsWith("axis-")){
    const condition=object(p.condition),goal=object(condition.goal),reference=object(condition.reference);
    const task=object(p.task),id=String(task.id??p.id??"");
    const axis=String(goal.axis??task.axis??"x").toUpperCase();
    const keys=a.errors.map(e=>e.key);
    if(keys.includes("axis"))return prefix+`변하는 축과 그대로인 축을 다시 구분해 보세요. 조건은 ${axis}축 이동입니다. `+
      (detailed?`로봇의 기준축을 기준으로 ${axis}축의 변화량만 따로 쓰고, 움직이지 않는 나머지 축은 Δ=0으로 두세요. 카메라에서 보이는 방향과 좌표축은 다릅니다.`:"움직이지 않는 다른 축에도 변화량을 넣지는 않았나요?");
    if(keys.includes("sign"))return prefix+`이동 축을 찾았다면 증가·감소의 부호를 확인하세요. `+
      (detailed?"각 축의 Δ = 도착 좌표 − 출발 좌표입니다. 값이 감소하면 음수, 증가하면 양수이며 거리의 크기 자체와 부호는 다릅니다.":"같은 축이라도 +방향과 −방향은 서로 반대예요.");
    if(keys.includes("distance")){
      const half=String(condition.relation).includes("half"),twice=String(condition.relation).includes("double");
      if(half||twice){
        const distance=reference.distance;
        const operation=half?"절반으로 줄이는":"두 배로 늘리는";
        const expression=`${distance} ${half?"÷":"×"} 2`;
        return prefix+`방향은 맞아요. 이번 조건은 이동 거리를 ${operation} 것이에요. `+
          (detailed?`출발 좌표가 아니라 기준 이동 거리 ${distance} mm에 계산을 적용하세요. ${expression} = ${Number(distance)*(half?0.5:2)} mm이고, ${axis}축의 방향 부호를 붙이면 변화량이 됩니다. 나머지 축은 유지합니다.`
            :`${distance} mm의 ${half?"절반":"두 배"}은 얼마일까요?`);
      }
      return prefix+`축과 부호 다음에는 이동 거리의 크기를 확인하세요. `+
        (detailed?"거리 = |도착 좌표 − 출발 좌표|입니다. 입력값을 출발점에 더해 조건의 이동 거리와 대조하세요.":"입력한 값은 도착 좌표인가요, 이동한 거리인가요?");
    }
    return prefix+`이동 조건에서 바뀐 것은 축·방향·거리 중 무엇인가요? `+
      (detailed?"조건의 기준 이동과 새 이동을 나란히 놓고 축, 부호, 거리의 크기를 각각 비교하세요. 도착 좌표 자체가 절반이 된다는 뜻과 이동 거리가 절반이라는 뜻은 다릅니다.":"도착 좌표와 이동한 거리를 구분해 보세요.");
  }
  if(c.task.startsWith("coordinate-")){
    const first=a.errors[0];
    const axis=first?.key.match(/[xyz]$/i)?.[0]?.toUpperCase();
    const field=first?.key.startsWith("delta")?"변화량":first?.key.startsWith("absolute")?"절대좌표":"좌표·관계";
    return prefix+`${axis?axis+"축 ":""}${field}${typeof first?.value==="number"?` 입력 ${first.value}`:" 입력"}과 기준점을 다시 확인하세요. `+
      (detailed?`절대좌표는 원점 기준 도착 위치 B이고, 상대 변화량은 Δ = B − A입니다. 출발점 A에 내가 입력한 변화량을 더해 B가 되는지 확인하세요. 출발점이 C로 바뀌면 B − C를 다시 계산해야 합니다. 확인할 항목: ${errors}.`
        :"절대 명령에 이동량을 넣거나 상대 명령에 도착 위치를 그대로 넣지는 않았나요? 같은 시작점을 기준으로 비교해 보세요.");
  }
  const first=a.errors[0],key=first?.key??"";
  const fields=Array.isArray(root.fields)?root.fields.map(object):[];
  const field=fields.find(f=>f.key===key),label=String(field?.label??labels[key]??key);
  if(key==="command")return prefix+"선택한 이동 명령과 문제의 경로 조건을 비교하세요. "+
    (detailed?"MoveL은 TCP의 직선 경로를, MoveJ는 관절 이동을 기준으로 합니다. 문제에서 직선 경로를 요구하는지 먼저 확인하고 기존 수업의 정의와 연결해 보세요.":"도착 위치가 같아도 중간 이동 경로는 다를 수 있습니다.");
  if(/height|높이/.test(JSON.stringify(p))||/delta|target/i.test(key))
    return prefix+`${label}을 다시 확인하세요. `+(detailed
      ?"목표 위치는 도착할 좌표이고, 변화량은 ‘목표 − 현재’입니다. 출발 위치에 내 변화량을 더했을 때 목표 위치가 되는지 식으로 확인하세요. 증가·감소의 부호와 단위도 따로 확인하세요."
      :"입력값은 도착 위치인가요, 출발점에서 이동할 양인가요?");
  return prefix+`${label}에 기존 판정과 다른 값이 있습니다. `+(detailed
    ?`현재 조건과 입력을 식에 대입하여 계산 순서·단위·부호를 하나씩 확인하세요. 확인할 항목: ${errors}. 서술 근거는 이 수치 판정과 별도로 교사가 확인합니다.`
    :"조건의 단위·부호와 사용한 관계식을 한 항목씩 확인해 보세요.");
}
