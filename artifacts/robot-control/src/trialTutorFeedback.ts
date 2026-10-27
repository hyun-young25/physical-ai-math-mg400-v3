import { hasFeedbackExecution, privateText, type FeedbackContext } from "./learningAiContext";
import { tutorFollowUp } from "./tutorFollowUp";

const parse = (text:string):unknown => { try { return JSON.parse(text); } catch { return null; } };
const object = (v:unknown):Record<string,unknown> => v && typeof v==="object" && !Array.isArray(v) ? v as Record<string,unknown> : {};
const short = (v:unknown, limit=170) => privateText(typeof v==="string" ? v : JSON.stringify(v)??"없음").slice(0,limit);

/** Reads supplied evidence only. Never grades answers or invents measurements. */
export function trialTutorFeedback(c:FeedbackContext, result=false):string {
  if (c.task === "paper-coordinate") {
    const diagnosis=object(parse(c.judgment));
    const source=/"source"\s*:\s*"mock"/.test(c.execution)?"모의 브리지 · 실측 아님"
      :/"source"\s*:\s*"hardware"/.test(c.execution)?"제어기 보고 좌표 · 잉크 별도 확인":"DT 또는 실행 전 자료";
    return privateText(`${source}. ${diagnosis.candidate??"아직 진단할 실행 관측이 없습니다."}\n${diagnosis.why??"기준점·축·단위를 먼저 확인하세요."}\n${diagnosis.question??"종이의 원점과 로봇 원점은 같나요?"}\n기본 질문입니다. 수치 판정은 학습 화면의 규칙 계산을 따르며, 사고 원인을 확정하지 않습니다.`).slice(0,700);
  }
  const root=object(parse(c.condition));
  const condition=object(root.condition??root.problem??root);
  const answers=object(parse(c.answers));
  const fields=Array.isArray(root.fields)?root.fields.map(object):[];
  const judgment=parse(c.judgment);
  const judgments:Record<string,unknown>[]=Array.isArray(judgment)?judgment.map(object):[
    object(judgment),
    ...Object.entries(object(object(judgment).fieldStatuses)).map(([key,status])=>({
      key,status,label:fields.find(f=>f.key===key)?.label,
    })),
  ];
  const incorrect=judgments.filter(j=>j.matched===false||j.status==="incorrect");
  const correct=incorrect.length===0&&judgments.some(j=>j.matched===true||j.status==="correct");
  const question=c.question?.trim()??"";
  const rawJudgedFields=object(judgment).fields;
  const judgedFields:Record<string,unknown>[]=Array.isArray(rawJudgedFields)?rawJudgedFields.map(object):[];
  const valueKeys=[...new Set([...Object.keys(answers),...fields.map(field=>String(field.key??"")).filter(Boolean),
    ...judgedFields.map(field=>typeof field.key==="string"?field.key:"").filter(Boolean)])];
  const values=valueKeys.map(key=>{
    const field=fields.find(f=>f.key===key);
    const judgedValue=judgedFields.find(item=>item.key===key)?.value;
    const value=answers[key];
    const entered=value!==undefined&&value!==null&&String(value).trim()!==""?value:judgedValue;
    return `${field?.label??key}=${entered===undefined||entered===null||String(entered).trim()===""?"미입력":short(entered,32)}${field?.unit??""}`;
  }).join(", ");
  const current=`현재 입력: ${values||"아직 없음"}. `;
  const phase=incorrect.length ? `기존 판정: 오답${incorrect.some(j=>j.label||j.key)?`(${incorrect.map(j=>short(j.label??j.key,35)).join(", ")})`:""}. `
    :correct?"기존 판정: 확인된 항목 정답. ":"현재 입력의 정오 미확정입니다. ";
  const wrap=(text:string)=>privateText(text).slice(0,700);
  if(result||/예상.*결과|예측.*결과|측정|실행.*비교|실행.*결과/.test(question)) {
    if(!hasFeedbackExecution(c.execution))return wrap(`${current}아직 확보된 실행 결과가 없습니다. 먼저 이 과제의 기존 판정·실행 절차를 이용하세요. 대화로 장비를 움직이지 않습니다.`);
    const raw=parse(c.execution);
    const execution=object(raw);
    const runs=Array.isArray(raw)?raw.map(object):Array.isArray(execution.results)?execution.results.map(object):[object(execution.results??raw)];
    const last=runs.at(-1)??{};
    const sources=[/"source"\s*:\s*"(virtual|dt)"/.test(c.execution)?"가상":null,
      /"source"\s*:\s*"(mock|test)"/.test(c.execution)?"시험용":null,
      /"source"\s*:\s*"hardware"/.test(c.execution)?"실장비 경로(실측 완료 별도 확인)":null].filter(Boolean);
    const state=/unavailable|blocked|차단|미연결|불일치/.test(c.execution)?"차단·미완료":
      /stopped|cancel|취소|중단/.test(c.execution)?"취소·중단":/running/.test(JSON.stringify(last))?"진행 중":
      /completed/.test(JSON.stringify(last))?"완료로 기록":"완료 여부 미확정";
    const detail=object(last.details??last.detail??last);
    const motion=object(detail.motion??detail);
    const measurement=object(Array.isArray(motion.measurements)?motion.measurements.at(-1):null);
    const evidence=motion.before||motion.after?`전 위치 ${short(motion.before,75)}, 후 위치 ${short(motion.after,75)}`:
      last.summary?short(last.summary,130):short(last,130);
    return wrap(`출처: ${sources.join("·")||"수학 계산/출처 확인 필요"} · ${state}. 최초 예측: ${short(c.initialPrediction,120)}. ${current}확보된 자료: ${evidence}${measurement.coordinateSystem?` (${short(measurement.coordinateSystem,35)})`:""}. 같은 좌표계·단위로 비교하세요. 차단·오래된 값은 이동 성공이나 수학 오답의 근거가 아니며 위치만으로 집기 성공은 알 수 없습니다.`);
  }
  const answer=tutorFollowUp(c);
  if(answer)return wrap(answer);
  if(question&&!/힌트|틀|오답|왜|높이|목표|이동량|변화|좌표|단위|부호|관계식|계산식|수식|근거|풀이|다음|단계|더|설명|벡터|거리|각도|삼각|링크|정답/.test(question))
    return wrap("체험 모드는 현재 과제의 입력·기존 판정·실행 자료에 대한 기본 도움만 제공합니다. ‘힌트만 주세요’, ‘왜 틀렸나요?’, ‘예상과 실제 결과 비교’ 또는 기준점·단위·풀이에 관해 질문해 주세요. 범위 밖 질문의 답은 만들어 내지 않습니다.");
  if(/왜.*틀|오답/.test(question)&&!incorrect.length)
    return wrap(`${current}${phase}전달된 오답 판정이 없습니다. 입력을 바꿨다면 기존 답 확인으로 다시 판정을 받으세요.`);
  if(correct)return wrap(`${current}${phase}최초 예측과 현재 풀이를 보존한 채 다음 단계를 확인하세요. 가상 이동을 지원하는 과제라면 기존 실행 버튼과 확인 절차를 이용한 후 결과 비교를 요청하세요. 채팅은 정답 판정이나 장비 제어를 하지 않습니다.`);
  const reasoning=object(condition.reasoning);
  const height=/height/.test(String(condition.id??""))||reasoning.kind==="difference";
  let hint:string;
  if(c.task.startsWith("axis-")) {
    const prompt=typeof condition.prompt==="string"?`현재 2-1 문항 조건: ${short(condition.prompt,130)}. `:"현재 2-1 좌표축 문항입니다. ";
    hint=c.support==="challenge"
      ? `${prompt}화면에서 보이는 방향 대신 로봇 기준축을 기준으로, 변하는 축과 유지되는 축을 어떻게 구분했나요? 입력한 부호·이동량의 근거를 설명해 보세요.`
      : `${prompt}시작점 A를 기준으로 움직이는 축과 그대로인 축부터 나누세요. ΔX·ΔY·ΔZ는 각 축의 ‘도착 위치 − 출발 위치’입니다. 방향과 거리가 바뀐 조건을 내 입력값과 하나씩 연결해 보세요.`;
  } else if(height) {
    const start=reasoning.start, target=reasoning.target;
    const known=typeof start==="number"&&typeof target==="number"?`출발 높이 ${start}mm와 목표 높이 ${target}mm`:"출발 높이와 목표 높이";
    const focus=incorrect[0]?.key??Object.keys(answers).find(k=>answers[k]!=="" && answers[k]!=null);
    hint=c.support==="challenge"?`${known}는 각각 무엇을 뜻하나요? ${focus??"입력값"}은 도착 위치인가요, 상대 변화량인가요?`
      :focus==="command"?"수직으로 곧게 이동하는 경로와 관절별로 움직이는 경로를 구분하세요. 기존 수업의 MoveL/MoveJ 정의 중 어느 경로가 조건에 맞나요?"
      :focus==="targetZ"?`${known}를 구분하세요. 목표 절대좌표는 도착할 위치이며 출발 위치나 변화량이 아닙니다.`
      :`${known}를 먼저 구분하세요. 변화량은 ‘목표 위치 − 현재 위치’이며, 움직이지 않는 축의 변화량과 부호도 확인하세요.`;
  } else {
    const prompt=typeof condition.prompt==="string"?`문제 조건: ${short(condition.prompt,120)}. `:"";
    hint=c.support==="challenge"?`${prompt}입력값의 기준점·좌표계·단위·부호를 어떤 관계식으로 확인할 수 있나요?`
      :`${prompt}① 주어진 값과 구할 값을 구분하세요. ② 현재 항목 ${short(incorrect[0]?.label??incorrect[0]?.key??fields[0]?.label??"입력값",60)}의 단위와 관계식을 확인하세요. ③ 풀이를 한 단계씩 대조하세요.`;
  }
  const follow=(c.conversation?.length??0)>0 ? (c.support==="challenge"?"앞 힌트에서 정한 기준을 이번 입력에도 적용할 수 있나요? ":"추가 확인: 식의 각 항에 현재 입력이 무엇을 의미하는지 대입해 설명해 보세요. "):"";
  return wrap(`${current}${phase}${c.support==="challenge"?"도전 모드":"지원 모드"} · 시도 ${c.attempts}회. ${hint} ${!c.reason.trim()?"어떤 식이나 기준을 썼는지 근거를 한 줄 적어 주세요. ":c.attempts>1?"앞 시도와 달라진 값·근거를 따로 확인하세요. ":""}${follow}`);
}
