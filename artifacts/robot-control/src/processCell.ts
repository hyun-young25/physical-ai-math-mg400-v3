import { sampleLessonMotion, type LessonFrame, type LessonJoints, type LessonModel, type LessonPose } from "./curriculum";
import type { CellCompilation, CellFrame, CellLevel, CellOutcome, CellPiece, CellQuestion, CellRobot, CellRobotId, CellScenario } from "./processCellTypes";

export const PROCESS_LEVELS: { level: CellLevel; title: string }[] = [
  { level: 1, title: "작업대 기본 이송" },
  { level: 2, title: "컨베이어에서 집기" },
  { level: 3, title: "두 로봇이 이어받기" },
  { level: 4, title: "이송·포장 공정 완성" },
];

const pose = (x: number, y: number, z = 220, r = 0): LessonPose => ({ x, y, z, r });
const round = (n: number) => Math.round(n * 1e9) / 1e9;
const finitePose = (p: LessonPose) => [p.x, p.y, p.z, p.r].every(Number.isFinite);
const finiteJoints = (j: LessonJoints) => [j.j1, j.j2, j.j3, j.j4].every(Number.isFinite);
const distance = (a: LessonPose, b: LessonPose) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const NEAR = 0.2;
const CLEARANCE = 300;
const angleError = (a: number, b: number) => Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);

/** Origins and yaw describe the displayed lesson coordinate frames, in mm/degrees. */
export function localToWorld(p: LessonPose, robot: CellRobot): LessonPose {
  const a = robot.yaw * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: round(robot.origin.x + c * p.x - s * p.y), y: round(robot.origin.y + s * p.x + c * p.y),
    z: round(robot.origin.z + p.z), r: round(robot.yaw + p.r) };
}

export function worldToLocal(p: LessonPose, robot: CellRobot): LessonPose {
  const a = robot.yaw * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const x = p.x - robot.origin.x, y = p.y - robot.origin.y;
  return { x: round(c * x + s * y), y: round(-s * x + c * y), z: round(p.z - robot.origin.z), r: round(p.r - robot.yaw) };
}

const permutations = (items: number[]): number[][] => items.length
  ? items.flatMap(item => permutations(items.filter(other => other !== item)).map(tail => [item, ...tail])) : [[]];
const PACKING_ORDERS = permutations([1, 2, 3, 4]).map(order => Number(order.join("")));

/** A slot identifies a physical tray cell; its order identifies the supplied block. */
export function processPackingPlan(scenario: CellScenario, answers: Record<string, number>) {
  if (!scenario.tray) return [];
  const tray = scenario.tray, b = scenario.robots.find(robot => robot.id === "B")!;
  const first = worldToLocal(tray.origin, b);
  const order = tray.predictionSlot === undefined ? [0, 1, 2, 3]
    : PACKING_ORDERS.includes(answers.packingOrder) ? String(answers.packingOrder).split("").map(value => Number(value) - 1) : [];
  return order.map((slot, index) => ({ slot, order: index + 1, pieceId: `piece-${index + 1}`,
    goal: worldToLocal(tray.points[slot], b),
    command: { ...first,
      x: slot === tray.predictionSlot ? answers.packingX : first.x + (slot % tray.columns ? slot % tray.columns * answers.columnStep : 0),
      y: slot === tray.predictionSlot ? answers.packingY : first.y + (Math.floor(slot / tray.columns) ? Math.floor(slot / tray.columns) * answers.rowStep : 0),
    },
  }));
}

/** The student's four work points and optional horizontal corner, in robot A's frame. */
export function processTransport(scenario: CellScenario, answers: Record<string, number>) {
  const robot = scenario.robots[0];
  const pick = worldToLocal(scenario.source, robot);
  if (scenario.belt) pick.y = answers.beltY ?? NaN;
  const place = worldToLocal(scenario.destination, robot);
  if (scenario.level === 1) { place.x = answers.targetX ?? NaN; place.y = answers.targetY ?? NaN; }
  const lift = { ...pick, z: answers.travelZ ?? NaN };
  const above = { ...place, x: answers.approachX ?? NaN, y: answers.approachY ?? NaN, z: answers.travelZ ?? NaN };
  const corner = answers.routeChoice === 1 ? { ...lift, x: above.x }
    : answers.routeChoice === 2 ? { ...lift, y: above.y } : undefined;
  const horizontal = [lift, ...(corner ? [corner] : []), above];
  const length = horizontal.slice(1).reduce((sum, p, i) => sum + distance(horizontal[i], p), 0);
  return { pick, lift, above, place, corner, length };
}

