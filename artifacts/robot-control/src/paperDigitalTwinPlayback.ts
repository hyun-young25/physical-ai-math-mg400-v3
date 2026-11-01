export type PaperDtPose = { x: number; y: number; z: number; r: number };

export type PaperDtFrameScheduler = {
  requestFrame: (callback: (now: number) => void) => number;
  cancelFrame: (id: number) => void;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (timer: unknown) => void;
  now: () => number;
};

export type PaperDtPlaybackOptions = {
  start: PaperDtPose;
  commands: PaperDtPose[];
  canReach: (pose: PaperDtPose) => boolean;
  moveTo: (pose: PaperDtPose) => void;
  moveEnd: () => void;
  scheduler: PaperDtFrameScheduler;
  segmentDurationMs?: number;
  frameStallTimeoutMs?: number;
};

export const PAPER_DT_FRAME_STALL_TIMEOUT_MS = 12_000;

/**
 * Plays every requested waypoint and returns to the starting pose. A missing
 * animation frame is a failed DT run, not a completed one. All late RAF/timer
 * callbacks become inert as soon as the run settles.
 */
export function startPaperDigitalTwinPlayback(options: PaperDtPlaybackOptions) {
  const {
    start, commands, canReach, moveTo, moveEnd, scheduler,
    segmentDurationMs = 350,
    frameStallTimeoutMs = PAPER_DT_FRAME_STALL_TIMEOUT_MS,
  } = options;
  const targets = [...commands.map(pose => ({ ...pose })), { ...start }];

  let resolveRun!: () => void;
  let rejectRun!: (error: Error) => void;
  let settled = false;
  let frameId: number | null = null;
  let stallTimer: unknown;
  let segmentIndex = 0;
  let segmentStart: number | null = null;
  let from = { ...start };

  const promise = new Promise<void>((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });

  const clearPending = () => {
    if (frameId !== null) {
      scheduler.cancelFrame(frameId);
      frameId = null;
    }
    if (stallTimer !== undefined) {
      scheduler.clearTimer(stallTimer);
      stallTimer = undefined;
    }
  };

  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    clearPending();
    rejectRun(error);
  };

  const finish = () => {
    if (settled) return;
    settled = true;
    clearPending();
    resolveRun();
  };

  const schedule = () => {
    if (settled) return;
    try {
      // Start each segment at scheduling time. If the next RAF is delayed by a
      // low frame rate, that interval still counts toward motion progress.
      if (segmentStart === null) segmentStart = scheduler.now();
      frameId = scheduler.requestFrame(tick);
      stallTimer = scheduler.setTimer(() => {
        fail(new Error(`DT 애니메이션이 ${frameStallTimeoutMs / 1000}초 동안 진행되지 않아 중단했습니다. 이 실행은 완료로 기록되지 않습니다.`));
      }, frameStallTimeoutMs);
    } catch (error) {
      fail(error instanceof Error ? error : new Error("DT 애니메이션 프레임을 예약하지 못했습니다."));
    }
  };

  const tick = (now: number) => {
    if (settled) return;
    frameId = null;
    if (stallTimer !== undefined) {
      scheduler.clearTimer(stallTimer);
      stallTimer = undefined;
    }

    const target = targets[segmentIndex];
    if (!target) {
      finish();
      return;
    }
    const startedAt = segmentStart ?? scheduler.now();
    segmentStart = startedAt;
    const t = Math.min(1, Math.max(0, (now - startedAt) / segmentDurationMs));
    const pose = {
      x: from.x + (target.x - from.x) * t,
      y: from.y + (target.y - from.y) * t,
      z: from.z + (target.z - from.z) * t,
      r: from.r + (target.r - from.r) * t,
    };

    try {
      if (!canReach(pose)) {
        fail(new Error("DT 기구학 검사에서 도달 불가 지점을 확인했습니다."));
        return;
      }
      moveTo(pose);
      if (t >= 1) {
        moveEnd();
        from = target;
        segmentIndex += 1;
        segmentStart = now;
        if (segmentIndex >= targets.length) {
          finish();
          return;
        }
      }
      schedule();
    } catch (error) {
      fail(error instanceof Error ? error : new Error("DT 이동 중 오류가 발생했습니다."));
    }
  };

  schedule();

  return {
    promise,
    cancel(reason = "DT 실행이 중단되었습니다. 완료로 기록하지 않습니다.") {
      fail(new Error(reason));
    },
  };
}
