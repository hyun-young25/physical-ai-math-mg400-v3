import { parseLessonNumber, sampleLessonMotion, type LessonModel, type LessonPose } from "./curriculum";
import type { CellFrame } from "./processCellTypes";
import type {
  DesignCommand, DesignLevel, DesignObservation, DesignRelations, DesignResult,
  DesignRole, DesignScenario,
} from "./pickPlaceDesignTypes";

export const DESIGN_ROLES: { role: DesignRole; label: string; action: DesignCommand["action"] }[] = [
  { role: "approach", label: "집기점 위 접근", action: "move" },
  { role: "contact", label: "접촉점으로 수직 하강", action: "move" },
  { role: "grip", label: "집기", action: "grip" },
  { role: "lift", label: "수직 상승", action: "move" },
  { role: "transfer", label: "수평 이송", action: "move" },
  { role: "above", label: "목표 위 접근", action: "move" },
  { role: "lower", label: "목표로 수직 하강", action: "move" },
  { role: "release", label: "놓기", action: "release" },
  { role: "retreat", label: "수직 후퇴", action: "move" },
];
const pose = (x: number, y: number, z: number): LessonPose => ({ x, y, z, r: 0 });
const distance = (a: LessonPose, b: LessonPose) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const xyDistance = (a: LessonPose, b: LessonPose) => Math.hypot(a.x - b.x, a.y - b.y);
const clone = <T,>(value: T): T => structuredClone(value);
const EPS = 0.2;
export const angularError = (a: number, b: number) => Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);
const BLOCK_HEIGHT = 20, BLOCK_HALF = 15, TCP_RADIUS = 4;

/** Conservative TCP / carried-block boxes. Not full-link collision certification. */
export function designCollision(scenario: DesignScenario, tcp: LessonPose, frame: CellFrame): string | null {
  const piece = frame.workpieces[0], carrying = piece.owner === "A";
  for (const table of scenario.surfaces) {
    const padding = carrying ? BLOCK_HALF * Math.SQRT2 : TCP_RADIUS;
    if (Math.abs(tcp.x - table.x) < table.halfX + padding && Math.abs(tcp.y - table.y) < table.halfY + padding
      && tcp.z - (carrying ? BLOCK_HEIGHT : 0) < table.z - EPS)
      return `${table.label}와 ${carrying ? "운반 중인 물체" : "TCP"}가 충돌합니다. 접촉 높이와 상승·이송 순서를 확인하세요.`;
  }
  if (!carrying && !piece.placed && Math.abs(tcp.x - piece.top.x) < BLOCK_HALF + TCP_RADIUS
    && Math.abs(tcp.y - piece.top.y) < BLOCK_HALF + TCP_RADIUS
    && tcp.z < piece.top.z - EPS && tcp.z >= piece.top.z - BLOCK_HEIGHT - TCP_RADIUS)
    return "TCP가 물체 내부로 들어갑니다. 물체 윗면 높이에서 멈추도록 좌표와 접근 경로를 수정하세요.";
  return null;
}

/** Z is the top contact face of the block, not its center or the table surface. */
export function designScenario(level: DesignLevel, variant = 0): DesignScenario {
  const v = ((Math.trunc(variant) % 3) + 3) % 3;
  const source = [pose(280, -100, 220), pose(260, -80, 230), pose(290, -90, 215)][v];
  const destination = [pose(280, 80, level === 1 ? 220 : 240),
    pose(300, 60, level === 1 ? 230 : 245), pose(260, 100, level === 1 ? 215 : 235)][v];
  const minimumTravelZ = Math.max(source.z, destination.z) + (level === 1 ? 40 : 55);
  return {
    id: `pickplace-design-${level}-${v}`, level: 1, designLevel: level, variant: v,
    title: ["안내된 기본 이송", "높이·접근 조건 조정", "전체 픽앤플레이스 직접 설계"][level - 1],
    goal: "단일 MG400으로 작업물 한 개를 집어 목표에 놓고 수직으로 후퇴하세요.",
    robots: [{ id: "A", origin: pose(0, 0, 0), yaw: 0, start: pose(250, -150, 300) }],
    source, destination, minimumTravelZ, retreatRise: 35, questions: [],
    orientationTolerance: 2, gripRotationTolerance: 5,
    surfaces: [
      { x: source.x, y: source.y, halfX: 55, halfY: 50, z: source.z - BLOCK_HEIGHT, label: "집기 작업대" },
      { x: destination.x, y: destination.y, halfX: 55, halfY: 50, z: destination.z - BLOCK_HEIGHT, label: "놓기 작업대" },
    ],
  };
}