export function processScenario(level: CellLevel, variant = 0): CellScenario {
  const v = ((Math.trunc(Number.isFinite(variant) ? variant : 0) % 3) + 3) % 3;
  const a: CellRobot = { id: "A", origin: pose(0, 0, 0), yaw: 0, start: pose(280, -100, 300) };
  const b: CellRobot = { id: "B", origin: pose(650, 0, 0), yaw: 180, start: pose(280, 100, 300) };
  const robots = level >= 3 ? [a, b] : [a];
  const travel = [60, 100, 140][v];
  const belt = level === 2 || level === 4
    ? { from: pose(280, -170), to: pose(280, -170 + travel), travel, speedMmPerSec: [30, 40, 40][v], travelSeconds: [2, 2.5, 3.5][v], width: 62, length: 240 }
    : undefined;
  const source = belt ? { ...belt.to } : pose(280, -100);
  const handoff = level >= 3 ? pose([300, 320, 340][v], [40, 60, 80][v]) : undefined;
  const rowStep = [40, 50, 35][v], columnStep = [40, 45, 50][v];
  // Keep the tray table clear of the conveyor rail and pickup sensor for every
  // pitch variant, while retaining the same reachable B-frame packing pattern.
  const trayLocal = pose(220, 70, 220, -180);
  const tray = level === 4 ? { origin: localToWorld(trayLocal, b), rows: 2, columns: 2, rowStep, columnStep, predictionSlot: 3,
    points: Array.from({ length: 4 }, (_, i) => localToWorld({ ...trayLocal, x: trayLocal.x + i % 2 * columnStep, y: trayLocal.y + Math.floor(i / 2) * rowStep }, b)) } : undefined;
  const destination = tray ? { ...tray.points[0] } : level >= 3 ? localToWorld(pose(270, 100, 220, -180), b) : pose(level === 1 ? [300, 320, 290][v] : 300, [90, 110, 70][v]);
  const questions: CellQuestion[] = [];
  if (level === 1) questions.push({ id: "transfer", title: "이동량으로 목표 찾기", focusRobot: "A", focusPoint: destination, focusLabel: "놓을 지점",
    prompt: "출발 위치에 X·Y 이동량을 각각 더해 놓을 지점을 구하세요. Z는 출발과 같습니다.",
    givens: ["출발: A 기준 (" + source.x + ", " + source.y + ", " + source.z + ") mm",
      "이동량 (ΔX, ΔY, ΔZ) = (+" + (destination.x - source.x) + ", +" + (destination.y - source.y) + ", 0) mm"],
    fields: [
      { key: "targetX", label: "목표 X", unit: "mm", expected: destination.x, hint: "목표 X = 출발 X + 이동량 ΔX" },
      { key: "targetY", label: "목표 Y", unit: "mm", expected: destination.y, hint: "목표 Y = 출발 Y + 이동량 ΔY" },
    ] });
  if (belt) questions.push({ id: "conveyor", title: "속도와 시간으로 집을 위치 예측", focusRobot: "A", focusPoint: source, focusLabel: "벨트 정지 후 집을 지점",
    prompt: "컨베이어의 속도와 운전 시간으로 정지 위치를 예측하세요. 로봇은 정지 신호를 확인한 뒤 내려가 블록을 집습니다.",
    givens: [`벨트 출발: A 기준 (${belt.from.x}, ${belt.from.y}, ${belt.from.z}) mm`, `벨트 속도: +Y 방향 ${belt.speedMmPerSec} mm/s`, `운전 시간: ${belt.travelSeconds} s`, "벨트가 완전히 멈춘 후 로봇이 집습니다."],
    fields: [{ key: "beltY", label: "정지 후 블록 Y", unit: "mm", expected: source.y, hint: "이동 거리 = 속도 × 시간, 정지 Y = 출발 Y + 이동 거리" }] });
  if (handoff) {
    const local = worldToLocal(handoff, b);
    questions.push({ id: "handoff", title: "같은 인계점, 다른 좌표", focusRobot: "B", focusPoint: handoff, focusLabel: "A와 B가 공유하는 인계점",
      prompt: "A가 공용 인계대에 놓은 블록을 B가 집습니다. 인계점의 B 기준 좌표를 구하세요.",
      givens: [`인계점의 A 기준 좌표: (${handoff.x}, ${handoff.y}, ${handoff.z}) mm`, "B의 원점: A 기준 (650, 0, 0) mm", "B의 +X·+Y 방향은 A와 반대입니다. (180° 회전)"],
      fields: [{ key: "handoffX", label: "B 기준 인계점 X", unit: "mm", expected: local.x, hint: "X_B = 650 − X_A" },
        { key: "handoffY", label: "B 기준 인계점 Y", unit: "mm", expected: local.y, hint: "Y_B = −Y_A" },
        { key: "handoffReady", label: "B가 인계대에 진입할 조건", unit: "", expected: 2,
          hint: "블록을 놓았더라도 A가 인계 구역에 남아 있으면 B는 기다려야 합니다.",
          options: [{ value: 0, label: "A가 인계점에 도착하면" }, { value: 1, label: "A가 블록을 놓으면" },
            { value: 2, label: "A가 블록을 놓고 인계 구역을 벗어나면" }] }] });
  }
  if (tray) questions.push({ id: "tray", title: "행·열 규칙으로 네 칸 채우기", focusRobot: "B", focusPoint: tray.origin, focusLabel: "포장 첫 칸",
    prompt: "B 기준에서 행·열 이동량과 칸 4의 좌표를 예측하고, 네 칸을 채울 순서를 정하세요.",
    givens: [`칸 1 (행 0, 열 0): B 기준 (${trayLocal.x}, ${trayLocal.y}, ${trayLocal.z}) mm`, `칸 2 (행 0, 열 1): (${trayLocal.x + columnStep}, ${trayLocal.y}, ${trayLocal.z}) mm`, `칸 3 (행 1, 열 0): (${trayLocal.x}, ${trayLocal.y + rowStep}, ${trayLocal.z}) mm`, "칸 4는 (행 1, 열 1)입니다. Z는 모든 칸에서 같습니다. 각 칸을 한 번씩 채우세요."],
    fields: [{ key: "columnStep", label: "열 하나당 ΔX", unit: "mm", expected: columnStep, hint: "같은 행에서 다음 열의 X − 첫 열의 X" },
      { key: "rowStep", label: "행 하나당 ΔY", unit: "mm", expected: rowStep, hint: "다음 행의 Y − 첫 행의 Y" },
      { key: "packingX", label: "칸 4 · B 기준 X", unit: "mm", expected: trayLocal.x + columnStep, hint: "칸 4는 첫 칸에서 열이 하나 늘어납니다. 첫 칸 X에 열 이동량을 더하세요." },
      { key: "packingY", label: "칸 4 · B 기준 Y", unit: "mm", expected: trayLocal.y + rowStep, hint: "칸 4는 첫 칸에서 행이 하나 늘어납니다. 첫 칸 Y에 행 이동량을 더하세요." },
      { key: "packingOrder", label: "네 칸을 채울 순서", unit: "", expected: 1234, accepted: PACKING_ORDERS,
        hint: "행을 먼저 채우거나 열을 먼저 채워도 됩니다. 네 칸을 중복 없이 한 번씩 선택하세요.",
        sequence: [1, 2, 3, 4].map(value => ({ value, label: `칸 ${value}` })) },
    ] });
  if (level <= 2) questions.push({ id: "transport", title: "높이와 운반 순서 정하기", focusRobot: "A",
    focusPoint: { ...source, z: CLEARANCE }, focusLabel: "들어 올린 뒤의 작업점",
    prompt: "블록을 집은 뒤 위로 올리고, 그 높이에서 목표 위로 이동합니다. 이동 높이와 순서를 정하세요.",
    givens: ["집기 높이 Z = " + source.z + " mm", "들어 올리는 이동량 ΔZ = +" + (CLEARANCE - source.z) + " mm",
      "목표 위에서 원래 높이로 내려가 블록을 놓습니다."],
    fields: [
      { key: "travelZ", label: "들어 올린 뒤 Z", unit: "mm", expected: CLEARANCE, hint: "이동 높이 Z = 집기 높이 Z + 위로 올리는 ΔZ" },
      { key: "transferOrder", label: "집은 뒤 운반 순서", unit: "", expected: 1234,
        hint: "먼저 위로 올려 작업대에서 벗어난 뒤 수평 이동하고, 목표 위에서 내려가 놓습니다.",
        sequence: [
          { value: 2, label: "목표 위로 이동" }, { value: 4, label: "블록 놓기" },
          { value: 1, label: "들어 올리기" }, { value: 3, label: "수직으로 내리기" },
        ] },
    ] });
  if (level <= 2) questions.push({ id: "approach", title: "목표 위 접근점과 경로 정하기", focusRobot: "A",
    focusPoint: { ...destination, z: CLEARANCE }, focusLabel: "P3 · 목표 위 접근점",
    prompt: "P3에서 Z만 바꾸어 P4에 내려가려면 X·Y는 얼마여야 할까요? P2에서 P3로 가는 경로도 정하세요.",
    givens: [level === 1 ? "P4는 앞에서 계산한 놓을 지점입니다." : `P4 놓을 지점: A 기준 (${destination.x}, ${destination.y}, ${destination.z}) mm`,
      "P2와 P3의 Z는 내가 계산한 운반 높이입니다.", "직선과 축별 이동 모두 가능합니다. 도착점이 같아도 경로 길이는 달라집니다."],
    fields: [
      { key: "approachX", label: "P3 목표 위 X", unit: "mm", expected: destination.x, hint: "수직 하강은 Z만 바뀌므로 P3의 X는 P4의 X와 같습니다." },
      { key: "approachY", label: "P3 목표 위 Y", unit: "mm", expected: destination.y, hint: "P3의 Y도 P4의 Y와 같아야 수직으로 내려갑니다." },
      { key: "routeChoice", label: "P2 → P3 수평 경로", unit: "", expected: 0, accepted: [0, 1, 2],
        hint: "직선은 √(ΔX²+ΔY²), 축별 이동은 |ΔX|+|ΔY|입니다. 운반 높이는 유지합니다.",
        options: [{ value: 0, label: "X·Y를 함께 바꾸어 직선 이동" },
          { value: 1, label: "X를 먼저 바꾼 뒤 Y 이동" }, { value: 2, label: "Y를 먼저 바꾼 뒤 X 이동" }] },
    ] });
  return { id: `cell-${level === 4 ? "v5" : "v4"}-${level}-${v}`, level, variant: v, title: PROCESS_LEVELS.find(x => x.level === level)!.title,
    goal: ["출발 좌표와 이동량을 더해 블록을 목표에 놓습니다.", "속도·시간으로 위치를 예측하고 정지 신호 후 블록을 집습니다.", "두 좌표계와 인계 조건을 연결해 두 로봇이 블록을 이어받습니다.", "공급·인계·포장을 동시에 이어 가며 2×2 트레이를 채웁니다."][level - 1],
    robots, source, destination, belt, handoff, tray, questions };
}

