import type { LessonJoints, LessonPose } from "./curriculum";

export const MG400_ROBOT_IP = "192.168.1.6";

export type PracticeMode = "virtual" | "hardware";
export type MeasurementSource = "hardware" | "mock";
export type PracticeSetup = {
  user: number; tool: number; suctionDO: number; releaseDO: number | null;
  vacuumDI: number | null; activeHigh: boolean; speed: number;
  workspace: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number; rMin: number; rMax: number };
  positionTolerance: number; rotationTolerance: number;
  verified: { firmware: boolean; network: boolean; coordinates: boolean; tool: boolean; io: boolean; workspace: boolean };
};
export const defaultPracticeSetup = (): PracticeSetup => ({
  user: 0, tool: 0, suctionDO: 1, releaseDO: null, vacuumDI: null, activeHigh: true, speed: 5,
  workspace: { xMin: 200, xMax: 350, yMin: -160, yMax: 160, zMin: 0, zMax: 320, rMin: -180, rMax: 180 },
  positionTolerance: 2, rotationTolerance: 2,
  verified: { firmware: false, network: false, coordinates: false, tool: false, io: false, workspace: false },
});
export type RobotMeasurement = {
  source: MeasurementSource; seq: number; measuredAt: number; ageMs: number;
  pose: LessonPose; joints: LessonJoints; robotMode: number;
  enabled: boolean; moving: boolean; error: boolean; inputBits: string; outputBits: string;
  user: number; tool: number; receivedAt: number;
};
export type PracticeOperation =
  | { kind: "move"; motion: "MoveJ" | "MoveL"; target: LessonPose; relative?: boolean }
  | { kind: "joints"; target: LessonJoints }
  | { kind: "jointStep"; joint: keyof LessonJoints; delta: number }
  | { kind: "suction"; on: boolean }
  | { kind: "enable" | "disable" };
export type PracticeSnapshot = {
  mode: PracticeMode; connection: "disconnected" | "connecting" | "connected";
  source: MeasurementSource | null; measurement: RobotMeasurement | null; busy: boolean;
  setup: PracticeSetup | null; error: string; uncertainMotion: boolean; jointStepSupported?: boolean;
};
type SocketLike = Pick<WebSocket, "send" | "close" | "readyState"> & {
  onopen: ((event: Event) => void) | null; onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null; onerror: ((event: Event) => void) | null;
};
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
const axes = ["x", "y", "z", "r"] as const;
const joints = ["j1", "j2", "j3", "j4"] as const;
const finiteObject = (v: unknown, keys: readonly string[]) => !!v && typeof v === "object"
  && keys.every(k => typeof (v as Record<string, unknown>)[k] === "number" && Number.isFinite((v as Record<string, number>)[k]));
export const rotationDistance = (a: number, b: number) => Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);
export const measurementFresh = (m: RobotMeasurement | null, now = Date.now()) =>
  !!m && now >= m.receivedAt && now - m.receivedAt + m.ageMs <= 1500;
