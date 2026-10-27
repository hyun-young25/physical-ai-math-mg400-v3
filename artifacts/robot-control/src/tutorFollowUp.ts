import type { FeedbackContext } from "./learningAiContext";
const row=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const parse=(s:string)=>{try{return row(JSON.parse(s));}catch{return {};}};

/** Concept explanations only: no new verdicts, execution claims or commands. */
export function tutorFollowUp(c:FeedbackContext):string|null {
  const q=c.question?.trim()??"";
  if(!q)return null;
  const root=parse(c.condition),problem=row(root.problem??root.condition??root);
  const condition=row(problem.condition??problem);
  const prior=c.conversation?.filter(t=>t.role==="tutor")??[];
  const last=prior.at(-1)?.text??"";
  const more=/한 단계|한단계|자세|방금|앞.*설명|앞.*힌트|더.*설명|설명.*더|다음.*단계|힌트만|다른.*힌트|다시.*설명/.test(q);
  const half=/half|절반/.test(JSON.stringify(condition));
  const division=/왜.*(2|둘|반|나누)|나누.*이유|절반.*(왜|뜻)/.test(q);
  const followHalf=more&&!/역산|내 입력에 적용|덧셈으로 검산/.test(last)&&/절반|÷|나누|두 부분/.test(last);
  if(more&&prior.length&&c.support==="challenge")
    return "도전 모드 · 앞서 사용한 기준을 이번 입력에 적용해 보세요. 내 변화량을 출발 좌표에 더하면 어떤 도착 위치가 되나요? 문제의 조건과 비교해 차이가 나는 축을 설명해 보세요.";
  if(division||followHalf){
    if(followHalf||prior.some(t=>/두 부분으로/.test(t.text))){
      return "앞서 전체를 두 부분으로 나누는 이유를 설명했어요. 이번에는 역산해 보세요. 내가 정한 한 부분의 이동 거리를 두 배 했을 때 기준 이동 거리로 돌아와야 합니다. 출발 좌표를 나누는 것이 아니라, 입력한 변화량의 크기로 이 관계를 확인하세요.";
    }
    return `${half?"현재 조건의 ‘절반’":"‘절반’이라는 조건"}은 전체 이동 거리를 같은 크기의 두 부분으로 나눈 것 중 한 부분입니다. 그래서 기준 이동 거리를 2로 나눕니다. 출발 좌표나 도착 좌표 자체를 2로 나누는 것이 아니며, 방향의 부호는 별도로 유지합니다.`;
  }
  if(/절대|상대|기준점|목표.*변화|위치.*변화|도착.*변화|좌표.*차이/.test(q)){
    return "절대좌표 B는 원점에서 본 도착 위치이고, 상대 변화량 Δ는 출발점 A에서 얼마만큼 변하는지입니다. 같은 이동이라면 Δ = B − A, 반대로 A + Δ = B입니다. 출발점을 C로 바꾸면 같은 B에 가기 위한 변화량은 B − C가 되지만, 절대 도착 위치 B 자체는 유지됩니다.";
  }
  if(/부호|음수|양수|증가|감소/.test(q)){
    return "부호는 로봇 기준축에서 좌표가 증가하는지 감소하는지를 나타냅니다. Δ = 도착 좌표 − 출발 좌표이므로 증가하면 양수, 감소하면 음수입니다. 거리의 크기는 |Δ|이고, 카메라에서 보이는 좌우와 로봇의 +축 방향은 다를 수 있습니다.";
  }
  if(/MoveJ|MoveL|직선.*관절|명령.*차이/i.test(q)){
    return "MoveL은 TCP의 직선 경로를 기준으로 하고 MoveJ는 관절 이동을 기준으로 합니다. 도착 위치가 같아도 중간 경로는 다를 수 있어요. 현재 문제의 경로 조건을 먼저 확인하세요. 이 설명이나 채팅 전송으로 로봇을 실행하지 않습니다.";
  }
  if(/어느.*축|어떤.*축|축.*구분|기준축/.test(q)){
    return "로봇 기준의 X·Y·Z축을 기준으로 출발 좌표와 도착 좌표를 한 축씩 비교하세요. 값이 바뀌는 축에만 변화량이 있고, 유지되는 축은 Δ=0입니다. 화면의 시점이 바뀌어도 로봇 기준축 자체가 바뀌지는 않습니다.";
  }
  if(more&&last){
    if(/역산|두 배 했/.test(last))
      return "이제 식을 내 입력에 적용하는 단계입니다. ‘출발 좌표 + 내가 입력한 변화량 = 예상 도착 좌표’를 축별로 적어 보세요. 현재 문제의 목표와 같은 기준점·단위로 대조하고, 계산식에서 막힌 항이나 축을 알려 주면 그 부분부터 설명할 수 있습니다.";
    if(/Δ|변화량|B − A|목표.*현재/.test(last))
      return "앞서 변화량을 빼기로 구했다면, 이번에는 덧셈으로 검산하세요. 각 축에서 출발 좌표에 내 변화량을 더한 값이 예상 도착 좌표입니다. 움직이지 않는 축도 따로 확인하고, 어느 축의 어떤 항이 헷갈리는지 질문해 주세요.";
    return "앞 안내를 현재 입력에 적용해 한 항목씩 확인해 보겠습니다. 먼저 문제에서 주어진 값, 내 입력값, 구할 값을 구분한 뒤 각 항에 같은 단위와 기준점을 표시하세요. 그중 어떤 값이나 식을 연결하기 어려운지 알려 주세요.";
  }
  return null;
}
