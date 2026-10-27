/** One approval, one verified virtual completion, at most one physical start.
 * No timers, reconnect handlers or React effects are allowed to start hardware.
 */
export type SquareContinuationPhase = "confirming" | "virtual" | "verified" | "hardware" | "complete" | "cancelled";
export class SquareContinuation {
  phase: SquareContinuationPhase = "confirming";
  reason = "";
  private resolve?: () => void;
  private reject?: (error: Error) => void;
  constructor(readonly key: string, readonly inputKey: string,
    private changed: (phase: SquareContinuationPhase) => void) {}
  private set(phase: SquareContinuationPhase) { this.phase = phase; this.changed(phase); }
  assertCurrent(key: string, inputKey: string) {
    if (this.phase === "cancelled" || this.phase === "complete" || key !== this.key || inputKey !== this.inputKey)
      throw new Error(this.reason || "답안·과제·실행 계획이 변경되어 연속 실행 승인을 폐기했습니다.");
  }
  waitForVirtual(start: () => boolean): Promise<void> {
    if (this.phase !== "confirming") return Promise.reject(new Error("이미 사용한 연속 실행 승인입니다."));
    return new Promise((resolve, reject) => {
      this.resolve = resolve; this.reject = reject; this.set("virtual");
      try { if (!start()) this.cancel("가상 실행을 시작하지 못해 실제 실행을 취소했습니다."); }
      catch (error) { this.cancel(error instanceof Error ? error.message : "가상 실행 시작 실패"); }
    });
  }
  completeVirtual(key: string, closed: boolean, returned: boolean, steps: number, expected: number) {
    if (this.phase !== "virtual") return;
    if (key !== this.key || !closed || !returned || steps !== expected) {
      this.cancel("가상 경로의 완주·닫힘·복귀가 확인되지 않아 실제 실행을 취소했습니다."); return;
    }
    this.set("verified");
    const resolve = this.resolve; this.resolve = undefined; this.reject = undefined; resolve?.();
  }
  beginHardware() {
    if (this.phase !== "verified") throw new Error(this.reason || "이번 경로의 가상 완주 증거가 없습니다.");
    this.set("hardware");
  }
  finish() { if (this.phase === "hardware") this.set("complete"); }
  cancel(reason: string) {
    if (this.phase === "cancelled" || this.phase === "complete") return;
    this.reason = reason; this.set("cancelled");
    const reject = this.reject; this.resolve = undefined; this.reject = undefined;
    reject?.(new Error(reason));
  }
}