export function initialDesignFrame(model: LessonModel, scenario: DesignScenario): CellFrame {
  const start = scenario.robots[0].start;
  const joints = model.ik(start.x, start.y, start.z, start.r, -90);
  if (!joints) throw new Error("픽앤플레이스 시작 자세를 계산할 수 없습니다.");
  return {
    atMs: 0, robots: { A: { pose: model.fk(joints), joints } },
    workpieces: [{ id: "single-workpiece", top: { ...scenario.source }, owner: null, placed: false }],
    beltProgress: 0, phase: "시작점 · 작업물 한 개", activeRobot: null, target: null,
  };
}

export function emptyDesignPlan(level: DesignLevel): DesignCommand[] {
  if (level === 3) return [];
  return DESIGN_ROLES.map(({ role, action }, i) => ({
    id: `step-${i + 1}`, role, action, mode: "absolute", motion: i === 0 ? "MoveJ" : "MoveL",
    x: "", y: "", z: "", r: "0", expectedX: "", expectedY: "", expectedZ: "", expectedR: "0",
  }));
}

/** Task goals are NOT program commands. Reveal derived goals only after execution. */
export function designGoal(scenario: DesignScenario, role: DesignRole, travelZ: number): LessonPose | null {
  switch (role) {
    case "approach": case "lift": return { ...scenario.source, z: travelZ };
    case "contact": case "grip": return { ...scenario.source };
    case "transfer": return null; // The student chooses a direct or waypoint route.
    case "above": return { ...scenario.destination, z: travelZ };
    case "lower": case "release": return { ...scenario.destination };
    case "retreat": return { ...scenario.destination, z: scenario.destination.z + scenario.retreatRise };
  }
}

export function validateDesignPlan(commands: DesignCommand[], relations: DesignRelations): string | null {
  if (parseLessonNumber(relations.travelZ) === null) return "운반 높이를 유한한 수로 입력하세요.";
  if (relations.coordinate !== "B=A+Δ" || relations.contact !== "TCP=top"
    || relations.height !== "travelZ>=min" || relations.vertical !== "XY constant")
    return "좌표·접촉점·운반 높이·수직 이동의 관계를 다시 확인하세요.";
  if (commands.length === 0 || commands.length > 30) return "계획을 1~30개 동작으로 구성하세요.";
  if (new Set(commands.map(c => c.id)).size !== commands.length) return "동작 식별자가 중복되었습니다. 계획을 다시 구성하세요.";
  for (const command of commands) {
    const spec = DESIGN_ROLES.find(item => item.role === command.role);
    if (!spec || spec.action !== command.action || !["absolute", "relative"].includes(command.mode)
      || !["MoveJ", "MoveL"].includes(command.motion)) return "동작과 이동 명령의 종류를 확인하세요.";
    if (command.action === "move" && [command.x, command.y, command.z].some(s => parseLessonNumber(s) === null))
      return `${spec.label}: 명령 X·Y·Z를 모두 입력하세요.`;
    if (command.r !== undefined && parseLessonNumber(command.r) === null
      || command.expectedR !== undefined && parseLessonNumber(command.expectedR) === null)
      return `${spec.label}: 명령과 예측의 R(도)을 유한한 수로 입력하세요.`;
    if ([command.expectedX, command.expectedY, command.expectedZ].some(s => parseLessonNumber(s) === null))
      return `${spec.label}: 실행 후 예상 TCP X·Y·Z를 모두 입력하세요.`;
  }
  for (const spec of DESIGN_ROLES) {
    if (!commands.some(c => c.role === spec.role)) return `${spec.label} 동작이 빠졌습니다. 전체 계획을 확인하세요.`;
  }
  if (commands.filter(c => c.action === "grip").length !== 1 || commands.filter(c => c.action === "release").length !== 1)
    return "작업물 한 개의 집기와 놓기는 각각 한 번으로 구성하세요.";
  return null;
}

/**
 * Virtual execution of the STUDENT'S commands. Every observed pose is FK of
 * sampled joints, never a task answer or prediction. No hardware commands,
 * collision certification or fabricated sensor noise.
 */
