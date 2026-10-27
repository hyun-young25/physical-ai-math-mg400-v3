export const JOG_INTERVAL_MS = 80;
// At the default 50% slider this is 1° per 80 ms (12.5°/s): visible in the
// main twin while remaining controllable. R and J4 both use this exact value.
export const ROTATION_DEGREES_PER_TICK_AT_FULL_SPEED = 2;

export function rotationJogDelta(speedPercent: number, direction: 1 | -1) {
  const speed = Math.max(0, Math.min(100, speedPercent));
  return Number((direction * ROTATION_DEGREES_PER_TICK_AT_FULL_SPEED * speed / 100).toFixed(2));
}

export function armJointJogDelta(speedPercent: number, direction: 1 | -1) {
  const speed = Math.max(0, Math.min(100, speedPercent));
  return Number((direction * 0.5 * speed / 100).toFixed(2));
}
