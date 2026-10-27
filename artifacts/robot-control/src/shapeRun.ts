export interface ShapeJoints { j1: number; j2: number; j3: number; j4: number; }
export interface ShapeCoords { x: number; y: number; z: number; r: number; }

/** Keep displayed and model poses separately: the MG400 home display is calibrated. */
export interface ShapePoseSnapshot {
  joints: ShapeJoints;
  coords: ShapeCoords;
  displayJoints?: ShapeJoints;
}

export type ShapeRunPhase = "idle" | "approach" | "drawing" | "returning" | "complete";

/** DT teaching speeds, independent of hardware command speeds. */
export const SHAPE_TCP_SPEED_MM_S = 90;
export const SHAPE_JOINT_SPEED_DEG_S = 60;
const EASE_PEAK = 1.5;
const smoothProgress = (t: number) => t * t * (3 - 2 * t);
const jointDistance = (a: ShapeJoints, b: ShapeJoints) => Math.max(
  ...(["j1", "j2", "j3", "j4"] as const).map(axis => Math.abs(b[axis] - a[axis])),
);
const interpolateJoints = (a: ShapeJoints, b: ShapeJoints, t: number): ShapeJoints => ({
  j1: a.j1 + (b.j1 - a.j1) * t, j2: a.j2 + (b.j2 - a.j2) * t,
  j3: a.j3 + (b.j3 - a.j3) * t, j4: a.j4 + (b.j4 - a.j4) * t,
});

type ShapeMotionSample = { progress: number; elapsedMs: number; joints: ShapeJoints };
export interface ShapeMotion {
  durationMs: number;
  samples: ShapeMotionSample[];
  jointsAt: (progress: number, hintJ3: number) => ShapeJoints | null;
}

/** Keep the geometric path unchanged; slow locally where IK needs a large joint motion. */
export function prepareShapeMotion(
  from: ShapeCoords, fromJoints: ShapeJoints, to: ShapeCoords,
  type: "MoveJ" | "MoveL" | "MoveC", via: ShapeCoords | undefined,
  ik: (x: number, y: number, z: number, r: number, hintJ3: number) => ShapeJoints | null,
  fk: (joints: ShapeJoints) => ShapeCoords,
): ShapeMotion | null {
  const endJoints = ik(to.x, to.y, to.z, to.r, fromJoints.j3);
  if (!endJoints) return null;
  let pointAt = (t: number): ShapeCoords => ({
    x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t, r: from.r + (to.r - from.r) * t,
  });
  if (type === "MoveC" && via) {
    const a = from, b = via, c = to;
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) >= 1e-6) {
      const aa = a.x ** 2 + a.y ** 2, bb = b.x ** 2 + b.y ** 2, cc = c.x ** 2 + c.y ** 2;
      const x = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d;
      const y = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d;
      const radius = Math.hypot(a.x - x, a.y - y), start = Math.atan2(a.y - y, a.x - x);
      const norm = (angle: number) => ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const clockwise = norm(start - Math.atan2(c.y - y, c.x - x));
      const sweep = norm(start - Math.atan2(b.y - y, b.x - x)) <= clockwise + 1e-6 ? -clockwise : 2 * Math.PI - clockwise;
      pointAt = t => t === 0 ? { ...from } : t === 1 ? { ...to } : ({
        x: x + radius * Math.cos(start + sweep * t), y: y + radius * Math.sin(start + sweep * t),
        z: from.z + (to.z - from.z) * t, r: from.r + (to.r - from.r) * t,
      });
    }
  }
  const jointsAt = (t: number, hintJ3: number) => {
    if (t === 0) return { ...fromJoints };
    if (type === "MoveJ") return interpolateJoints(fromJoints, endJoints, t);
    const p = pointAt(t);
    return ik(p.x, p.y, p.z, p.r, hintJ3);
  };
  // A wrapped IK branch must not turn an approach into an almost full revolution.
  if (type === "MoveJ" && Math.abs(endJoints.j1 - fromJoints.j1) > 180) return null;
  const samples: ShapeMotionSample[] = [{ progress: 0, elapsedMs: 0, joints: { ...fromJoints } }];
  let previousPoint = { ...from }, elapsedMs = 0;
  for (let index = 1; index <= 256; index++) {
    const progress = index / 256, previous = samples[index - 1];
    const joints = jointsAt(progress, previous.joints.j3);
    if (!joints || !Object.values(joints).every(Number.isFinite) || jointDistance(previous.joints, joints) > 180) return null;
    const point = type === "MoveJ" ? fk(joints) : pointAt(progress);
    const distance = Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y, point.z - previousPoint.z);
    // Smoothstep's peak derivative is 1.5: reserve that headroom before easing.
    elapsedMs += EASE_PEAK * 1000 * Math.max(distance / SHAPE_TCP_SPEED_MM_S,
      jointDistance(previous.joints, joints) / SHAPE_JOINT_SPEED_DEG_S, 0.3 / 256);
    samples.push({ progress, elapsedMs, joints });
    previousPoint = point;
  }
  return { durationMs: elapsedMs, samples, jointsAt };
}