export function bitIsOn(bits: string, channel: number): boolean {
  return (BigInt(bits) & (1n << BigInt(channel - 1))) !== 0n;
}
export function setupProblem(s: PracticeSetup): string | null {
  if (!s || !s.verified || !Object.values(s.verified).every(v => v === true)
    || Object.keys(s.verified).length !== 6) return "장비 버전·네트워크·좌표계·공구·입출력·작업 범위를 모두 확인하세요.";
  if (![s.user, s.tool].every(n => Number.isInteger(n) && n >= 0 && n <= 9)) return "User/Tool 번호는 0~9 정수여야 합니다.";
  if (![s.suctionDO, s.releaseDO, s.vacuumDI].every(n => n === null || Number.isInteger(n) && n >= 1 && n <= 16)
    || s.suctionDO === null || s.suctionDO === s.releaseDO) return "입출력 채널(1~16)과 흡착·해제의 서로 다른 출력 번호를 확인하세요.";
  if (typeof s.activeHigh !== "boolean" || !Number.isFinite(s.speed) || s.speed < 1 || s.speed > 20) return "출력 극성과 저속 비율(1~20%)을 확인하세요.";
  if (!Number.isFinite(s.positionTolerance) || s.positionTolerance <= 0 || s.positionTolerance > 5
    || !Number.isFinite(s.rotationTolerance) || s.rotationTolerance <= 0 || s.rotationTolerance > 5) return "위치·방향 허용 오차는 0 초과 5 이하여야 합니다.";
  if (!s.workspace || !axes.every(k => {
    const lo = s.workspace[`${k}Min`], hi = s.workspace[`${k}Max`];
    return Number.isFinite(lo) && Number.isFinite(hi) && lo < hi;
  })) return "실제 장비의 확인된 작업 범위를 입력하세요.";
  return null;
}
export type WorkspaceFinding={axis:typeof axes[number];value:number;min:number;max:number;stage:string;kind:"outside"|"boundary"};
export function workspaceFindings(p: LessonPose, setup: PracticeSetup, stage="목표"):WorkspaceFinding[] {
  return axes.flatMap<WorkspaceFinding>(axis=>{
    const value=p[axis],min=setup.workspace[`${axis}Min`],max=setup.workspace[`${axis}Max`];
    if(!Number.isFinite(value))return [{axis,value,min,max,stage,kind:"outside" as const}];
    return value<min||value>max?[{axis,value,min,max,stage,kind:"outside" as const}]:
      value===min||value===max?[{axis,value,min,max,stage,kind:"boundary" as const}]:[];
  });
}
export function describeWorkspaceFinding(f:ReturnType<typeof workspaceFindings>[number]) {
  const display=Number(f.value.toFixed(2));
  return `${f.stage}: ${f.axis.toUpperCase()}=${String(f.value)}${f.axis==="r"?"°":" mm"} · 작업 범위 [${f.min}, ${f.max}] · ${
    f.kind==="boundary"?"경계값 — 현장 여유·공구·배선을 사람이 확인하세요":f.value<f.min?"하한 미만":"상한 초과"}${
    display!==f.value?` (화면 반올림 ${display}, 검사는 원시 좌표 ${String(f.value)} 기준)`:""}`;
}
export function targetProblem(p: LessonPose, setup: PracticeSetup,stage="목표"): string | null {
  if (!finiteObject(p, axes)) return "좌표·방향을 유한한 수로 입력하세요.";
  const outside=workspaceFindings(p,setup,stage).filter(f=>f.kind==="outside");
  return outside.length?`${stage}: 확인된 작업 범위 밖입니다.\n${outside.map(describeWorkspaceFinding).join("\n")}`:null;
}
/** Excludes speed and human acknowledgement flags, not installation parameters. */
export function installationKey(s:PracticeSetup) {
  const {speed:_speed,verified:_verified,...installation}=s;
  return JSON.stringify(installation);
}
export function changedSetup(previous:PracticeSetup,next:PracticeSetup):PracticeSetup {
  const verified={...next.verified};
  if(previous.user!==next.user){verified.coordinates=false;verified.workspace=false;}
  if(previous.tool!==next.tool){verified.tool=false;verified.io=false;verified.workspace=false;}
  if(["suctionDO","releaseDO","vacuumDI","activeHigh"].some(k=>previous[k as keyof PracticeSetup]!==next[k as keyof PracticeSetup]))verified.io=false;
  if(JSON.stringify(previous.workspace)!==JSON.stringify(next.workspace)||previous.positionTolerance!==next.positionTolerance||previous.rotationTolerance!==next.rotationTolerance)
    verified.workspace=false;
  return {...next,verified};
}

