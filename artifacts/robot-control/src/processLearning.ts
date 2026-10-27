import type { LessonPose } from "./curriculum";
import { worldToLocal, localToWorld, processTransport, processPackingPlan } from "./processCell";
import type { CellCompilation, CellRobotId, CellScenario } from "./processCellTypes";

export type ProcessPlanPoint = {
  label: string; robot: CellRobotId; kind: "given" | "calculated"; pose: LessonPose; marker?: string; traySlot?: number;
};

/** Student work points, in the named robot's frame, including the chosen transport route. */
export function processPlan(scenario: CellScenario, answers: Record<string, number>): ProcessPlanPoint[] {
  const a = scenario.robots.find(robot => robot.id === "A")!;
  const rows: ProcessPlanPoint[] = [];
  const given = (label: string, robot: typeof a, pose: LessonPose) => rows.push({
    label, robot: robot.id, kind: "given", pose: worldToLocal(pose, robot),
  });
  if (scenario.level <= 2) {
    const route = processTransport(scenario, answers);
    if (scenario.belt) given("벨트 출발", a, scenario.belt.from);
    rows.push({ marker: "P1", label: "A 집기", robot: "A", kind: scenario.belt ? "calculated" : "given", pose: route.pick },
      { marker: "P2", label: "A 들어 올리기", robot: "A", kind: "calculated", pose: route.lift });
    if (route.corner) rows.push({ marker: "경유", label: answers.routeChoice === 1 ? "X 먼저 경유" : "Y 먼저 경유",
      robot: "A", kind: "calculated", pose: route.corner });
    rows.push({ marker: "P3", label: "A 목표 위 접근", robot: "A", kind: "calculated", pose: route.above },
      { marker: "P4", label: "A 놓기", robot: "A", kind: scenario.level === 1 ? "calculated" : "given", pose: route.place });
    return rows;
  }
  if (scenario.belt) {
    given("벨트 출발", a, scenario.belt.from);
    rows.push({ label: "A 집기", robot: "A", kind: "calculated",
      pose: { ...worldToLocal(scenario.source, a), y: answers.beltY ?? NaN } });
  } else given("A 집기", a, scenario.source);
  if (!scenario.handoff) {
    const destination = worldToLocal(scenario.destination, a);
    rows.push({ label: "A 놓기", robot: "A", kind: scenario.level === 1 ? "calculated" : "given",
      pose: scenario.level === 1 ? { ...destination, x: answers.targetX ?? NaN, y: answers.targetY ?? NaN } : destination });
    return rows;
  }
  const b = scenario.robots.find(robot => robot.id === "B")!;
  given("A 인계대에 놓기", a, scenario.handoff);
  rows.push({ label: "B 인계대에서 집기", robot: "B", kind: "calculated",
    pose: { ...worldToLocal(scenario.handoff, b), x: answers.handoffX ?? NaN, y: answers.handoffY ?? NaN } });
  if (!scenario.tray) given("B 놓기", b, scenario.destination);
  else {
    for (const item of processPackingPlan(scenario, answers)) {
      rows.push({ label: `B 포장 · 블록 ${item.order} → 칸 ${item.slot + 1}`, robot: "B",
        traySlot: item.slot, kind: item.slot === 0 ? "given" : "calculated", pose: item.command });
    }
  }
  return rows;
}

export function processStructure(scenario: CellScenario) {
  const relationships = {
    1: {
      prompt: "이동량으로 도착 위치를 구할 때 사용할 관계는 무엇인가요?",
      options: [
        { value: "destination", label: "도착 좌표 = 출발 좌표 + 이동량" },
        { value: "distance", label: "도착 좌표 = 이동 거리" },
        { value: "unchanged", label: "도착 좌표 = 출발 좌표" },
      ], expected: "destination", feedback: "이동량은 좌표의 변화입니다. 출발 위치에 부호를 포함한 이동량을 더합니다.",
    },
    2: {
      prompt: "벨트가 멈춘 위치를 예측하려면 무엇을 연결해야 하나요?",
      options: [
        { value: "speed-only", label: "속도만 블록의 좌표로 사용한다" },
        { value: "position", label: "출발 Y + 속도 × 시간으로 정지 Y를 구한다" },
        { value: "origin", label: "블록은 로봇 원점에서 출발한다고 본다" },
      ], expected: "position", feedback: "속도 × 시간은 이동량입니다. 여기에 벨트 출발 Y를 더해야 정지 위치가 됩니다.",
    },
    3: {
      prompt: "두 로봇이 같은 인계점을 사용하려면 어떤 판단이 필요한가요?",
      options: [
        { value: "same", label: "같은 점이므로 A의 좌표를 B에 그대로 입력한다" },
        { value: "offset", label: "원점 차이만 더하고 축 방향은 유지한다" },
        { value: "frames", label: "B의 원점과 반대 축 방향으로 좌표를 바꾸고, A의 구역 이탈을 확인한다" },
      ], expected: "frames", feedback: "같은 물리적 점도 원점과 축 방향에 따라 좌표가 달라집니다. B의 진입에는 블록을 놓은 뒤 A가 구역을 벗어나는 조건도 필요합니다.",
    },
    4: {
      prompt: "공급·인계·네 칸 포장을 연결하는 계획은 무엇인가요?",
      options: [
        { value: "combined", label: "속도·시간으로 집기 위치를 구하고, B 좌표로 인계한 뒤 행·열 이동량으로 네 칸을 정한다" },
        { value: "repeat", label: "첫 칸 좌표를 네 번 반복한다" },
        { value: "simultaneous", label: "두 로봇을 동시에 인계점에 진입시킨다" },
      ], expected: "combined", feedback: "공급 위치·좌표계·인계 조건·배열 규칙이 모두 연결되어야 합니다. 각 칸은 첫 칸에 열·행 번호만큼의 이동량을 더해 구합니다.",
    },
  };
  return relationships[scenario.level];
}