export function sampleShapeMotion(motion: ShapeMotion, elapsedMs: number) {
  const time = Math.max(0, Math.min(elapsedMs / motion.durationMs, 1));
  if (time === 1) return { joints: { ...motion.samples.at(-1)!.joints }, done: true };
  const distanceTime = smoothProgress(time) * motion.durationMs;
  const index = motion.samples.findIndex(sample => sample.elapsedMs >= distanceTime);
  if (index <= 0) return { joints: { ...motion.samples[0].joints }, done: false };
  const a = motion.samples[index - 1], b = motion.samples[index];
  const fraction = (distanceTime - a.elapsedMs) / (b.elapsedMs - a.elapsedMs);
  const progress = a.progress + (b.progress - a.progress) * fraction;
  return { joints: motion.jointsAt(progress, a.joints.j3), done: false };
}

export interface ShapeClosure {
  closed: boolean;
  positionErrorMm: number | null;
  rotationErrorDeg: number | null;
}

/** A completed command list does not by itself prove that the measured path closed. */
export function measureShapeClosure(start: ShapeCoords | undefined, end: ShapeCoords): ShapeClosure {
  if (!start || ![...Object.values(start), ...Object.values(end)].every(Number.isFinite)) {
    return { closed: false, positionErrorMm: null, rotationErrorDeg: null };
  }
  const positionErrorMm=Math.hypot(end.x-start.x,end.y-start.y,end.z-start.z);
  const rotationErrorDeg=Math.abs(((end.r-start.r+180)%360+360)%360-180);
  // Match the model's 0.1 mm coordinate rounding while comparing measured P1 to measured endpoint.
  return { closed: positionErrorMm <= 0.15 && rotationErrorDeg <= 0.01, positionErrorMm, rotationErrorDeg };
}

export function copyShapePose(pose: ShapePoseSnapshot): ShapePoseSnapshot {
  return {
    joints: { ...pose.joints },
    coords: { ...pose.coords },
    ...(pose.displayJoints ? { displayJoints: { ...pose.displayJoints } } : {}),
  };
}

export interface ShapeReturn {
  initialPose: ShapePoseSnapshot;
  fromJoints: ShapeJoints;
  closedAt: ShapeCoords;
  observedPath: ShapeCoords[];
  closure: ShapeClosure;
  startedAt: number | null;
  durationMs: number;
}

/** Freeze drawing evidence before any return movement; never solve IK for the saved posture. */
export function prepareShapeReturn(initialPose: ShapePoseSnapshot, fromJoints: ShapeJoints, closedAt: ShapeCoords, observedPath: ShapeCoords[], fk?: (joints: ShapeJoints) => ShapeCoords): ShapeReturn {
  let durationMs = Math.max(900, EASE_PEAK * 1000 * jointDistance(fromJoints, initialPose.joints) / SHAPE_JOINT_SPEED_DEG_S);
  if (fk) {
    let previous = fk(fromJoints);
    for (let index = 1; index <= 256; index++) {
      const point = fk(interpolateJoints(fromJoints, initialPose.joints, index / 256));
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
      durationMs = Math.max(durationMs, EASE_PEAK * 1000 * 256 * distance / SHAPE_TCP_SPEED_MM_S);
      previous = point;
    }
  }
  return {
    initialPose: copyShapePose(initialPose), fromJoints: { ...fromJoints },
    closedAt: { ...closedAt }, observedPath: observedPath.map(point => ({ ...point })),
    closure: measureShapeClosure(observedPath[0], closedAt),
    startedAt: null,
    durationMs,
  };
}

export function sampleShapeReturn(state: ShapeReturn, time: number, durationMs = state.durationMs) {
  state.startedAt ??= time;
  const progress = Math.max(0, Math.min((time - state.startedAt) / durationMs, 1));
  const from = state.fromJoints, to = state.initialPose.joints, eased = smoothProgress(progress);
  // Assign the saved values at the endpoint rather than accumulating frame deltas.
  const joints = progress === 1 ? { ...to } : {
    j1: from.j1 + (to.j1 - from.j1) * eased,
    j2: from.j2 + (to.j2 - from.j2) * eased,
    j3: from.j3 + (to.j3 - from.j3) * eased,
    j4: from.j4 + (to.j4 - from.j4) * eased,
  };
  return { joints, done: progress === 1 };
}

/** A cancelled callback cannot move a reset robot or step a later execution. */
export class ShapeFrameScheduler {
  private generation = 0;
  private pending: number | null = null;

  constructor(private request: (callback: FrameRequestCallback) => number, private cancelFrame: (id: number) => void) {}

  schedule(callback: FrameRequestCallback) {
    this.cancel();
    const generation = this.generation;
    this.pending = this.request(time => {
      if (generation !== this.generation) return;
      this.pending = null;
      callback(time);
    });
  }

  cancel() {
    this.generation++;
    if (this.pending !== null) this.cancelFrame(this.pending);
    this.pending = null;
  }
}
