import { foundationAnswerMatches, foundationHint, hasFoundationMotion, type FoundationMove } from "./foundationMotion";
import { foundationMotion } from "./foundationMotion";
import { TaskStartPoint, moveVirtualTaskStart } from "./TaskStartPoint";
import type { MotionProps } from "./LessonPages";
import type { ReasoningSpec } from "./explanationFeedback";
import { LessonConceptHeader } from "./LessonConceptHeader";import { useEffect, useRef, useState } from "react";
import { MathInquiryPanel, useMathInquiry, type InquiryField } from "./MathInquiry";
import { FoundationMovePanel } from "./FoundationMovePanel";
import { recordLearningAction } from "./learningSync";

type FoundationTask = {
  id: string;
  concept: string;
  independent: boolean;
  title: string;
  prompt: string;
  formula: string;
  fields: InquiryField[];
  expected: Record<string, number | string>;
  reason: string;
  reasoning: ReasoningSpec;
};

const COURSE_WEEKS = [
  { label:"1주차", title:"과제 이해 · 위치와 변화량", short:"위치·변화량", detail:"절대좌표와 상대 변화량" },
  { label:"2주차", title:"변화 벡터 · 거리", short:"벡터·거리", detail:"Δp와 직선 경로" },
  { label:"3주차", title:"삼각비 · 링크 성분", short:"삼각비·링크", detail:"cos·sin으로 X/Z 분해" },
  { label:"4주차", title:"2링크 TCP", short:"2링크 TCP", detail:"성분 합과 순기구학" },
] as const;

const COURSE_TASK_STARTS = [0, 2, 6, 8];

const HEIGHT_HINTS = [
  { title:"1단계 · 목표 절대좌표 입력", body:"위의 현재 Z와 목표 Z를 읽고, 도착할 절대좌표를 입력하세요." },
  { title:"2단계 · 변화 벡터 계산", body:"수직으로만 이동할 때 어떤 축이 변하고 어떤 축이 유지되는지 판단하세요. ΔZ는 목표와 현재의 차이입니다." },
  { title:"3단계 · 이동 명령 선택", body:"물체를 수직 직선으로 올리는 상황에 맞는 이동 명령을 선택하세요." },
  { title:"4단계 · 근거 작성", body:"목표 좌표·변화 벡터·이동 경로를 연결해 선택 이유를 한 문장으로 설명하세요." },
  { title:"5단계 · 예측 저장", body:"입력한 수치와 명령, 근거를 최종 확인한 뒤 저장하세요." },
] as const;

const TRANSFER_HINTS = [
  { title:"1단계 · 달라진 조건 확인", body:"앞 문제의 20→60과 비교해 이번 조건의 출발 높이만 달라졌음을 확인하세요." },
  { title:"2단계 · 상대 변화량 설명", body:"목표 절대좌표 Z=60은 같지만 출발 높이가 달라져 ΔZ가 달라지는 이유를 한 문장으로 설명하세요." },
  { title:"3단계 · 예측 저장", body:"ΔZ=15 mm와 근거를 최종 확인한 뒤 저장하세요." },
] as const;

function courseWeekIndexForTask(index:number) {
  return index < 2 ? 0 : index < 6 ? 1 : index < 8 ? 2 : 3;
}

function taskStageGuide(task:FoundationTask, step:number) {
  const guides = [
    ["첫 계산값 입력","문항의 첫 번째 항목만 계산해 입력하세요. 값에 대한 근거는 다음 단계에서 작성합니다."],
    ["관계식 적용","앞에서 입력한 값과 다음 항목을 연결해 계산하세요. 막히면 관계 힌트를 여세요."],
    ["전체 예측 점검","모든 수치·선택 항목을 완성한 뒤, 조건과 답이 서로 맞는지 점검하세요."],
    ["근거 작성","답에 사용한 식이나 조건, 그리고 로봇 이동 의미를 한 문장으로 설명하세요."],
    ["예측 저장","수치·명령·근거를 확인하고 저장한 뒤 수학적 확인 단계로 이동하세요."],
  ] as const;
  const guide=guides[Math.max(0,Math.min(guides.length-1,step))];
  return { title:`${step+1}단계 · ${guide[0]}`, body:guide[1], taskTitle:task.title };
}