const EVENT_LABELS: Record<string, string> = {
  "feed": "다음 블록 공급", "belt-stopped": "컨베이어 정지", "belt-ready": "집기 위치 도착",
  "wait-belt": "벨트 정지 대기", "A-grip": "A 블록 집기", "B-grip": "B 블록 집기",
  "grip-miss": "집기 위치 불일치", "placed": "목표에 배치", "place-miss": "놓기 위치 불일치",
  "handoff-release": "인계대에 블록 놓기", "A-cleared": "A 인계 구역 이탈", "B-cleared": "B 인계 구역 이탈",
  "A-wait-handoff": "A 인계대 사용 대기", "A-enter-handoff": "A 인계 구역 진입", "B-enter-handoff": "B 인계 구역 진입",
  "handoff-blocked": "인계 조건으로 진입 보류", "handoff-path-blocked": "인계 구역을 가로지르는 경로 중단",
  "A-returned": "A 시작 자세 복귀", "B-returned": "B 시작 자세 복귀",
  "plan-blocked": "실행 전 운반 순서 확인", "height-blocked": "실행 전 이동 높이 확인",
  "approach-blocked": "실행 전 수직 접근점 확인",
  "A-lifted": "P2 · 블록을 들어 올린 순간", "A-corner": "수평 경로의 경유점", "A-above": "P3 · 목표 위에 도착한 순간",
  "complete": "공정 완료", "failed": "공정 결과 확인 필요",
};
export const processEventLabel = (event: string) => EVENT_LABELS[event] ?? "공정 상태 변경";

/** Seek points from the same computed frames used by execution, including waits and contact events. */
export function processPreviewStops(compilation: CellCompilation) {
  return compilation.frames.flatMap((frame, index, frames) => {
    const events = frame.events?.length ? frame.events : frame.event ? [frame.event] : [];
    if (index !== 0 && index !== frames.length - 1 && !events.length && frame.phase === frames[index + 1]?.phase) return [];
    return [{ index, atMs: frame.atMs, label: index === 0 ? "시작 자세" : events.length
      ? events.map(processEventLabel).join(" · ") : frame.phase }];
  });
}

/** Directional segments in world coordinates; repeated packing cycles share a single drawn segment. */
export function processPreviewRoutes(scenario: CellScenario, compilation: CellCompilation) {
  return scenario.robots.map(robot => {
    const points: LessonPose[] = [];
    const distance = (a: LessonPose, b: LessonPose) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    for (const frame of compilation.frames) {
      const local = frame.robots[robot.id]?.pose;
      if (!local) continue;
      const point = localToWorld(local, robot);
      if (![point.x, point.y, point.z].every(Number.isFinite)) continue;
      const last = points.at(-1);
      if (last && distance(last, point) < 0.1) continue;
      const before = points.at(-2);
      if (last && before) {
        const firstLength = distance(before, last), length = distance(last, point);
        const dot = (last.x - before.x) * (point.x - last.x) + (last.y - before.y) * (point.y - last.y)
          + (last.z - before.z) * (point.z - last.z);
        if (dot / (firstLength * length) > 0.99999) points.pop();
      }
      points.push(point);
    }
    const segments: { from: LessonPose; to: LessonPose }[] = [], seen = new Set<string>();
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1], to = points[index];
      const key = [from.x, from.y, from.z, to.x, to.y, to.z].map(n => Math.round(n)).join(",");
      if (!seen.has(key)) { seen.add(key); segments.push({ from, to }); }
    }
    return { robot: robot.id, segments };
  }).filter(route => route.segments.length);
}