export function compileDesign(model: LessonModel, scenario: DesignScenario,
  commands: DesignCommand[], relations: DesignRelations): DesignResult {
  const frame = initialDesignFrame(model, scenario);
  const frames: CellFrame[] = [clone(frame)];
  const observations: DesignObservation[] = [];
  const checks: DesignResult["outcome"]["checks"] = [];
  const issues: string[] = [];
  let clock = 0, failure: DesignResult["failure"] = null;
  let gripped = false, released = false, retreated = false, gripRotationOffset = 0;
  const travelZ = parseLessonNumber(relations.travelZ) ?? NaN;
  const emit = (phase: string, event?: string) => {
    frame.atMs = clock; frame.phase = phase; frame.event = event;
    frames.push(clone(frame));
  };
  const fail = (kind: NonNullable<DesignResult["failure"]>, message: string) => {
    failure = kind; issues.push(message); frame.activeRobot = null;
    emit("계획 확인 · " + message, `${kind}-failed`);
  };
  const inputError = validateDesignPlan(commands, relations);
  if (inputError) fail("input", inputError);
  if (!failure && travelZ < scenario.minimumTravelZ - EPS) {
    fail("height", `운반 높이 조건 위반: 최소 Z ${scenario.minimumTravelZ} mm 이상이어야 합니다. 이동을 시작하지 않았습니다.`);
  }
  for (const command of commands) {
    if (failure) break;
    const spec = DESIGN_ROLES.find(item => item.role === command.role)!;
    const robot = frame.robots.A!;
    const from = { ...robot.pose };
    const expected = { ...pose(Number(command.expectedX), Number(command.expectedY), Number(command.expectedZ)), r: Number(command.expectedR ?? 0) };
    const goal = designGoal(scenario, command.role, travelZ);
    let target = { ...from };
    const observe = (commandStatus: NonNullable<DesignObservation["commandStatus"]>) => {
      const actual = clone(frame.robots.A!.pose), predictionError = distance(expected, actual);
      const rotationError = angularError(expected.r, actual.r);
      observations.push({
        commandId: command.id, role: command.role, action: command.action, atMs: clock,
        goal, target: clone(target), expected, actual, commandStatus,
        state: frame.workpieces[0].owner ? "held" : frame.workpieces[0].placed ? "placed" : "free",
        predictionError, rotationError,
      });
      checks.push({ key: command.id, label: `${spec.label} 예상 TCP`, expected: 0,
        actual: predictionError, passed: predictionError <= EPS });
      checks.push({ key: `${command.id}-r`, label: `${spec.label} 예상 방향 R`, expected: 0,
        actual: rotationError, passed: rotationError <= scenario.orientationTolerance });
    };
    if (command.action === "move") {
      const values = { ...pose(Number(command.x), Number(command.y), Number(command.z)), r: Number(command.r ?? 0) };
      target = command.mode === "relative"
        ? { x: from.x + values.x, y: from.y + values.y, z: from.z + values.z, r: from.r + values.r }
        : { ...values };
      if ((released && command.role !== "retreat") || (gripped && ["approach", "contact"].includes(command.role))) {
        fail("sequence", `${spec.label}: 집기 전 접근·접촉, 운반, 놓기, 후퇴의 순서를 확인하세요.`);
        observe("rejected"); break;
      }
      const samples = sampleLessonMotion(model, from, target, command.motion, robot.joints.j3);
      if (!samples) {
        fail("unreachable", `${spec.label}: 입력 위치 또는 중간 경로의 운동학 해가 없습니다. 기준과 이동량을 확인하세요.`);
        observe("rejected");
        break;
      }
      const vertical = ["contact", "lift", "lower", "retreat"].includes(command.role);
      if (vertical && xyDistance(from, target) > EPS) {
        fail("target", `${spec.label}: 수직 이동에서는 X·Y가 유지되어야 합니다. 도착 위치와 변화량을 구분하세요.`);
        observe("rejected");
        break;
      }
      if (["transfer", "above"].includes(command.role) && Math.abs(target.z - from.z) > EPS) {
        fail("height", `${spec.label}: 수평 이송 중에는 Z를 유지하세요. 먼저 수직 상승을 완료하세요.`);
        observe("rejected");
        break;
      }
      if ((command.role === "lift" && !gripped) || (command.role === "retreat" && !released)) {
        fail("sequence", `${spec.label}: ${command.role === "lift" ? "먼저 접촉점에서 집어야" : "목표에 놓고 흡착을 해제해야"} 합니다.`);
        observe("rejected");
        break;
      }
      if (["transfer", "above", "lower"].includes(command.role) && (!gripped || released)) {
        fail("sequence", `${spec.label}: 작업물을 집고 운반하는 순서를 확인하세요.`);
        observe("rejected");
        break;
      }
      const begins = clock;
      frame.activeRobot = "A"; frame.target = { ...target };
      for (let i = 1; i < samples.length; i++) {
        const joints = samples[i].joints, observed = model.fk(joints);
        const previous = frame.robots.A!.pose;
        if (vertical && xyDistance(from, observed) > 0.6) {
          fail("target", `${spec.label}: TCP가 수직선에서 벗어났습니다. MoveJ와 MoveL의 경로 차이를 검토하세요.`);
          break;
        }
        if (gripped && !released && xyDistance(previous, observed) > 0.001
          && observed.z < scenario.minimumTravelZ - EPS) {
          fail("height", `${spec.label}: 작업물을 잡은 수평 이동이 최소 운반 높이보다 낮습니다. 상승과 이송의 관계를 수정하세요.`);
          break;
        }
        const collision = designCollision(scenario, observed, frame);
        if (collision) { fail("collision", `${spec.label}: ${collision}`); break; }
        clock = begins + i * 900 / (samples.length - 1);
        frame.robots.A = { joints: { ...joints }, pose: { ...observed } };
        if (frame.workpieces[0].owner === "A") frame.workpieces[0].top = { ...observed, r: observed.r + gripRotationOffset };
        emit(`${spec.label} · ${command.motion}`);
      }
      if (failure) { observe("interrupted"); break; }
      const actual = frame.robots.A!.pose;
      if (goal && distance(actual, goal) > EPS) {
        if (command.role === "lift" && actual.z < travelZ - EPS) {
          fail("height", "수직 상승이 계획한 운반 높이에 도달하지 못했습니다. 명령 Z와 예상 높이를 비교하세요.");
        } else if (command.role === "retreat"
          && actual.z < scenario.destination.z + scenario.retreatRise - EPS) {
          fail("target", `후퇴 높이가 부족합니다. 놓기 접촉점에서 최소 ${scenario.retreatRise} mm 위로 후퇴하세요.`);
        }
      }
      if (command.role === "retreat" && !failure) retreated = true;
    } else if (command.action === "grip") {
      clock += 250;
      if (released || gripped) fail("sequence", "집기·놓기 순서를 확인하세요.");
      else if (distance(from, scenario.source) > EPS) {
        fail("pickup", "집기 실패: TCP가 물체 윗면 접촉점에 도착하지 않았습니다. 명령 좌표와 물체 위치를 비교하세요.");
      } else if (angularError(from.r, scenario.source.r) > scenario.gripRotationTolerance) {
        fail("orientation", `집기 방향 조건 위반: R은 물체의 표시 방향에서 ${scenario.gripRotationTolerance}° 이내여야 합니다. 공구 방향과 명령 R을 비교하세요.`);
      } else {
        gripped = true; frame.workpieces[0].owner = "A";
        gripRotationOffset = frame.workpieces[0].top.r - from.r;
        emit("집기 완료 · 작업물이 TCP에 붙음", "A-grip");
      }
    } else {
      clock += 250;
      if (!gripped || released) fail("sequence", "놓기 실패: 현재 잡고 있는 작업물이 없습니다. 집기부터 순서를 확인하세요.");
      else {
        released = true; frame.workpieces[0].owner = null;
        const positionOK = distance(from, scenario.destination) <= EPS;
        const directionOK = angularError(frame.workpieces[0].top.r, scenario.destination.r) <= scenario.orientationTolerance;
        frame.workpieces[0].placed = positionOK && directionOK;
        emit("놓기 · 흡착 해제", "A-release");
        if (positionOK && !directionOK)
          fail("orientation", `목표 방향 오차: 놓인 물체 R과 목표 R의 차이가 ${scenario.orientationTolerance}°를 초과합니다. 집기 때의 방향과 운반 중 회전을 함께 비교하세요.`);
        else if (!frame.workpieces[0].placed)
          fail("target", "목표 미도달: 작업물을 놓은 접촉점이 목표 위치와 다릅니다. 목표·내 명령·도달 좌표를 비교하세요.");
      }
    }
    observe(failure ? command.action === "move" ? "interrupted" : "rejected" : "completed");
    if (!failure) { clock += 120; emit(`${spec.label} 확인`, `step:${command.id}`); }
  }
  const finished = !failure && released && retreated && frame.workpieces[0].placed;
  if (!failure && !finished) fail("sequence", "집기·목표 놓기·후퇴까지 전체 계획을 완료하세요.");
  const passed = finished && checks.every(check => check.passed);
  if (finished && !passed) issues.push("작업물 이송은 완료했지만 예상 TCP와 관찰값이 다릅니다. 좌표·변화량 관계와 예측을 수정해 다시 확인하세요.");
  frame.activeRobot = null;
  clock += 180;
  emit(passed ? "픽앤플레이스 완료 · 수직 후퇴" : "실행 결과 비교", passed ? "complete" : "failed");
  return {
    frames, durationMs: clock, observations, failure,
    outcome: {
      finished, passed, completedPieces: frame.workpieces[0].placed ? 1 : 0, totalPieces: 1,
      checks, issues, finalFrame: clone(frame),
      observations: observations.map(item => {
        const at = frames.findLast(f => f.atMs <= item.atMs)!;
        return { robot: "A", target: item.target, observed: item.actual,
          joints: clone(at.robots.A!.joints), error: distance(item.target, item.actual),
          label: DESIGN_ROLES.find(role => role.role === item.role)!.label,
          goal: item.goal ?? undefined, atMs: item.atMs };
      }),
    },
  };
}