const TASKS: FoundationTask[] = [
  {
    id: "height-practice",
    reasoning: { kind: "difference", start: 20, target: 60, key: "deltaZ" },
    concept: "위치와 변화량",
    independent: false,
    title: "높이를 맞추고 이동 명령을 선택하세요",
    prompt:
      "물체 윗면의 현재 위치는 Z=20 mm입니다. 물체를 잡은 뒤 X·Y 위치와 방향은 그대로 유지하고, 목표 높이 Z=60 mm까지 수직으로 들어 올립니다. ① 목표 절대좌표 Z ② 좌표 변화 벡터(ΔX, ΔY, ΔZ) ③ 적절한 이동 명령(MoveL/MoveJ)을 판단하세요. 변화가 없는 축의 변화량도 0으로 기록하세요.",
    formula:
      "절대 위치 Z_target와 상대 변화량 ΔZ=Z_target−Z_current를 구분하고, 이동 경로에 맞는 명령을 선택합니다.",
    fields: [
      { key: "targetZ", label: "① 목표 절대좌표 Z", unit: "mm" },
      { key: "deltaX", label: "② X축 변화량 ΔX", unit: "mm" },
      { key: "deltaY", label: "③ Y축 변화량 ΔY", unit: "mm" },
      { key: "deltaZ", label: "④ Z축 변화량 ΔZ", unit: "mm" },
      {
        key: "command",
        label: "⑤ 이동 명령",
        options: [
          { value: "MoveL", label: "MoveL — 직선 이동" },
          { value: "MoveJ", label: "MoveJ — 관절 이동" },
        ],
      },
    ],
    expected: { targetZ: 60, deltaX: 0, deltaY: 0, deltaZ: 40, command: "MoveL" },
    reason:
      "왜 절대 목표좌표 Z=60과 변화 벡터 (ΔX,ΔY,ΔZ)=(0,0,+40)을 구분해야 하는지, 그리고 수직 직선 이동에서 MoveL을 선택한 이유를 설명하세요.",
  },
  {
    id: "height-transfer",
    reasoning: { kind: "difference", start: 45, target: 60, key: "delta" },
    concept: "위치와 변화량",
    independent: true,
    title: "목표는 같고 출발 높이만 달라졌습니다",
    prompt:
      "앞 문제(현재 Z=20 mm, 목표 Z=60 mm)와 비교해 이번 조건(현재 Z=45 mm, 목표 Z=60 mm)에서 달라진 값이 무엇인지 확인하고, 필요한 ΔZ를 구하세요.",
    formula:
      "상대 변화량 ΔZ=Z_target−Z_current입니다. 목표 Z=60 mm가 같아도 출발 위치가 달라지면 필요한 상승량이 달라집니다.",
    fields: [{ key: "delta", label: "상승량 ΔZ", unit: "mm" }],
    expected: { delta: 15 },
    reason: "목표 절대좌표는 같아도 출발 위치가 달라지면 상대 변화량 ΔZ가 달라지는 이유를 설명하세요.",
  },
  {
    id: "vector-practice",
    reasoning: { kind: "distance", delta: [30, 30, 40], key: "distance" },
    concept: "다축 변화량과 이동 경로",
    independent: false,
    title: "세 축의 변화량과 직선거리를 함께 판단하세요",
    prompt:
      "현재 위치는 (X,Y,Z)=(320,40,20) mm이고 목표 위치는 (350,70,60) mm입니다. 각 축의 변화량을 구한 뒤, 두 점 사이 3차원 직선거리와 이동 명령을 판단하세요.",
    formula:
      "Δp=(ΔX,ΔY,ΔZ)이고, 3차원 직선거리 d=√[(ΔX)²+(ΔY)²+(ΔZ)²]입니다. 여러 축이 동시에 변해도 직선 경로라면 MoveL을 검토합니다.",
    fields: [
      { key: "deltaX", label: "① X축 변화량 ΔX", unit: "mm" },
      { key: "deltaY", label: "② Y축 변화량 ΔY", unit: "mm" },
      { key: "deltaZ", label: "③ Z축 변화량 ΔZ", unit: "mm" },
      { key: "distance", label: "④ 두 점 사이 3차원 직선거리", unit: "mm" },
      {
        key: "command",
        label: "⑤ 이동 명령",
        options: [
          { value: "MoveL", label: "MoveL — 직선 이동" },
          { value: "MoveJ", label: "MoveJ — 관절 이동" },
        ],
      },
    ],
    expected: { deltaX: 30, deltaY: 30, deltaZ: 40, distance: 58.3, command: "MoveL" },
    reason:
      "세 축의 변화량을 하나의 벡터로 표현하고, 직선거리와 이동 명령을 연결해 설명하세요.",
  },
  {
    id: "vector-transfer",
    reasoning: { kind: "distance", delta: [-30, 40, -25], key: "distance" },
    concept: "다축 변화량과 이동 경로",
    independent: true,
    title: "방향이 섞인 새 좌표로 전이하세요",
    prompt:
      "현재 위치는 (350,70,60) mm이고 목표 위치는 (320,110,35) mm입니다. ΔX·ΔY·ΔZ의 부호를 포함해 변화 벡터와 직선거리를 구하세요.",
    formula:
      "Δp=(ΔX,ΔY,ΔZ)=(목표 좌표−현재 좌표)이며, 직선거리 d=√[(ΔX)²+(ΔY)²+(ΔZ)²]입니다. 부호는 방향을, 거리는 크기를 나타냅니다.",
    fields: [
      { key: "deltaX", label: "X축 변화량 ΔX", unit: "mm" },
      { key: "deltaY", label: "Y축 변화량 ΔY", unit: "mm" },
      { key: "deltaZ", label: "Z축 변화량 ΔZ", unit: "mm" },
      { key: "distance", label: "두 점 사이 3차원 직선거리", unit: "mm" },
    ],
    expected: { deltaX: -30, deltaY: 40, deltaZ: -25, distance: 55.9 },
    reason: "음의 변화량은 반대 방향 이동을 뜻하지만 직선거리는 왜 양수인지 설명하세요.",
  },
  {
    id: "distance-practice",
    reasoning: { kind: "distance", delta: [30, 40, 0], key: "distance" },
    concept: "좌표 차이와 직선거리",
    independent: false,
    title: "두 방향으로 떨어진 곳까지의 거리는?",
    prompt:
      "물체를 X 방향 30 mm, Y 방향 40 mm 옮깁니다. Z는 같습니다. 두 점 사이 직선거리를 구하세요.",
    formula:
      "직선거리 = √(ΔX² + ΔY²). X로 간 뒤 Y로 가는 꺾인 경로의 길이와 구분합니다.",
    fields: [{ key: "distance", label: "두 점 사이 직선거리", unit: "mm" }],
    expected: { distance: 50 },
    reason: "30+40과 직선거리가 다른 이유를 이동 경로와 연결해 설명하세요.",
  },
  {
    id: "distance-transfer",
    reasoning: { kind: "distance", delta: [-60, 80, 0], key: "distance" },
    concept: "좌표 차이와 직선거리",
    independent: true,
    title: "방향 부호가 달라도 거리의 크기는?",
    prompt:
      "ΔX=−60 mm, ΔY=80 mm, ΔZ=0 mm입니다. 두 점 사이 직선거리를 구하세요.",
    formula:
      "직선거리 d=√[(ΔX)²+(ΔY)²+(ΔZ)²]이며, ΔX가 음수여도 거리는 변화 벡터의 크기이므로 양수입니다.",
    fields: [{ key: "distance", label: "두 점 사이 직선거리", unit: "mm" }],
    expected: { distance: 100 },
    reason: "ΔX가 음수여도 거리가 음수가 되지 않는 이유를 설명하세요.",
  },
  {
    id: "projection-practice",
    reasoning: {
      kind: "projection",
      length: 100,
      angle: 30,
      horizontal: "horizontal",
      vertical: "vertical",
    },
    concept: "링크 길이의 수평·높이 성분",
    independent: false,
    title: "기울어진 링크가 만드는 높이",
    prompt:
      "길이 100 mm인 링크가 수평에서 30° 기울어져 있습니다. cos30°≈0.866, sin30°=0.5를 사용하세요.",
    formula:
      "수평 성분 = 길이 × cosθ, 높이 성분 = 길이 × sinθ. 다음 운동학에서는 두 링크의 성분을 더합니다.",
    fields: [
      { key: "horizontal", label: "링크의 수평 성분", unit: "mm" },
      { key: "vertical", label: "링크의 높이 성분", unit: "mm" },
    ],
    expected: { horizontal: 86.6, vertical: 50 },
    reason:
      "링크 길이 100 mm가 그대로인데 두 성분이 100 mm보다 작은 이유를 설명하세요.",
  },
  {
    id: "projection-transfer",
    reasoning: {
      kind: "projection",
      length: 100,
      angle: 60,
      horizontal: "horizontal",
      vertical: "vertical",
    },
    concept: "링크 길이의 수평·높이 성분",
    independent: true,
    title: "같은 링크를 더 세우면?",
    prompt:
      "같은 100 mm 링크를 60°로 세웠습니다. cos60°=0.5, sin60°≈0.866입니다. 두 성분을 구하세요.",
    formula:
      "수평 성분=Lcosθ, 높이 성분=Lsinθ입니다. 각도가 커질 때 두 성분이 어떻게 달라지는지 비교합니다.",
    fields: [
      { key: "horizontal", label: "링크의 수평 성분", unit: "mm" },
      { key: "vertical", label: "링크의 높이 성분", unit: "mm" },
    ],
    expected: { horizontal: 50, vertical: 86.6 },
    reason: "30°일 때와 비교해 수평 성분과 높이 성분이 각각 어떻게 달라졌나요?",
  },
  {
    id: "two-link-practice",
    reasoning: {
      kind: "projection",
      length: 175,
      angle: 30,
      horizontal: "link1X",
      vertical: "link1Z",
    },
    concept: "2링크 TCP 좌표",
    independent: false,
    title: "두 링크의 성분을 더해 TCP 위치를 구하세요",
    prompt:
      "L₁=175 mm, θ₁=30°, L₂=125 mm, θ₂=20°입니다. 먼저 L₂의 절대각 θ₁+θ₂를 구하고, 두 링크의 X·Z 성분과 TCP 좌표를 계산하세요.",
    formula:
      "L₁=(L₁cosθ₁,L₁sinθ₁), L₂=(L₂cos(θ₁+θ₂),L₂sin(θ₁+θ₂))이며 TCP 좌표는 두 성분의 합입니다.",
    fields: [
      { key: "link1X", label: "① L₁의 X 성분", unit: "mm" },
      { key: "link1Z", label: "② L₁의 Z 성분", unit: "mm" },
      { key: "link2X", label: "③ L₂의 X 성분", unit: "mm" },
      { key: "link2Z", label: "④ L₂의 Z 성분", unit: "mm" },
      { key: "tcpX", label: "⑤ TCP X 좌표", unit: "mm" },
      { key: "tcpZ", label: "⑥ TCP Z 좌표", unit: "mm" },
    ],
    expected: { link1X: 151.6, link1Z: 87.5, link2X: 80.4, link2Z: 95.7, tcpX: 231.9, tcpZ: 183.2 },
    reason: "두 번째 링크에 θ₂가 아니라 θ₁+θ₂를 사용하는 이유와 TCP 좌표가 성분의 합인 이유를 설명하세요.",
  },
  {
    id: "two-link-transfer",
    reasoning: {
      kind: "projection",
      length: 175,
      angle: 45,
      horizontal: "link1X",
      vertical: "link1Z",
    },
    concept: "2링크 TCP 좌표",
    independent: true,
    title: "관절각이 달라진 2링크 조건에 적용하세요",
    prompt:
      "L₁=175 mm, θ₁=45°, L₂=125 mm, θ₂=−15°입니다. 두 링크의 절대각을 구분하여 TCP 좌표를 다시 계산하세요.",
    formula:
      "L₂의 절대각은 θ₁+θ₂이며, 두 링크의 X·Z 성분을 더해 TCP 좌표를 구합니다.",
    fields: [
      { key: "link1X", label: "L₁의 X 성분", unit: "mm" },
      { key: "link1Z", label: "L₁의 Z 성분", unit: "mm" },
      { key: "link2X", label: "L₂의 X 성분", unit: "mm" },
      { key: "link2Z", label: "L₂의 Z 성분", unit: "mm" },
      { key: "tcpX", label: "TCP X 좌표", unit: "mm" },
      { key: "tcpZ", label: "TCP Z 좌표", unit: "mm" },
    ],
    expected: { link1X: 123.7, link1Z: 123.7, link2X: 108.3, link2Z: 62.5, tcpX: 232.0, tcpZ: 186.2 },
    reason: "θ₂가 음수일 때 두 번째 링크의 절대각과 TCP 좌표가 어떻게 달라지는지 설명하세요.",
  },
];
type MathLessonPhase = "concept" | "predict" | "review";
type MathCoach = {
  tone: "success" | "guide";
  title: string;
  body: string;
  next: string;
};