function verifiedPose(model: LessonModel, target: LessonPose, hint = -90): LessonFrame {
  if (!finitePose(target)) throw new Error("로봇 시작 좌표가 유한한 수가 아닙니다.");
  const joints = model.ik(target.x, target.y, target.z, target.r, hint);
  if (!joints || !finiteJoints(joints)) throw new Error("로봇 시작 자세의 역기구학 해를 찾을 수 없습니다.");
  const actual = model.fk(joints);
  if (!finitePose(actual) || distance(actual, target) > NEAR || angleError(actual.r, target.r) > NEAR)
    throw new Error("시작 자세를 순기구학으로 확인한 좌표가 목표와 다릅니다.");
  return { joints: { ...joints }, pose: { ...actual } };
}

export function initialProcessFrame(model: LessonModel, scenario: CellScenario): CellFrame {
  const robots: CellFrame["robots"] = {};
  for (const robot of scenario.robots) robots[robot.id] = verifiedPose(model, robot.start);
  return { atMs: 0, robots, workpieces: [{ id: "piece-1", top: { ...(scenario.belt?.from ?? scenario.source) }, owner: null, placed: false }],
    beltProgress: 0, phase: "공정 준비", activeRobot: null, target: null,
    processStatus: { feed: scenario.belt ? "공급 대기" : "블록 준비", A: "대기", ...(scenario.robots.length > 1 ? { B: "인계 대기" } : {}),
      handoff: "empty", completed: 0, total: scenario.tray ? scenario.tray.rows * scenario.tray.columns : 1 } };
}

