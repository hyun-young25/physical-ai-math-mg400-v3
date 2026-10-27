type ComparedField={key:string;label:string;prediction:string;result:number|string;matched:boolean};
type Guidance={question:string;hint:string};
const guides:Record<string,Record<string,Guidance>>={
  foundation:{
    delta:{question:"도착 높이와 올라간 양을 구분했나요? 출발 높이를 먼저 짚어 보세요.",hint:"상승량 ΔZ=목표 Z−출발 Z입니다. 출발점이 바뀌면 같은 목표까지 필요한 변화량도 바뀝니다."},
    distance:{question:"X 이동량과 Y 이동량을 그냥 더했나요? 직선 경로와 꺾인 경로를 구분하세요.",hint:"직선거리=√(ΔX²+ΔY²)입니다. 부호가 있는 변화량을 제곱하므로 거리의 크기는 음수가 아닙니다."},
    horizontal:{question:"수평에서 잰 각도에서 가로 성분은 sin과 cos 중 무엇을 쓰나요?",hint:"수평 성분은 Lcosθ입니다. 높이 성분 Lsinθ와 구분하고, 두 성분의 제곱합이 L²인지 확인하세요."},
    vertical:{question:"링크 전체 길이와 그 링크가 만든 높이를 구분하세요.",hint:"높이 성분은 Lsinθ입니다. 링크가 더 수직에 가까워질 때 수평 성분과 높이 성분의 변화를 함께 생각하세요."},
  },
  motion:{
    method:{question:"이번 작업은 도착점만 맞으면 되나요, 중간의 직선 경로까지 보장해야 하나요?",hint:"직선 작업에는 TCP 직선을 보간하는 MoveL을 선택합니다. 끝점만 요구할 때는 두 방식 모두 가능합니다. MoveJ가 특정 배치에서 직선처럼 보여도 항상 직선을 보장하지는 않습니다."},
    end:{question:"같은 A에서 시작해 같은 B를 명령했나요? 도착점과 중간 경로를 나누어 판단하세요.",hint:"MoveJ와 MoveL은 보간 대상이 다릅니다. 도달 가능한 같은 A·B를 사용했다면 끝점이 같은지부터 비교하고, 중간 경로는 따로 확인합니다."},
    path:{question:"A·B가 같다는 사실만으로 중간 TCP 경로도 같다고 할 수 있나요? 두 선과 직선 이탈 거리를 함께 보세요.",hint:"MoveJ는 관절각을, MoveL은 TCP 위치를 보간합니다. 특정 배치에서는 경로가 겹칠 수도 있으므로 이번 계산 궤적으로 판단하세요."},
  },
  fk:{
    reach:{question:"바뀐 각도가 어느 링크의 수평 성분에 영향을 주나요? 기준 자세의 ρ와 새 ρ를 비교하세요.",hint:"ρ=L₁cosθ₂+L₂cos(θ₂+θ₃)입니다. θ₂가 바뀌면 두 항을, θ₃이 바뀌면 두 번째 항을 다시 계산합니다. θ₄는 수평 성분 합 ρ에 영향을 주지 않습니다."},
    height:{question:"각도를 키웠다는 이유만으로 높이가 늘어난다고 판단했나요? 두 링크의 sin 성분 합을 비교하세요.",hint:"Z의 변화는 L₁sinθ₂+L₂sin(θ₂+θ₃)의 변화로 정해집니다. 같은 표시 오프셋은 두 자세의 차이를 구하면 없어집니다."},
    x:{question:"팔의 수평 성분 합 ρ와 베이스 회전을 나누어 계산했나요? 마지막에 표시 원점 오프셋을 더했나요?",hint:"ρ=L₁cosθ₂+L₂cos(θ₂+θ₃), X=ρcosθ₁+offsetₓ입니다. θ₃은 상대 팔꿈치각이며 삼각함수 입력 단위는 도(°)입니다."},
    y:{question:"베이스 회전으로 생긴 Y 성분의 크기와 부호를 확인하세요.",hint:"Y=ρsinθ₁, ρ=L₁cosθ₂+L₂cos(θ₂+θ₃)입니다. θ₁의 부호와 sinθ₁의 부호를 연결해 보세요."},
    z:{question:"두 링크의 높이 성분과 표시 높이의 기준을 함께 반영했나요?",hint:"Z=L₁sinθ₂+L₂sin(θ₂+θ₃)+offset𝓏입니다. θ₃을 두 번째 링크의 절대각으로 사용하지 않습니다."},
    r:{question:"TCP 위치를 정하는 관절과 흡착기 방향을 정하는 관절을 구분하세요.",hint:"이 DT 모델은 R=θ₄입니다. θ₄만 바꾸면 X·Y·Z는 유지되고 방향만 바뀝니다."},
  },
  ik:{
    reachable:{question:"목표에 모델 해가 있는지, 실제로 안전하게 이동할 수 있는지를 구분했나요?",hint:"목표를 현재 링크 모델의 도달 범위와 비교하세요. IK 해가 있어도 충돌이나 실장비 관절 제한이 검증된 것은 아닙니다."},
    restored:{question:"해가 있을 때만 IK 각도를 FK에 다시 넣을 수 있습니다. 복원 좌표와 목표의 잔차를 보세요.",hint:"IK→FK 잔차는 같은 모델 안에서의 계산 확인입니다. 해가 없으면 복원 결과도 없으며, 잔차가 작아도 물리 측정의 정확도가 입증되지는 않습니다."},
  },
  triangle:{
    distance:{question:"한 축의 변화량만 거리로 사용했나요? P1과 P2의 각 좌표 차이를 먼저 구하세요.",hint:"직선거리=√(ΔX²+ΔY²+ΔZ²)입니다. 거리의 크기는 음수가 아니며 경로 전체의 길이와 구분합니다."},
    returnY:{question:"복귀할 때의 출발점은 P3입니다. P1의 Y에서 어느 값을 빼야 하나요?",hint:"P3→P1의 ΔY=Y(P1)−Y(P3)입니다. 도착 좌표 자체가 아니라 두 위치의 차이입니다."},
  },
  circle:{
    radius:{question:"원점에서 P1까지가 아니라 주어진 중심 O에서 P1까지의 거리를 구했나요?",hint:"반지름=√((X₁−Xₒ)²+(Y₁−Yₒ)²)입니다. 중심을 옮기면 위치는 바뀌어도 같은 원의 반지름은 유지됩니다."},
    p2x:{question:"P2는 중심에서 X 방향으로 얼마나 떨어져 있나요? 중심의 X도 반영하세요.",hint:"그림의 P2가 중심의 +X 쪽에 있으면 X(P2)=X(O)+반지름입니다. 위치와 중심에서의 변화량을 구분하세요."},
  },
  "pick-place":{
    lift:{question:"목표 높이와 상승량을 구분하세요. 흡착 직후 높이에서 얼마를 더해야 하나요?",hint:"상승 ΔZ=운반 높이−흡착 높이입니다. 출발 높이가 달라지면 같은 목표까지 필요한 상승량도 달라집니다."},
    carry:{question:"운반 직전과 내려놓을 곳의 Y를 비교하세요. 이동 방향은 어느 쪽인가요?",hint:"운반 ΔY=도착 Y−출발 Y입니다. 이동 거리의 크기와 부호가 있는 변화량을 구분하세요."},
  },
};
export function inquiryGuidance(task:string,field:ComparedField):Guidance {
  const guide=guides[task]?.[field.key]??{question:`${field.label}의 기준과 실행 결과를 다시 비교하세요.`,hint:"출발 조건과 입력한 명령을 확인하고, 위치·변화량·단위를 구분해 다시 계산하세요."};
  const opposite=typeof field.result==="number"&&Math.abs(field.result)>0.1&&Number.isFinite(Number(field.prediction))&&Math.abs(Number(field.prediction)+field.result)<=0.1;
  return opposite?{...guide,question:`크기는 같고 부호가 반대입니다. 증가·감소 방향을 확인하세요. ${guide.question}`}:guide;
}