/** Local-PC protocol v2. There is no SDK/API key and no automatic motor command. */
export class PracticeSession {
  private snapshot: PracticeSnapshot = { mode: "virtual", connection: "disconnected", source: null,
    measurement: null, busy: false, setup: null, error: "", uncertainMotion: false };
  private listeners = new Set<() => void>();
  private stopListeners = new Set<() => void>();
  private socket: SocketLike | null = null;
  private pending = new Map<string, Pending>();
  private counter = 0; private generation = 0; private virtualBusy = false;
  private executing = false; private monitor: ReturnType<typeof setInterval> | null = null;
  private configuring=false;
  private connectionTarget="";
  constructor(private makeSocket: (url: string) => SocketLike = url => new WebSocket(url),
    private now: () => number = Date.now) {}
  getSnapshot = () => this.snapshot;
  getConnectionId = () => this.generation;
  getBridgeUrl = () => this.connectionTarget;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  /** Scoped continuations must also cancel when the global stop is pressed
   * during virtual playback, when there is no physical command to stop yet. */
  subscribeStop = (listener: () => void) => { this.stopListeners.add(listener); return () => { this.stopListeners.delete(listener); }; };
  private change(patch: Partial<PracticeSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  setVirtualBusy(value: boolean) {
    this.virtualBusy = value; this.change({ busy: this.executing || this.configuring || value });
  }
  setMode(mode: PracticeMode) {
    if (mode === this.snapshot.mode) return;
    if (this.snapshot.busy || this.snapshot.measurement?.moving || this.snapshot.uncertainMotion)
      throw new Error("실행 중에는 모드를 바꿀 수 없습니다. 중단하고 실제 정지 상태를 확인하세요.");
    this.disconnect(); this.change({ mode, error: "" });
  }
  clearError() { this.change({ error: "" }); }
  acknowledgePhysicalStop() {
    if (this.snapshot.connection === "connected" && this.snapshot.measurement?.moving)
      throw new Error("측정상 로봇이 아직 이동 중입니다.");
    this.change({ uncertainMotion: false, measurement: null, setup: null, error: "현장 정지 확인 후 다시 연결·준비 확인이 필요합니다." });
  }
  private invalidate(reason: string) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason)); }
    this.pending.clear();
    if (this.executing || this.snapshot.measurement?.moving) this.change({ uncertainMotion: true });
    this.change({ error: reason, setup: null });
  }
  disconnect() {
    if (this.executing) this.stop();
    this.generation++;
    if (this.monitor) clearInterval(this.monitor); this.monitor = null;
    if (this.socket) {
      this.socket.onclose = null; this.socket.onmessage = null;
      this.socket.onopen = null; this.socket.onerror = null; this.socket.close(); this.socket = null;
    }
    this.invalidate("연결이 해제되었습니다. 장비 정지는 별도로 확인하세요.");
    this.change({ connection: "disconnected", source: null, measurement: null, setup: null });
  }
  // Ignore legacy caller/saved addresses; the teaching robot target is fixed.
  async connect(url: string, _legacyRobotIp?: string) {
    if (this.snapshot.mode !== "hardware" || this.snapshot.busy || this.snapshot.uncertainMotion)
      throw new Error("실제 로봇 모드를 선택하고 정지 상태를 확인하세요.");
    const parsed = new URL(url);
    if (!["ws:", "wss:"].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error("PC 브리지의 ws:// 또는 wss:// 주소를 입력하세요.");
    this.disconnect();
    this.connectionTarget=parsed.href;
    const generation = ++this.generation;
    this.change({ connection: "connecting", error: "", jointStepSupported: false });
    const socket = this.makeSocket(url); this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { this.disconnect(); reject(new Error("PC 연결 시간 초과")); }, 6000);
      socket.onmessage = event => { if (generation === this.generation) this.receive(event.data); };
      socket.onclose = () => {
        if (generation !== this.generation) return;
        clearTimeout(timeout); this.invalidate("PC 연결이 끊겼습니다. 실제 정지는 확인되지 않았습니다.");
        this.change({ connection: "disconnected", measurement: null, source: null }); reject(new Error("PC 연결 종료"));
      };
      socket.onerror = () => { clearTimeout(timeout); this.invalidate("PC 연결 오류: TLS·Origin·네트워크를 확인하세요."); reject(new Error(this.snapshot.error)); };
      socket.onopen = async () => {
        try {
          await this.request({ type: "connect", robotIp: MG400_ROBOT_IP });
          if (!this.snapshot.source) throw new Error("지원되는 프로토콜 v2 인사 메시지가 없습니다.");
          this.change({ connection: "connected" }); clearTimeout(timeout); resolve();
          this.monitor = setInterval(() => {
            if (this.executing && !measurementFresh(this.snapshot.measurement, this.now())) {
              this.stop(); this.invalidate("측정값이 오래되어 실행을 중단했습니다. 실제 정지 여부를 현장에서 확인하세요.");
            }
          }, 250);
        } catch (e) { clearTimeout(timeout); this.disconnect(); reject(e); }
      };
    });
  }
  private receive(raw: unknown) {
    try {
      const e = JSON.parse(String(raw));
      if (e.type === "hello") {
        if (e.protocol !== 2 || e.model !== "MG400" || !["hardware", "mock"].includes(e.source))
          throw new Error("MG400 프로토콜 v2 브리지가 필요합니다. 이전 브리지와 호환되지 않습니다.");
        this.change({ source: e.source, jointStepSupported: e.capabilities?.jointStep === true }); return;
      }
      if (e.type === "measurement") {
        const m = e.measurement;
        if (!m || m.source !== this.snapshot.source || !finiteObject(m.pose, axes) || !finiteObject(m.joints, joints)
          || !Number.isSafeInteger(m.seq) || m.seq < 1 || m.seq <= (this.snapshot.measurement?.seq ?? 0)
          || !Number.isFinite(m.measuredAt) || !Number.isFinite(m.ageMs) || m.ageMs < 0 || m.ageMs > 1500
          || !Number.isInteger(m.robotMode) || ![1, 4, 5, 6, 7, 9, 10, 11].includes(m.robotMode)
          || !["enabled", "moving", "error"].every(k => typeof m[k] === "boolean")
          || ![m.inputBits, m.outputBits].every(b => typeof b === "string" && /^\d{1,20}$/.test(b))
          || ![m.user, m.tool].every(v => Number.isInteger(v) && v >= 0 && v <= 9)) throw new Error("측정 패킷이 유효하지 않거나 오래됐습니다.");
        const measurement = { ...m, receivedAt: this.now() } as RobotMeasurement;
        this.change({ measurement });
        if (measurement.error || measurement.robotMode === 9) {
          const reason = "로봇 오류 상태입니다. 현장에서 원인을 해결하고 준비 확인을 다시 하세요.";
          if (this.executing) { this.stop(); this.invalidate(reason); }
          else this.change({ error: reason, setup: null });
        }
        return;
      }
      if (e.type === "reply") {
        const p = this.pending.get(e.id); if (!p) return;
        this.pending.delete(e.id); clearTimeout(p.timer);
        if (e.ok === true) p.resolve(e.result);
        else p.reject(new Error(e.error || "PC가 요청을 거부했습니다."));
        return;
      }
      if (e.type === "error") throw new Error(e.message || "PC 브리지 오류");
    } catch (e) { this.invalidate(e instanceof Error ? e.message : "측정 데이터를 읽지 못했습니다."); }
  }
  private request(message: Record<string, unknown>, timeout = 6000): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== 1) return Promise.reject(new Error("PC 브리지가 연결되지 않았습니다."));
    const id = `request-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error("요청 완료 시간이 초과됐습니다. 실제 장비 상태를 확인하세요."));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket!.send(JSON.stringify({ ...message, id })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  readiness(requireEnabled = true): string | null {
    const s = this.snapshot, m = s.measurement;
    if (s.mode !== "hardware") return "실제 로봇 모드가 아닙니다.";
    if (s.connection !== "connected" || !s.source) return "로봇 옆 PC에 연결하세요.";
    if (!measurementFresh(m, this.now())) return "실제 측정값이 없거나 오래됐습니다.";
    if (s.error || s.uncertainMotion) return s.error || "실제 정지 여부를 확인하세요.";
    if (!s.setup) return "좌표계·공구·입출력·작업 범위를 확인하고 준비 설정을 적용하세요.";
    if (m!.error || m!.robotMode === 9 || ![4, 5, 7].includes(m!.robotMode)) return "로봇 상태가 실행에 적합하지 않습니다.";
    if (m!.user !== s.setup.user || m!.tool !== s.setup.tool) return "측정된 User/Tool 번호가 준비 설정과 다릅니다.";
    if (requireEnabled) { const outside=targetProblem(m!.pose,s.setup,"현재 실측 TCP");if(outside)return outside; }
    if (requireEnabled && !m!.enabled) return "로봇 서보를 별도 확인 버튼으로 활성화하세요.";
    return null;
  }
  async applySetup(setup: PracticeSetup) {
    if (this.snapshot.mode !== "hardware" || this.snapshot.connection !== "connected" || this.snapshot.busy
      || this.configuring || this.snapshot.measurement?.moving || this.snapshot.uncertainMotion) throw new Error("연결 후 정지 상태에서 준비 설정을 적용하세요.");
    const bad = setupProblem(setup); if (bad) throw new Error(bad);
    if (!measurementFresh(this.snapshot.measurement, this.now()) || this.snapshot.measurement!.error
      ||![4,5].includes(this.snapshot.measurement!.robotMode)) throw new Error("정상 정지 상태의 최신 측정값이 필요합니다.");
    const approved=structuredClone(setup),generation=this.generation;
    this.configuring=true;this.change({ setup: null, error: "",busy:true });
    try {
      const reply=await this.request({ type: "configure", setup:approved });
      if(reply&&typeof reply==="object"&&"appliedSpeed" in reply&&reply.appliedSpeed!==approved.speed)
        throw new Error("브리지의 적용 속도 응답이 요청과 다릅니다. 적용된 것으로 처리하지 않습니다.");
      if(generation!==this.generation||this.snapshot.connection!=="connected"||this.snapshot.measurement?.moving
        ||!measurementFresh(this.snapshot.measurement,this.now())||this.snapshot.measurement?.error
        ||![4,5].includes(this.snapshot.measurement!.robotMode))
        throw new Error("적용 응답 후 동일 연결의 최신 정지 상태를 확인하지 못했습니다. 설정을 다시 확인하세요.");
      this.change({ setup:approved });
    }catch(error){
      this.change({setup:null,error:error instanceof Error?error.message:"설정 적용 실패"});throw error;
    }finally{this.configuring=false;this.change({busy:this.executing||this.virtualBusy});}
  }
  async applySpeed(speed:number) {
    const setup=this.snapshot.setup;
    if(!setup)throw new Error("먼저 확인된 설치 프로필의 준비 설정을 적용하세요.");
    await this.applySetup({...structuredClone(setup),speed});
  }
  async execute(operations: PracticeOperation[], confirmed: boolean,
    onStep?: (measurement: RobotMeasurement, index: number, operation: PracticeOperation) => void): Promise<RobotMeasurement[]> {
    if (!confirmed) throw new Error("실제 실행 확인이 필요합니다.");
    if (this.snapshot.busy || this.snapshot.measurement?.moving || !operations.length || operations.length > 30)
      throw new Error("정지 상태에서 1~30개 명령을 실행하세요.");
    const requireEnabled = operations.some(o => !["enable", "disable"].includes(o.kind));
    const problem = this.readiness(requireEnabled); if (problem) throw new Error(problem);
    let preview = { ...this.snapshot.measurement!.pose };
    for (const op of operations) {
      if (op.kind === "move") {
        preview = op.relative ? Object.fromEntries(axes.map(k => [k, preview[k] + op.target[k]])) as LessonPose : { ...op.target };
        const bad = targetProblem(preview, this.snapshot.setup!); if (bad) throw new Error(bad);
      }
      if (op.kind === "jointStep") {
        if (!this.snapshot.jointStepSupported) throw new Error("관절 제어에는 새 브리지가 필요합니다. 안내·연결에서 다시 내려받고 실행해주세요.");
        if (!joints.includes(op.joint) || !Number.isFinite(op.delta) || op.delta === 0 || Math.abs(op.delta) > 10)
          throw new Error("관절 이동은 한 축씩 0 초과 10도 이하로 실행하세요.");
      }
      if (op.kind === "joints") throw new Error("실제 관절 명령은 제조사 관절 범위 검증이 필요합니다. 좌표 MoveJ/MoveL을 사용하세요.");
    }
    this.executing = true; this.change({ busy: true, error: "" });
    const generation = this.generation, results: RobotMeasurement[] = [];
    try {
      for (let i = 0; i < operations.length; i++) {
        if (!this.executing || generation !== this.generation) throw new Error("실행이 중단됐습니다.");
        const currentProblem = this.readiness(requireEnabled); if (currentProblem) throw new Error(currentProblem);
        const before = this.snapshot.measurement!;
        const previousSequence = before.seq;
        // Relative commands use this step's FRESH measured start, not a planned
        // start or the previous nominal command endpoint.
        const original = operations[i];
        const op: PracticeOperation = original.kind === "move" && original.relative
          ? { kind: "move", motion: original.motion, target: Object.fromEntries(axes.map(k => [k, before.pose[k] + original.target[k]])) as LessonPose }
          : original;
        if (op.kind === "move") { const bad = targetProblem(op.target, this.snapshot.setup!); if (bad) throw new Error(bad); }
        const response = await this.request({ type: "execute", operation: op, confirmed: true,expectedSpeed:this.snapshot.setup!.speed }, 35000) as { seq?: number };
        const m = this.snapshot.measurement;
        if (!this.executing || generation !== this.generation) throw new Error("실행이 중단됐습니다.");
        if (!m || !measurementFresh(m, this.now()) || m.seq <= previousSequence || !response
          || !Number.isSafeInteger(response.seq) || response.seq! <= previousSequence || m.seq < response.seq!)
          throw new Error("완료 응답 이후의 새 측정값을 확인하지 못했습니다. 성공으로 처리하지 않습니다.");
        if (m.error || m.moving) throw new Error("완료 응답과 측정 상태가 일치하지 않습니다.");
        if (op.kind === "move" && (Math.hypot(m.pose.x - op.target.x, m.pose.y - op.target.y, m.pose.z - op.target.z) > this.snapshot.setup!.positionTolerance
          || rotationDistance(m.pose.r, op.target.r) > this.snapshot.setup!.rotationTolerance)) throw new Error("실측 TCP가 목표 위치·방향 허용 오차를 벗어났습니다.");
        if (op.kind === "jointStep" && joints.some(k => Math.abs(m.joints[k] - (before.joints[k] + (k === op.joint ? op.delta : 0))) > 0.2))
          throw new Error("실측 관절각이 목표 허용 오차 0.2도를 벗어났습니다.");
        if (op.kind === "suction") {
          const setup = this.snapshot.setup!;
          if (bitIsOn(m.outputBits, setup.suctionDO) !== (op.on === setup.activeHigh)) throw new Error("측정된 흡착 출력이 명령과 다릅니다.");
          if (setup.releaseDO !== null && bitIsOn(m.outputBits, setup.releaseDO) === (op.on === setup.activeHigh)) throw new Error("측정된 해제 출력이 명령과 다릅니다.");
          if (setup.vacuumDI !== null && bitIsOn(m.inputBits, setup.vacuumDI) !== op.on) throw new Error("진공 입력이 집기·해제를 확인하지 못했습니다.");
        }
        results.push(structuredClone(m)); onStep?.(m, i, op);
      }
      return results;
    } catch (e) {
      this.stop();
      const message = e instanceof Error ? e.message : "실제 실행 오류";
      this.change({ error: message }); throw e;
    } finally { this.executing = false; this.change({ busy: this.virtualBusy }); }
  }
  stop() {
    for(const listener of [...this.stopListeners]) {
      try { listener(); }
      catch(error) { console.error("연속 실행 취소 처리 오류 · 장비 정지 요청은 계속합니다.",error); }
    }
    if (!this.executing && !this.snapshot.measurement?.moving) return;
    this.change({ uncertainMotion: true });
    this.executing = false;
    this.invalidate("화면에서 중단을 요청했습니다. 물리 비상정지가 아니며 실제 정지 확인이 필요합니다.");
    // Out-of-band request. Never turns suction off or clears an alarm.
    void this.request({ type: "stop" }).catch(() => {
      this.change({ uncertainMotion: true, error: "중단 전달을 확인하지 못했습니다. 장비 물리 비상정지를 사용하세요." });
    });
  }
  dispose() { this.disconnect(); this.listeners.clear(); this.stopListeners.clear(); }
}