function snapshot(frame: CellFrame): CellFrame {
  const robots: CellFrame["robots"] = {};
  for (const id of ["A", "B"] as const) {
    const robot = frame.robots[id];
    if (robot) robots[id] = { joints: { ...robot.joints }, pose: { ...robot.pose } };
  }
  return { ...frame, ...(frame.eventPoint ? { eventPoint: { ...frame.eventPoint } } : {}),
    ...(frame.eventGoal ? { eventGoal: { ...frame.eventGoal } } : {}), robots,
    processStatus: frame.processStatus && { ...frame.processStatus }, events: frame.events && [...frame.events],
    workpieces: frame.workpieces.map(piece => ({ ...piece, top: { ...piece.top } })), target: frame.target && { ...frame.target } };
}

/** Three deterministic workflows share a clock: feeder, A and (when present) B.
 * A motion sample always stores FK(joints), including frames where another task moves.
 * The handoff lock covers approach, release/pick and lateral clearance; it is not a
 * general full-arm collision detector. No commands are sent to physical hardware.
 */
export function compileProcess(model: LessonModel, scenario: CellScenario, answers: Record<string, number>): CellCompilation {
  const state = initialProcessFrame(model, scenario);
  const packing = processPackingPlan(scenario, answers);
  if (packing.length) state.workpieces[0].traySlot = packing[0].slot;
  const starts = snapshot(state), frames: CellFrame[] = [snapshot(state)];
  const issues: string[] = [], observations: CellOutcome["observations"] = [];
  const checks = scenario.questions.flatMap(question => question.fields.map(field => ({ key: field.key, label: field.label,
    expected: field.expected, actual: answers[field.key], passed: Number.isFinite(answers[field.key]) &&
      (field.accepted ? field.accepted.includes(answers[field.key])
        : field.options || field.sequence ? answers[field.key] === field.expected : Math.abs(answers[field.key] - field.expected) <= NEAR) })));
  const totalPieces = scenario.tray ? scenario.tray.rows * scenario.tray.columns : 1;
  const status = state.processStatus!;
  let clock = 0, finished = true, failed = false, readyPiece = -1;
  const stopped = new Set<number>();
  const emit = (event?: string, robot?: CellRobotId, point?: LessonPose, goal?: LessonPose, piece?: CellPiece) => {
    if (piece) state.eventPieceId = piece.id; else delete state.eventPieceId;
    if (piece?.traySlot !== undefined) state.eventTraySlot = piece.traySlot; else delete state.eventTraySlot;
    state.atMs = round(clock); state.event = event; state.events = event ? [event] : undefined;
    // Concurrent flows may change activeRobot while another robot finishes a contact.
    if (robot && point) { state.eventRobot = robot; state.eventPoint = { ...point }; }
    else { delete state.eventRobot; delete state.eventPoint; }
    if (goal) state.eventGoal = { ...goal }; else delete state.eventGoal;
    status.completed = state.workpieces.filter(piece => piece.placed).length;
    frames.push(snapshot(state));
  };
  const fail = (message: string) => { if (!issues.includes(message)) issues.push(message); failed = true; };
  const robotById = (id: CellRobotId) => scenario.robots.find(robot => robot.id === id)!;
  const travelHeight = scenario.level <= 2 ? answers.travelZ : CLEARANCE;
  const transport = scenario.level <= 2 ? processTransport(scenario, answers) : null;
  const high = (p: LessonPose) => ({ ...p, z: travelHeight });
  const worldTcp = (id: CellRobotId) => localToWorld(state.robots[id]!.pose, robotById(id));
  const activity = (id: CellRobotId, phase: string, target?: LessonPose) => {
    status[id] = phase; state.phase = scenario.level === 4 ? "공급·인계·포장 진행 중" : `${id} · ${phase}`; state.activeRobot = id;
    state.target = target ? localToWorld(target, robotById(id)) : null;
  };
  type Action = { samples: { at: number; apply: () => void }[] } | { until: () => boolean };
  type Flow = Generator<Action, void, unknown>;
  const delay = (ms: number): Action => ({ samples: [{ at: ms, apply() {} }] });
  const wait = (until: () => boolean): Action => ({ until });
  function* move(id: CellRobotId, target: LessonPose, phase: string, record = false, goal?: LessonPose, piece?: CellPiece): Flow {
    const current = state.robots[id]!;
    if (!finitePose(target)) { fail(`${id}: 입력 좌표에 빠진 값이나 유한하지 않은 수가 있습니다.`); return; }
    const sampled = sampleLessonMotion(model, current.pose, target, "MoveL", current.joints.j3);
    if (!sampled) { fail(`${id}: 입력 좌표까지 연결되는 역기구학 해가 없습니다. 좌표와 기준 원점을 확인하세요.`); return; }
    const actual = sampled.map(frame => ({ joints: frame.joints, pose: model.fk(frame.joints) }));
    if (actual.some((frame, i) => !finiteJoints(frame.joints) || !finitePose(frame.pose) || distance(frame.pose, sampled[i].pose) > NEAR || angleError(frame.pose.r, sampled[i].pose.r) > NEAR)) {
      fail(`${id}: 계산한 관절각을 FK로 확인했을 때 요청 경로와 일치하지 않습니다.`); return;
    }
    if (scenario.handoff && status.handoff !== id && actual.some(frame => {
      const tcp = localToWorld(frame.pose, robotById(id));
      return Math.abs(tcp.x - scenario.handoff!.x) <= 55 && Math.abs(tcp.y - scenario.handoff!.y) <= 55;
    })) {
      fail(`${id}: 입력한 이동 경로가 인계 구역을 가로지릅니다. 좌표·행열 간격을 수정해 작업 구역을 분리하세요.`);
      emit("handoff-path-blocked", id, worldTcp(id)); return;
    }
    activity(id, phase, target);
    const duration = Math.max(260, Math.min(1000, distance(current.pose, target) * 5));
    yield { samples: actual.slice(1).map((frame, i) => ({ at: duration * (i + 1) / (actual.length - 1), apply() {
      state.robots[id] = { pose: { ...frame.pose }, joints: { ...frame.joints } };
      for (const piece of state.workpieces) if (piece.owner === id) piece.top = localToWorld(frame.pose, robotById(id));
    } })) };
    if (record) {
      const observed = state.robots[id]!;
      observations.push({ robot: id, target: { ...target }, observed: { ...observed.pose }, joints: { ...observed.joints }, error: distance(target, observed.pose), label: phase, goal: goal && { ...goal }, atMs: round(clock), pieceId: piece?.id, traySlot: piece?.traySlot });
    }
  }
  function* grip(id: CellRobotId, piece: CellPiece): Flow {
    activity(id, "블록 집기", state.robots[id]!.pose);
    yield delay(350);
    if (piece.owner !== null || piece.placed || state.workpieces.some(other => other.owner === id) || distance(worldTcp(id), piece.top) > NEAR) {
      fail(`${id}: 입력한 집기 위치가 실제 블록 위치와 다릅니다. ${id === "B" ? "인계점의 B 기준 좌표" : scenario.belt ? "속도 × 시간으로 구한 정지 후 Y 좌표" : "출발 좌표"}를 다시 확인하세요.`);
      emit("grip-miss", id, worldTcp(id), piece.top, piece); return;
    }
    const contact = { ...piece.top };
    piece.owner = id; piece.top = worldTcp(id); emit(`${id}-grip`, id, worldTcp(id), contact, piece);
  }
  function* release(id: CellRobotId, piece: CellPiece, expected: LessonPose, final: boolean): Flow {
    if (piece.owner !== id) { fail(`${id}: 집지 않은 블록을 놓을 수 없습니다.`); return; }
    activity(id, final ? "트레이·목표에 놓기" : "인계대에 놓기", state.robots[id]!.pose);
    yield delay(400);
    piece.top = worldTcp(id); piece.owner = null;
    const hit = distance(piece.top, expected) <= NEAR;
    if (!hit) fail(`${id}: 블록을 놓은 위치가 ${scenario.tray ? "지정된 트레이 칸" : "목표 위치"}과 다릅니다. ${scenario.tray ? "행·열 이동량과 해당 칸의 좌표" : "목표 좌표"}을 수정하세요.`);
    piece.placed = final && hit;
    emit(final ? hit ? "placed" : "place-miss" : "handoff-release", id, worldTcp(id), expected, piece);
  }
  function* returnRobot(id: CellRobotId): Flow {
    const initial = starts.robots[id]!, current = state.robots[id]!;
    if (distance(current.pose, initial.pose) > NEAR || angleError(current.pose.r, initial.pose.r) > NEAR) {
      // Recovery has a known valid height, independent of a mistaken prediction.
      yield* move(id, { ...current.pose, z: CLEARANCE }, "수직으로 물러나기");
      yield* move(id, { ...initial.pose, z: CLEARANCE }, "시작 위치로 복귀");
      yield* move(id, initial.pose, "시작 자세 복귀");
    }
    // Keep a real failed recovery visible instead of teleporting to the start.
    if (distance(state.robots[id]!.pose, initial.pose) > NEAR || angleError(state.robots[id]!.pose.r, initial.pose.r) > NEAR) { finished = false; return; }
    state.robots[id] = { pose: { ...initial.pose }, joints: { ...initial.joints } };
    for (const piece of state.workpieces) if (piece.owner === id) piece.top = worldTcp(id);
    delete status[id === "A" ? "APiece" : "BPiece"];
    status[id] = "시작 자세 대기"; emit(`${id}-returned`);
  }
  function* feeder(): Flow {
    const belt = scenario.belt!;
    for (let index = 0; index < totalPieces; index++) {
      if (index > 0) {
        yield wait(() => state.workpieces[index - 1].owner !== null || state.workpieces[index - 1].placed);
        state.workpieces.push({ id: `piece-${index + 1}`, top: { ...belt.from }, owner: null, placed: false, ...(packing[index] ? { traySlot: packing[index].slot } : {}) });
        state.beltProgress = 0; emit("feed");
      }
      const piece = state.workpieces[index];
      status.feed = `블록 ${index + 1} 이동`;
      yield { samples: Array.from({ length: 120 }, (_, i) => ({ at: belt.travelSeconds * 1000 * (i + 1) / 120, apply() {
        const t = (i + 1) / 120;
        state.beltProgress = t;
        piece.top = { ...belt.from, x: belt.from.x + (belt.to.x - belt.from.x) * t,
          y: belt.from.y + (belt.to.y - belt.from.y) * t, z: belt.from.z + (belt.to.z - belt.from.z) * t };
      } })) };
      status.feed = `블록 ${index + 1} 정지`; stopped.add(index); emit("belt-stopped", undefined, undefined, undefined, piece);
      emit("belt-ready");
      yield wait(() => piece.owner !== null || piece.placed);
    }
    status.feed = "공급 완료";
  }
  function* pick(id: CellRobotId, piece: CellPiece, target: LessonPose, index: number): Flow {
    yield* move(id, high(state.robots[id]!.pose), "안전 높이로 올리기");
    if (id === "A" && scenario.handoff && index > 0) {
      // Exit along the outer edge before turning toward the next pickup.
      const outer = worldTcp(id), next = localToWorld(target, robotById(id));
      yield* move(id, worldToLocal({ ...outer, y: next.y, z: CLEARANCE }, robotById(id)), "다음 블록으로 이동");
    }
    yield* move(id, high(target), "집기 위치 위로 이동");
    if (id === "A" && scenario.belt && !stopped.has(index)) {
      activity(id, "벨트 정지 신호 대기"); emit("wait-belt");
      yield wait(() => stopped.has(index));
    }
    yield* move(id, target, "블록으로 수직 하강", true, worldToLocal(id === "B" ? scenario.handoff! : scenario.source, robotById(id)), piece);
    yield* grip(id, piece);
    yield* move(id, high(target), "블록 들어 올리기", !!transport,
      transport ? { ...worldToLocal(scenario.source, robotById(id)), z: CLEARANCE } : undefined);
    if (transport && !failed) emit("A-lifted", id, worldTcp(id), localToWorld(transport.lift, robotById(id)));
  }
  function* place(id: CellRobotId, piece: CellPiece, target: LessonPose, expected: LessonPose, final: boolean): Flow {
    if (id === "B" && scenario.handoff) {
      const outer = worldTcp(id), next = localToWorld(target, robotById(id));
      yield* move(id, worldToLocal({ ...outer, y: next.y, z: CLEARANCE }, robotById(id)), "인계대 바깥으로 포장 이송");
    }
    if (transport?.corner) {
      yield* move(id, transport.corner, answers.routeChoice === 1 ? "X 먼저 경유" : "Y 먼저 경유", true);
      if (failed) return;
      emit("A-corner", id, worldTcp(id), localToWorld(transport.corner, robotById(id)));
    }
    yield* move(id, transport?.above ?? high(target), final ? "목표 위로 이동" : "인계대 위로 이동", !!transport,
      transport ? { ...worldToLocal(expected, robotById(id)), z: CLEARANCE } : undefined);
    if (transport && !failed) emit("A-above", id, worldTcp(id), localToWorld(transport.above, robotById(id)));
    const world = localToWorld(target, robotById(id));
    if (state.workpieces.some(other => other.id !== piece.id && other.placed && Math.abs(other.top.x - world.x) < 24 && Math.abs(other.top.y - world.y) < 24 && Math.abs(other.top.z - world.z) < 20)) {
      fail(`${id}: 입력한 행·열 이동량으로는 이미 채운 칸과 블록이 겹칩니다. 간격을 수정하세요.`); return;
    }
    yield* move(id, target, "놓을 위치로 수직 하강", true, worldToLocal(expected, robotById(id)), piece);
    if (!final && answers.handoffReady === 0) {
      activity("A", "인계 조건 확인 필요");
      fail("A의 도착만으로 B가 들어갈 수 없습니다. A가 블록을 놓고 인계 구역을 벗어나야 합니다."); emit("handoff-blocked", id, worldTcp(id), undefined, piece); return;
    }
    yield* release(id, piece, expected, final);
    if (!final && answers.handoffReady !== 2) {
      activity("A", "인계 구역 안 · B 진입 보류");
      fail("블록을 놓아도 A가 인계 구역에 남아 있습니다. A의 구역 이탈까지 확인한 뒤 B가 진입해야 합니다."); emit("handoff-blocked", id, worldTcp(id), undefined, piece); return;
    }
    yield* move(id, high(target), "블록 위에서 물러나기");
  }
  function* clearHandoff(id: CellRobotId, piece: CellPiece): Flow {
    const clear = { ...scenario.handoff!, x: scenario.handoff!.x + (id === "A" ? -90 : 90), z: CLEARANCE };
    yield* move(id, worldToLocal(clear, robotById(id)), "인계 구역에서 물러나기");
    status.handoff = id === "A" ? "ready" : "empty";
    emit(`${id}-cleared`, id, worldTcp(id), undefined, piece);
  }
  function* robotA(): Flow {
    for (let index = 0; index < totalPieces; index++) {
      if (!state.workpieces[index]) { activity("A", "다음 블록 공급 대기"); yield wait(() => !!state.workpieces[index]); }
      status.APiece = index + 1;
      const piece = state.workpieces[index], target = worldToLocal(scenario.source, robotById("A"));
      if (scenario.belt) target.y = answers.beltY;
      yield* pick("A", piece, target, index);
      const expected = scenario.handoff ?? scenario.destination, destination = worldToLocal(expected, robotById("A"));
      if (scenario.level === 1) { destination.x = answers.targetX; destination.y = answers.targetY; }
      if (scenario.handoff) {
        if (status.handoff !== "empty") { activity("A", "인계대 사용 대기"); emit("A-wait-handoff"); yield wait(() => status.handoff === "empty"); }
        status.handoff = "A"; emit("A-enter-handoff");
      }
      yield* place("A", piece, destination, expected, !scenario.handoff);
      if (scenario.handoff) { yield* clearHandoff("A", piece); readyPiece = index; }
    }
    yield* returnRobot("A");
  }
  function* robotB(): Flow {
    for (let index = 0; index < totalPieces; index++) {
      status.BPiece = index + 1;
      activity("B", "인계 완료·A 이탈 대기");
      yield wait(() => readyPiece === index && status.handoff === "ready");
      status.handoff = "B"; emit("B-enter-handoff");
      const piece = state.workpieces[index], target = worldToLocal(scenario.handoff!, robotById("B"));
      target.x = answers.handoffX; target.y = answers.handoffY;
      yield* pick("B", piece, target, index);
      yield* clearHandoff("B", piece);
      const plan = packing[index];
      const expected = plan ? scenario.tray!.points[plan.slot] : scenario.destination;
      const destination = plan ? plan.command : worldToLocal(expected, robotById("B"));
      yield* place("B", piece, destination, expected, true);
    }
    yield* returnRobot("B");
  }
  function run(flows: Flow[], recovery = false) {
    const tasks = flows.map(flow => ({ flow, action: null as Action | null, sample: 0, since: clock, done: false }));
    for (let guard = 0; guard < 100000 && tasks.some(task => !task.done); guard++) {
      if (failed && !recovery) return;
      // Resume only at action boundaries. All updates at an equal timestamp are
      // applied together, then a deep snapshot records both concurrent robots.
      for (const task of tasks) {
        if (task.done) continue;
        if (task.action && "until" in task.action) {
          if (!task.action.until()) continue;
          task.action = null;
        }
        if (!task.action) {
          const next = task.flow.next();
          if (failed && !recovery) return;
          task.done = !!next.done; task.action = next.done ? null : next.value as Action;
          task.sample = 0; task.since = clock;
        }
      }
      const timed = tasks.filter(task => task.action && "samples" in task.action);
      if (!timed.length) {
        if (tasks.every(task => task.done)) return;
        if (tasks.some(task => task.action && "until" in task.action && task.action.until())) continue;
        fail("공정 인계 조건이 충족되지 않아 대기 상태에서 멈췄습니다."); return;
      }
      clock = Math.min(...timed.map(task => task.since + (task.action as Exclude<Action, { until: unknown }>).samples[task.sample].at));
      for (const task of timed) {
        const action = task.action as Exclude<Action, { until: unknown }>;
        const sample = action.samples[task.sample];
        if (Math.abs(task.since + sample.at - clock) < 1e-7) {
          sample.apply(); task.sample++;
          if (task.sample === action.samples.length) task.action = null;
        }
      }
      emit();
    }
  }
  if (checks.some(check => !Number.isFinite(check.actual))) fail("모든 좌표와 이동량을 입력하고 인계 조건을 선택하세요.");
  if (!failed && scenario.tray && packing.length !== totalPieces) {
    fail("포장할 네 칸을 한 번씩 선택해 순서를 완성하세요. 이동을 시작하지 않았습니다.");
    emit("plan-blocked");
  }
  if (!failed && scenario.level <= 2 && answers.transferOrder !== 1234) {
    fail("운반 순서를 확인하세요. 집은 뒤 들어 올리고 → 수평 이동하고 → 내린 뒤 놓아야 합니다. 선택한 순서는 실행 전에 중단했습니다.");
    emit("plan-blocked");
  }
  if (!failed && scenario.level <= 2 && travelHeight < Math.max(scenario.source.z, scenario.destination.z) + 20) {
    fail("입력한 이동 높이가 작업면에 너무 가깝습니다. 집기 높이에 위로 올리는 ΔZ를 더하세요. 이동을 시작하지 않았습니다.");
    emit("height-blocked");
  }
  if (!failed && transport && (![0, 1, 2].includes(answers.routeChoice)
    || Math.hypot(transport.above.x - transport.place.x, transport.above.y - transport.place.y) > NEAR)) {
    fail("P3와 P4의 X·Y가 다르면 수직으로 내려갈 수 없습니다. 목표 위 접근점과 놓을 지점의 X·Y를 맞추고 수평 경로를 선택하세요.");
    emit("approach-blocked");
  }
  if (!failed) run([...(scenario.belt ? [feeder()] : []), robotA(), ...(scenario.handoff ? [robotB()] : [])]);
  if (failed) {
    status.feed = "공정 중지";
    for (const robot of scenario.robots) run([returnRobot(robot.id)], true);
  }
  const completedPieces = state.workpieces.filter(piece => piece.placed).length;
  const passed = finished && !failed && completedPieces === totalPieces && checks.every(check => check.passed);
  state.phase = passed ? "공정 완료 · 시작 자세 복귀" : "실행 결과 확인 · 입력 수정";
  state.activeRobot = null; state.target = null;
  clock += 350; emit(passed ? "complete" : "failed");
  return { frames, durationMs: round(clock), outcome: { finished, passed, completedPieces, totalPieces, checks, issues, finalFrame: snapshot(state), observations } };
}