export function MathStartLesson({
  onStartCoordinates,
  onCorrectMove,
  startPointMotion,
  onCancelMove,
  hardwareMode = false,
  onFocusChange,
  onCoachChange,
  hintStep = 0,
  onHintStepChange,
}: {
  onStartCoordinates?: () => void;
  onCorrectMove?: FoundationMove;
  startPointMotion?: MotionProps;
  onCancelMove?: () => void;
  hardwareMode?: boolean;
  onFocusChange?: (focus: {
    active: true;
    startZ?: number;
    targetZ?: number;
    phase: MathLessonPhase;
    taskIndex: number;
    title: string;
    guideTitle?: string;
    guideBody?: string;
    weekLabel?: string;
  } | null) => void;
  onCoachChange?: (coach: MathCoach | null) => void;
  hintStep?: number;
  onHintStepChange?: (step: number) => void;
}) {
  const [index, setIndex] = useState(0),
    task = TASKS[index];
  const [moving, setMoving] = useState(false);
  const [motionMessage, setMotionMessage] = useState("");
  const movePending = useRef(false);
  const moveGeneration = useRef(0);
  useEffect(() => {
    moveGeneration.current++;
    movePending.current = false;
    setMoving(false);
    setMotionMessage("");
    return () => { moveGeneration.current++; onCancelMove?.(); };
  }, [index, hardwareMode, onCancelMove]);
  const [phase, setPhase] = useState<MathLessonPhase>("predict");
  const [stageFeedback, setStageFeedback] = useState("");
  const [fieldStatuses, setFieldStatuses] = useState<Record<string,"correct"|"incorrect">>({});
  const [challengeValidated, setChallengeValidated] = useState(false);
  const [supportChoices, setSupportChoices] = useState<Record<string, { mode: "guided"|"challenge"; usedGuidance: boolean }>>({});
  const supportMode = supportChoices[task.id]?.mode ?? (task.independent ? "challenge" : "guided");
  const usedGuidance = supportChoices[task.id]?.usedGuidance ?? !task.independent;
  const unaidedMode = task.independent && supportMode === "challenge";
  const [coach, setCoach] = useState<MathCoach | null>(null);
  const publishCoach = (next: MathCoach | null) => {
    setCoach(next);
    onCoachChange?.(next);
  };
  useEffect(() => {
    setPhase("predict");
    setStageFeedback("");
    setFieldStatuses({});
    setChallengeValidated(false);
    setCoach(null);
    onCoachChange?.(null);
    onHintStepChange?.(0);
  }, [index, onHintStepChange, onCoachChange]);
  useEffect(() => {
    if (!onFocusChange) return;
    const heightHint=task.id==="height-practice"
      ? HEIGHT_HINTS[Math.max(0,Math.min(4,hintStep))]
      : task.id==="height-transfer"
        ? TRANSFER_HINTS[Math.max(0,Math.min(2,hintStep))]
        : taskStageGuide(task,Math.max(0,Math.min(4,hintStep)));
    const week=COURSE_WEEKS[courseWeekIndexForTask(index)];
    onFocusChange({
      active:true,
      startZ:task.id==="height-practice" ? 20 : task.id==="height-transfer" ? 45 : undefined,
      targetZ:task.id==="height-practice" || task.id==="height-transfer" ? 60 : undefined,
      phase,
      taskIndex:index,
      title:task.title,
      guideTitle:unaidedMode && phase!=="review" ? "새 조건에 스스로 적용" : heightHint.title,
      guideBody:unaidedMode && phase!=="review" ? task.prompt : task.id==="height-practice" ? heightHint.body : `${heightHint.body} 현재 문항: ${task.title}`,
      weekLabel:week.label,
    });
  }, [onFocusChange, phase, index, task, hintStep, unaidedMode]);
  const inquiry = useMathInquiry(
    "foundation",
    {
      id: task.id,
      prompt: task.prompt,
      taskKind: task.independent ? "transfer" : "practice",
      reasoning: task.reasoning,
      concept: task.concept,
      support: unaidedMode && !usedGuidance ? "independent" : supportMode,
      transferTask: task.independent,
      guidanceBeforePrediction: usedGuidance,
    },
    task.fields,
    ["math-check"],
    0,
    false,
    "math",
  );
  useEffect(() => { if (phase === "review" && !inquiry.ready) setPhase("predict"); }, [phase, inquiry.ready]);
  useEffect(() => {
    if (inquiry.ready) { publishCoach(null); setStageFeedback(""); }
  }, [inquiry.ready]);
  const isHeightChallenge = task.id === "height-practice";
  const isHeightTransfer = task.id === "height-transfer";
  const isHeightTask = isHeightChallenge || isHeightTransfer;
  const heightCurrent = isHeightTransfer ? 45 : 20;
  const heightTarget = 60;
  const isVectorTask = task.id === "vector-practice" || task.id === "vector-transfer";
  const vectorCurrent = task.id === "vector-transfer" ? "(350, 70, 60)" : "(320, 40, 20)";
  const vectorTarget = task.id === "vector-transfer" ? "(320, 110, 35)" : "(350, 70, 60)";
  const isDistanceTask = task.id === "distance-practice" || task.id === "distance-transfer";
  const isProjectionTask = task.id === "projection-practice" || task.id === "projection-transfer";
  const isTwoLinkTask = task.id === "two-link-practice" || task.id === "two-link-transfer";
  const projectionAngle = task.id === "projection-transfer" ? 60 : 30;
  const twoLinkTheta1 = task.id === "two-link-transfer" ? 45 : 30;
  const twoLinkTheta2 = task.id === "two-link-transfer" ? -15 : 20;
  const twoLinkAbsoluteTheta2 = twoLinkTheta1 + twoLinkTheta2;
  const isChallengeMode = supportMode === "challenge";
  const courseWeekIndex=courseWeekIndexForTask(index);
  const currentCourseWeek=COURSE_WEEKS[courseWeekIndex];
  const effectiveHintStep=Math.max(0,Math.min(4,hintStep));
  const transferHintStep=Math.max(0,Math.min(2,effectiveHintStep));
  const displayedHintStep=isHeightTransfer ? transferHintStep : effectiveHintStep;
  const displayedHintTotal=isHeightTransfer ? 3 : 5;
  const difficultyLabel = index < 2
    ? "기초 위치·변화량"
    : index < 4
      ? "다축 변화 벡터"
      : index < 6
        ? "거리와 경로"
        : index < 8
          ? "삼각비 성분"
          : "2링크 TCP";
  const currentHint=isHeightChallenge
    ? HEIGHT_HINTS[effectiveHintStep]
    : isHeightTransfer
      ? TRANSFER_HINTS[transferHintStep]
      : taskStageGuide(task,effectiveHintStep);
  const allFieldKeys=task.fields.map(f=>f.key);
  const visibleFieldKeys=isChallengeMode
    ? allFieldKeys
    : isHeightChallenge
      ? effectiveHintStep===0
        ? ["targetZ"]
        : effectiveHintStep===1
          ? ["targetZ","deltaX","deltaY","deltaZ"]
          : allFieldKeys
      : isHeightTransfer
        ? allFieldKeys
        : effectiveHintStep===0
          ? allFieldKeys.slice(0,1)
        : effectiveHintStep===1
          ? allFieldKeys.slice(0,Math.max(1,Math.ceil(allFieldKeys.length/2)))
          : allFieldKeys;
  const showRelationHint=supportMode==="guided" || phase==="review";
  const answerStatus=(key:string): "correct"|"incorrect" => {
    const expected=task.expected[key];
    return foundationAnswerMatches(inquiry.draft[key], expected) ? "correct" : "incorrect";
  };
  const keyHint=(key:string) => foundationHint(task.id, key);
  const challengeKeyHint=(key:string) => ({
    targetZ:"현재 위치가 아니라 도착할 목표의 절대좌표인지 확인하세요.",
    deltaX:"이동 조건에서 X축이 변하는지 먼저 판단하세요.",
    deltaY:"이동 조건에서 Y축이 변하는지 먼저 판단하세요.",
    deltaZ:"목표 위치와 현재 위치의 차이를 부호까지 확인하세요.",
    delta:"목표 높이와 현재 높이의 차이를 계산하고, 출발 높이가 바뀌면 변화량도 달라지는지 확인하세요.",
    command:"문제에서 요구한 이동 경로가 직선인지 관절 이동인지 다시 읽어보세요.",
    distance:"각 축의 변화량을 거리 공식에 올바르게 넣었는지 확인하세요.",
    horizontal:"각도 기준과 수평 성분에 대응하는 삼각비를 다시 확인하세요.",
    vertical:"각도 기준과 높이 성분에 대응하는 삼각비를 다시 확인하세요.",
  } as Record<string,string>)[key]??"문제 조건과 입력값 사이의 관계를 다시 확인하세요.";
  const checkCurrentStage=() => {
    if (unaidedMode) return;
    const checkKeys=isChallengeMode
      ? allFieldKeys
      : isHeightTransfer
        ? visibleFieldKeys
        : allFieldKeys.filter(key => visibleFieldKeys.includes(key));
    const nextStatuses:Record<string,"correct"|"incorrect">={...fieldStatuses};
    checkKeys.forEach(key=>{ nextStatuses[key]=answerStatus(key); });
    setFieldStatuses(nextStatuses);
    const wrongKeys=checkKeys.filter(key=>nextStatuses[key]!=="correct");
    inquiry.feedbackEvent("guided-check", checkKeys);
    const reasonCorrect=inquiry.reason.trim().length>0;
    const correct=isChallengeMode
      ? wrongKeys.length===0 && reasonCorrect
      : isHeightTransfer
        ? wrongKeys.length===0 && (!transferHintStep || reasonCorrect)
        : wrongKeys.length===0 && (effectiveHintStep !== 3 || reasonCorrect);
    inquiry.requestAi({fieldStatuses:nextStatuses,reasonProvided:reasonCorrect,
      mathematicalStatus:correct?"현재 단계 규칙 판정 통과":"현재 단계 다시 확인",
      executionStatus:"아직 이동 요청 없음"});

    if (correct) {
      const successBody=isChallengeMode
        ? "모든 항목과 근거가 확인되었습니다. 이제 예측·근거 저장으로 기록하세요."
        : isHeightTransfer
          ? transferHintStep===0
            ? "이번 조건의 상승량이 확인되었습니다. 이제 앞 문제와 값이 달라진 이유를 설명하세요."
            : "앞 문제와의 조건 차이와 계산 근거가 확인되었습니다. 예측·근거를 저장하세요."
          : effectiveHintStep===0
            ? "첫 항목이 확인되었습니다. 다음 항목을 연결해 계산해 보세요."
            : effectiveHintStep===1
              ? "중간 계산이 확인되었습니다. 이제 전체 예측과 이동 조건을 점검하세요."
              : effectiveHintStep===2
                ? "수치와 명령이 모두 확인되었습니다. 이제 계산 근거를 자신의 말로 설명하세요."
                : "근거가 입력되었습니다. 모든 답을 저장하면 수학적 확인으로 넘어갑니다.";
      setChallengeValidated(isChallengeMode);
      setStageFeedback("");
      publishCoach({
        tone:"success",
        title:isChallengeMode
          ? "도전 확인 완료"
          : (isHeightTransfer ? transferHintStep : effectiveHintStep)+1+"단계 확인 완료",
        body:successBody,
        next:isChallengeMode || (isHeightTransfer ? transferHintStep>=1 : effectiveHintStep>=4)
          ? "예측·근거 저장 버튼을 눌러 기록하세요."
          : "다음: "+((isHeightTransfer ? transferHintStep : effectiveHintStep)+2)+"단계로 이동",
      });
      if (!isChallengeMode) onHintStepChange?.(Math.min(4,effectiveHintStep+1));
      return;
    }

    const body=isChallengeMode
      ? [
          wrongKeys.slice(0,3).map(key=>(task.fields.find(f=>f.key===key)?.label??key)+": "+challengeKeyHint(key)).join(" "),
          wrongKeys.length>3 ? "나머지 항목도 조건을 다시 확인하세요." : "",
          !reasonCorrect ? "근거가 비어 있습니다. 계산 관계와 이동 조건을 한 문장으로 연결해 보세요." : "",
        ].filter(Boolean).join(" ")
      : isHeightTransfer
        ? [
            wrongKeys.length
              ? wrongKeys.map(key=>(task.fields.find(f=>f.key===key)?.label??key)+": "+keyHint(key)).join(" ")
              : "",
            transferHintStep>=1 && !reasonCorrect
              ? "앞 문제의 ΔZ=40 mm와 이번 ΔZ=15 mm가 달라진 이유를 한 문장으로 설명해 보세요."
              : "",
          ].filter(Boolean).join(" ") || "이번 조건의 상승량과 앞 문제와의 차이를 다시 확인하세요."
        : effectiveHintStep===3 && !reasonCorrect
          ? "근거가 비어 있습니다. 계산식 하나와 이동 조건 하나를 연결해 한 문장으로 써 보세요."
          : wrongKeys.length
            ? wrongKeys.map(key=>(task.fields.find(f=>f.key===key)?.label??key)+": "+keyHint(key)).join(" ")
            : "이번 단계의 입력을 확인하세요.";
    setChallengeValidated(false);
    setStageFeedback(body);
    publishCoach({
      tone:"guide",
      title:isChallengeMode
        ? "도전 답을 다시 점검하세요"
        : (isHeightTransfer ? transferHintStep : effectiveHintStep)+1+"단계 다시 생각하기",
      body,
      next:isChallengeMode ? "빨간 항목을 스스로 수정한 뒤 다시 확인하세요." : "빨간 항목만 고친 뒤 ‘답 확인’을 다시 누르세요.",
    });
  };
  const confirmAndMove = () => {
    if (movePending.current) return;
    const original = inquiry.record;
    if (!original) return;
    const prediction = original.prediction;
    const wrong = allFieldKeys.filter(key => !foundationAnswerMatches(prediction[key], task.expected[key]));
    if (wrong.length) {
      inquiry.feedbackEvent("guided-check", wrong);
      const message = "입력값 오류 · " + wrong.map(key => `${task.fields.find(f => f.key === key)?.label}: ${keyHint(key)}`).join(" ");
      inquiry.revise();
      setFieldStatuses(Object.fromEntries(wrong.map(key => [key, "incorrect" as const])));
      setChallengeValidated(false);
      setStageFeedback(message);
      setMotionMessage(message);
      onHintStepChange?.(0);
      publishCoach({ tone: "guide", title: "입력값을 다시 확인하세요", body: message, next: "빨간 항목을 수정하고 예측을 다시 저장하세요." });
      return;
    }
    const startedAt = new Date().toISOString();
    const finish = (result?: { summary: string; detail: unknown }) => {
      inquiry.recordExecution(original, { action: "math-check", status: "completed", startedAt,
        endedAt: new Date().toISOString(), expected: task.expected,
        summary: result?.summary ?? "주어진 조건으로 수학 관계를 확인했습니다. 로봇 동작이나 센서 측정 결과는 아닙니다.",
        detail: { task: task.id, motion: result?.detail ?? null } });
    };
    if (!onCorrectMove || !hasFoundationMotion(task.id)) { finish(); setPhase("review"); return; }
    const blocked = (summary: string, status: "stopped" | "unavailable") =>
      inquiry.recordExecution(original, { action: "motion-attempt", status, startedAt,
        endedAt: new Date().toISOString(), summary,
        detail: { task: task.id, requestedMode: hardwareMode ? "hardware" : "virtual" } });
    movePending.current = true;
    setMoving(true);
    setMotionMessage(hardwareMode ? "정답입니다. 실장비의 준비 상태와 목표 이동을 확인합니다." : "정답입니다. 가상 로봇을 목표 위치로 이동합니다.");
    const generation = moveGeneration.current;
    void onCorrectMove(task.id).then(result => {
      if (!result) {
        const message = "이동을 취소했습니다. 답·근거와 이전 실행 기록은 유지됩니다. 버튼을 눌러 재시도할 수 있습니다.";
        blocked(message, "stopped");
        if (generation === moveGeneration.current) setMotionMessage(message);
        return;
      }
      finish(result);
      if (generation !== moveGeneration.current) return;
      setPhase("review");
      setMotionMessage(result.summary);
    }).catch(error => {
      const message = `정답이지만 이동하지 못했습니다. ${error instanceof Error ? error.message : String(error)} 답은 바꾸지 말고 부족한 조건을 확인한 뒤 다시 시도하세요.`;
      blocked(message, /취소|중단/.test(message) ? "stopped" : "unavailable");
      if (generation !== moveGeneration.current) return;
      setMotionMessage(message);
    }).finally(() => {
      if (generation === moveGeneration.current) { movePending.current = false; setMoving(false); }
    });
  };
  const clearFieldStatus = (key:string) => {
    setMotionMessage("");
    setChallengeValidated(false);
    setFieldStatuses(current => {
      const next={...current};
      delete next[key];
      return next;
    });
  };
  const changeSupportMode=(mode:"guided"|"challenge") => {
    if (movePending.current) return;
    setSupportChoices(previous => ({ ...previous, [task.id]: { mode, usedGuidance: usedGuidance || mode === "guided" } }));
    setChallengeValidated(false);
    setFieldStatuses({});
    setStageFeedback("");
    publishCoach(null);
  };
  const openCourseWeek=(weekIndex:number) => {
    const targetIndex=COURSE_TASK_STARTS[weekIndex];
    if (targetIndex === undefined) return;
    setPhase("predict");
    setStageFeedback("");
    setFieldStatuses({});
    setChallengeValidated(false);
    publishCoach(null);
    onHintStepChange?.(0);
    setIndex(targetIndex);
  };
  return (
    <div className="lesson-scroll math-start-lesson">
      {startPointMotion && <TaskStartPoint taskKey={`foundation:${task.id}:${startPointMotion.resetKey}`}
        start={foundationMotion(task.id,startPointMotion.coords)?.start ?? null} coords={startPointMotion.coords}
        disabled={moving} legacyConnected={startPointMotion.hardwareConnected}
        onVirtualMove={p=>moveVirtualTaskStart(startPointMotion,p)}/>}
      <div className="axis-status">
        <strong>{index + 1}/{TASKS.length} · {task.concept}</strong>
        <span>난이도: {difficultyLabel} · 현재 단계: {phase === "review" ? "수학 확인" : "예측"}</span>
      </div>
      <div
        className="math-course-strip math-course-strip--compact"
        aria-label="기초수학 문항 연습 경로. 1~4번 문항군을 클릭해 바로 학습할 수 있습니다."
      >
        <div className="math-course-strip__top">
          <strong>수업 경로</strong>
          <span>{currentCourseWeek.label} · {currentCourseWeek.title}</span>
        </div>
        <div className="math-course-summary">
          {COURSE_WEEKS.map((week,i)=>(
            <button
              key={week.label}
              type="button"
              className={i===courseWeekIndex ? "is-current" : i<courseWeekIndex ? "is-done" : ""}
              aria-current={i===courseWeekIndex ? "step" : undefined}
              aria-label={week.label+" "+week.title+" 문항으로 이동"}
              title={week.title+" · 클릭하여 해당 문항으로 이동"}
              onClick={()=>openCourseWeek(i)}
            >
              <b>{i+1}</b>{week.short}
            </button>
          ))}
        </div>

      </div>
      <div className="math-support-bar">
        <strong>지원 수준</strong>
        <button type="button" className={supportMode==="guided" ? "is-selected" : ""} disabled={moving} onClick={()=>changeSupportMode("guided")}>기초 지원</button>
        <button type="button" className={supportMode==="challenge" ? "is-selected" : ""} disabled={moving} onClick={()=>changeSupportMode("challenge")}>도전 모드</button>
      </div>
      <div className="math-stage-rail" aria-label="현재 활동 단계">
        {(["predict", "review"] as const).map((key) => (
          <span key={key} aria-current={phase === key ? "step" : undefined}>
            {key === "predict" ? "예측 입력" : "수학 확인"}
          </span>
        ))}
      </div>

      <>
        <LessonConceptHeader
            section="1"
            label={currentCourseWeek.label + " · 이번 활동의 핵심"}
            title={task.concept}
            duration="수업 1회 20~30분"
            showColumns={false}
            definition={
              task.concept === "위치와 변화량"
                ? "출발 위치·목표 위치·이동량을 분리해 표현합니다. 숫자를 맞히는 것보다 어떤 값이 절대좌표이고 어떤 값이 변화량인지 설명하는 것이 핵심입니다."
                : task.concept === "다축 변화량과 이동 경로"
                  ? "축별 변화량을 벡터로 묶고, 직선거리와 실제 이동 경로를 구분합니다."
                  : task.concept === "좌표 차이와 직선거리"
                    ? "부호가 있는 축별 변화량과 항상 양수인 두 점 사이 거리를 구분합니다."
                    : task.concept === "링크 길이의 수평·높이 성분"
                      ? "하나의 링크 길이를 cos·sin 성분으로 나누어 TCP 위치 계산의 재료로 만듭니다."
                      : "각 링크의 절대각을 구분하고 성분을 더해 TCP 위치를 계산합니다."
            }
            columns={[]}
          />
          {(!unaidedMode || phase === "review") && <section
            className="math-concept-bridge"
            aria-labelledby="math-concept-bridge-title"
            style={{
              margin: "10px 0 14px",
              padding: "14px",
              border: "1px solid #c7d2fe",
              borderRadius: 10,
              background: "#f8faff",
            }}
          >
            <div
              style={{
                color: "#3730a3",
                fontSize: 14,
                fontWeight: 800,
                marginBottom: 10,
              }}
            >
              핵심 개념을 이번 문제와 연결하기
            </div>
            {isHeightTask ? (
              isHeightTransfer ? (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                      gap: 10,
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ padding: "12px", background: "#fff", borderRadius: 8 }}>
                      <span style={{ display: "block", color: "#64748b", fontSize: 12 }}>앞 문제</span>
                      <strong style={{ display: "block", marginTop: 4, color: "#0f172a", fontSize: 16 }}>Z=20 → Z=60</strong>
                      <small style={{ display: "block", marginTop: 4, color: "#475569", fontSize: 12 }}>ΔZ = 40 mm</small>
                    </div>
                    <div style={{ padding: "12px", background: "#fff", borderRadius: 8, border: "1px solid #bfdbfe" }}>
                      <span style={{ display: "block", color: "#64748b", fontSize: 12 }}>이번 문제</span>
                      <strong style={{ display: "block", marginTop: 4, color: "#3730a3", fontSize: 16 }}>Z=45 → Z=60</strong>
                      <small style={{ display: "block", marginTop: 4, color: "#2563eb", fontSize: 12 }}>ΔZ = ?</small>
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      background: "#eef2ff",
                      color: "#1e293b",
                      fontSize: 14,
                      fontWeight: 700,
                    }}
                  >
                    전이 확인 · 목표 Z는 같고 출발 Z만 달라졌습니다.
                  </div>
                  <p style={{ margin: "10px 0 0", color: "#475569", fontSize: 13, lineHeight: 1.55 }}>
                    앞 문제는 <strong>ΔZ=60−20=40 mm</strong>였습니다. 이번 문제에서는{" "}
                    <strong>ΔZ=60−45</strong>를 계산하고, 두 답이 왜 달라지는지 설명합니다.
                  </p>
                </>
              ) : (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 16,
                      marginBottom: 10,
                      padding: "12px",
                      background: "#fff",
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ textAlign: "center" }}>
                      <span style={{ display: "block", color: "#64748b", fontSize: 12 }}>현재 Z</span>
                      <strong style={{ color: "#0f172a", fontSize: 24 }}>{heightCurrent}</strong>
                      <span style={{ color: "#64748b", fontSize: 12 }}> mm</span>
                    </div>
                    <span style={{ color: "#4f46e5", fontSize: 28, fontWeight: 900 }}>→</span>
                    <div style={{ textAlign: "center" }}>
                      <span style={{ display: "block", color: "#64748b", fontSize: 12 }}>목표 Z</span>
                      <strong style={{ color: "#3730a3", fontSize: 24 }}>{heightTarget}</strong>
                      <span style={{ color: "#64748b", fontSize: 12 }}> mm</span>
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      background: "#eef2ff",
                      color: "#1e293b",
                      fontSize: 14,
                      fontWeight: 700,
                    }}
                  >
                    상대 상승량&nbsp;&nbsp;ΔZ = Z<sub>target</sub> − Z<sub>current</sub> = ?
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      padding: "9px 12px",
                      borderRadius: 8,
                      background: "#f1f5f9",
                      color: "#334155",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    좌표 변화 벡터&nbsp;&nbsp;Δp = (ΔX, ΔY, ΔZ)
                  </div>
                  <p style={{ margin: "10px 0 0", color: "#475569", fontSize: 13, lineHeight: 1.55 }}>
                    목표 절대좌표 <strong>Z={heightTarget}</strong>은 도착할 위치입니다.
                    수직 이동 조건에서 변하는 축과 유지되는 축을 구분합니다.
                    <br />
                    절대 목표좌표·상대 변화량·이동 경로에 맞는 명령을 각각 판단합니다.
                  </p>
                </>
              )
            ) : isVectorTask ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ padding: "12px", background: "#fff", borderRadius: 8 }}>
                    <span style={{ display: "block", color: "#64748b", fontSize: 12 }}>현재 위치</span>
                    <strong style={{ display: "block", marginTop: 4, color: "#0f172a", fontSize: 16 }}>{vectorCurrent}</strong>
                  </div>
                  <div style={{ padding: "12px", background: "#fff", borderRadius: 8 }}>
                    <span style={{ display: "block", color: "#64748b", fontSize: 12 }}>목표 위치</span>
                    <strong style={{ display: "block", marginTop: 4, color: "#3730a3", fontSize: 16 }}>{vectorTarget}</strong>
                  </div>
                </div>
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "#eef2ff",
                    color: "#1e293b",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  좌표 변화 벡터&nbsp;&nbsp;Δp = (ΔX, ΔY, ΔZ)
                </div>
                <div
                  style={{
                    marginTop: 8,
                    padding: "9px 12px",
                    borderRadius: 8,
                    background: "#f1f5f9",
                    color: "#334155",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  <math
                    aria-label="3차원 직선거리 d는 변화 벡터의 크기"
                    style={{ display: "inline-flex", alignItems: "center", fontSize: 17, fontWeight: 800 }}
                  >
                    <mi>d</mi>
                    <mo>=</mo>
                    <msqrt>
                      <mrow>
                        <msup><mi>ΔX</mi><mn>2</mn></msup>
                        <mo>+</mo>
                        <msup><mi>ΔY</mi><mn>2</mn></msup>
                        <mo>+</mo>
                        <msup><mi>ΔZ</mi><mn>2</mn></msup>
                      </mrow>
                    </msqrt>
                  </math>
                </div>
                <p style={{ margin: "10px 0 0", color: "#475569", fontSize: 13, lineHeight: 1.55 }}>
                  각 축의 변화량은 <strong>목표 좌표−현재 좌표</strong>로 계산합니다.
                  부호는 이동 방향을, 직선거리는 변화 벡터의 크기를 나타냅니다.
                </p>
              </>
            ) : isDistanceTask ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  {[
                    ["ΔX", task.id === "distance-transfer" ? "−60" : "30"],
                    ["ΔY", task.id === "distance-transfer" ? "80" : "40"],
                    ["ΔZ", "0"],
                  ].map(([label, value]) => (
                    <div key={label} style={{ padding: "12px", background: "#fff", borderRadius: 8, textAlign: "center" }}>
                      <span style={{ display: "block", color: "#64748b", fontSize: 12 }}>{label}</span>
                      <strong style={{ display: "block", marginTop: 4, color: "#0f172a", fontSize: 18 }}>{value} mm</strong>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "#eef2ff",
                    color: "#1e293b",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  직선거리&nbsp;&nbsp;d = √(ΔX² + ΔY² + ΔZ²)
                </div>
                <p style={{ margin: "10px 0 0", color: "#475569", fontSize: 13, lineHeight: 1.55 }}>
                  부호는 각 축의 이동 방향을, 직선거리는 변화 벡터의 크기를 나타냅니다.
                </p>
              </>
            ) : isProjectionTask ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ padding: "12px", background: "#fff", borderRadius: 8, textAlign: "center" }}>
                    <span style={{ display: "block", color: "#64748b", fontSize: 12 }}>링크 길이 L</span>
                    <strong style={{ display: "block", marginTop: 4, color: "#0f172a", fontSize: 20 }}>100 mm</strong>
                  </div>
                  <div style={{ padding: "12px", background: "#fff", borderRadius: 8, textAlign: "center" }}>
                    <span style={{ display: "block", color: "#64748b", fontSize: 12 }}>수평 기준 각도 θ</span>
                    <strong style={{ display: "block", marginTop: 4, color: "#3730a3", fontSize: 20 }}>{projectionAngle}°</strong>
                  </div>
                </div>
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "#eef2ff",
                    color: "#1e293b",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  수평 성분 = L·cosθ&nbsp;&nbsp; · &nbsp;&nbsp;높이 성분 = L·sinθ
                </div>
                <p style={{ margin: "10px 0 0", color: "#475569", fontSize: 13, lineHeight: 1.55 }}>
                  링크 길이는 같아도 각도가 달라지면 수평·높이 성분의 비율이 달라집니다.
                </p>
              </>
            ) : isTwoLinkTask ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ padding: "12px", background: "#fff", borderRadius: 8 }}>
                    <span style={{ display: "block", color: "#64748b", fontSize: 12 }}>첫 번째 링크</span>
                    <strong style={{ display: "block", marginTop: 4, color: "#0f172a", fontSize: 16 }}>L₁=175 mm · θ₁={twoLinkTheta1}°</strong>
                  </div>
                  <div style={{ padding: "12px", background: "#fff", borderRadius: 8 }}>
                    <span style={{ display: "block", color: "#64748b", fontSize: 12 }}>두 번째 링크</span>
                    <strong style={{ display: "block", marginTop: 4, color: "#3730a3", fontSize: 16 }}>L₂=125 mm · θ₂={twoLinkTheta2}°</strong>
                  </div>
                </div>
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "#eef2ff",
                    color: "#1e293b",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  L₂ 절대각 = θ₁ + θ₂ = {twoLinkAbsoluteTheta2}°&nbsp;&nbsp; · &nbsp;&nbsp;TCP = 링크 성분의 합
                </div>
                <p style={{ margin: "10px 0 0", color: "#475569", fontSize: 13, lineHeight: 1.55 }}>
                  두 번째 관절각을 그대로 쓰지 않고 절대각으로 바꾼 뒤, 두 링크의 X·Z 성분을 더합니다.
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: 0, color: "#334155", fontSize: 14, lineHeight: 1.55 }}>
                  <strong>이번 조건</strong> {task.prompt}
                </p>
                <div
                  style={{
                    marginTop: 10,
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "#eef2ff",
                    color: "#334155",
                    fontSize: 13,
                    lineHeight: 1.55,
                  }}
                >
                  {task.formula || "앞에서 확인한 수학 관계를 새로운 조건에 적용해 보세요."}
                </div>
              </>
            )}
        </section>}
      </>

      {phase !== "review" && (
        <>
          {task.formula && showRelationHint && (
            <details className="math-relation-hint" onToggle={event => { if(event.currentTarget.open) recordLearningAction("foundation","hint-used",{condition:{id:task.id,independent:task.independent},hints:["관계 힌트·예시 보기"]},"math"); }}>
              <summary>관계 힌트·예시 보기</summary>
              <p className="lesson-formula">{task.formula}</p>
            </details>
          )}

          <MathInquiryPanel
            inquiry={inquiry}
            part="before"
            locked={moving}
            prompt={unaidedMode ? task.prompt : isChallengeMode
              ? "도전 모드 · 모든 항목과 근거를 먼저 완성한 뒤 답을 확인하세요."
              : (displayedHintStep+1)+"/"+displayedHintTotal+" · "+currentHint.title+" — 열린 항목만 입력하세요."}
            visibleFieldKeys={visibleFieldKeys}
            showReason={isChallengeMode || (isHeightTransfer ? transferHintStep >= 1 : effectiveHintStep >= 3)}
            showSubmit={unaidedMode ? true : isChallengeMode
              ? challengeValidated
              : (isHeightTransfer ? transferHintStep >= 2 : effectiveHintStep >= 4)}
            onNextHint={unaidedMode ? undefined : isChallengeMode
              ? (challengeValidated ? undefined : checkCurrentStage)
              : (isHeightTransfer
                  ? (transferHintStep < 2 ? checkCurrentStage : undefined)
                  : (effectiveHintStep < 4 ? checkCurrentStage : undefined))}
            nextHintLabel={isChallengeMode
              ? "도전 답 확인"
              : (isHeightTransfer
                  ? (transferHintStep === 0 ? "답 확인 · 이유 작성 →" : "답 확인 · 저장 준비 →")
                  : "답 확인 · 다음 힌트 보기 →")}
            actionFeedback={stageFeedback}
            fieldStatuses={fieldStatuses}
            onFieldChange={clearFieldStatus}
          />
          {!inquiry.ready && <p className="lesson-note">
            ‘답 확인’은 채점만 하며 로봇은 움직이지 않습니다. 모든 항목과 근거를 완성하고
            ‘예측·근거 저장’을 누르면 바로 아래에 최종 이동 버튼이 나타납니다.
          </p>}
        </>
      )}

      {inquiry.ready ? <FoundationMovePanel hardware={hardwareMode} moving={moving}
        observed={inquiry.observed} motion={!!onCorrectMove && hasFoundationMotion(task.id)}
        message={motionMessage} runs={inquiry.record?.runs ?? []} onMove={confirmAndMove} taskId={task.id}/>
        : motionMessage && <p role="status" aria-live="polite" className="lesson-feedback">{motionMessage}</p>}

      {phase === "review" && (
        <>
          <div className="math-review-context">
            <strong>{task.title}</strong>
            <span>예측과 수학적 확인 결과를 비교하고 설명하세요.</span>
          </div>
          <MathInquiryPanel
            inquiry={inquiry}
            part="after"
            locked={moving}
            reflectionPrompt={task.reason}
            nextLabel={
              index % 2 === 0
                ? "같은 관계를 새 조건에 적용 →"
                : "다음 수학 관계로 →"
            }
            onNewCondition={
              index < TASKS.length - 1 ? () => setIndex((i) => i + 1) : undefined
            }
          />
        </>
      )}

      {index === TASKS.length - 1 && inquiry.reviewed && (
        <p className="lesson-feedback">
          이제 다축 변화량·거리·삼각비·2링크 성분을 로봇의 좌표 명령과 연결해 봅시다.
        </p>
      )}
      {onStartCoordinates && inquiry.reviewed && (
        <button className="lesson-next" onClick={onStartCoordinates}>
          2-1 좌표축·이동 방향을 DT에서 확인 →
        </button>
      )}
    </div>
  );
}

