import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { recordLearningAction } from "./learningSync";
import {
  PracticeSession, defaultPracticeSetup, bitIsOn, MG400_ROBOT_IP,
  changedSetup,installationKey,setupProblem,workspaceFindings,describeWorkspaceFinding,
  type PracticeOperation, type PracticeSetup, type PracticeSnapshot, type RobotMeasurement,
} from "./practiceSession";
import "./practice.css";

export type JournalEntry = {
  id: string; at: string; source: "hardware" | "mock"; label: string;
  operation: PracticeOperation; measurement: RobotMeasurement;
};
export type RunOps = (ops: PracticeOperation[], label: string,
  onStep?: (m: RobotMeasurement, index: number, op: PracticeOperation) => void,
  onStart?: () => void,
  beforeExecute?: () => Promise<void>) => Promise<RobotMeasurement[] | null>;

type Ctx = {
  session: PracticeSession; snap: PracticeSnapshot; hardware: boolean;
  panelOpen: boolean; setPanelOpen: (v: boolean) => void;
  bridgeUrl: string; setBridgeUrl: (v: string) => void;
  readonly robotIp: string;
  setupDraft: PracticeSetup; setSetupDraft: (s: PracticeSetup) => void;
  confirm: (title: string, lines: string[], okLabel?: string) => Promise<boolean>;
  runOps: RunOps;
  cancelConfirmation: () => void;
  lockVirtual: () => () => void;
  journal: JournalEntry[];
};
const PracticeContext = createContext<Ctx | null>(null);

const f = (n: number) => Number(n.toFixed(2)).toString();
export function describeOperation(op: PracticeOperation, setup: PracticeSetup | null): string {
  switch (op.kind) {
    case "move": return op.relative
      ? `${op.motion} 상대 이동 Δ X ${f(op.target.x)}, Y ${f(op.target.y)}, Z ${f(op.target.z)}, R ${f(op.target.r)} (이 단계 시작 직전에 새로 측정한 위치 기준)`
      : `${op.motion} → X ${f(op.target.x)}, Y ${f(op.target.y)}, Z ${f(op.target.z)}, R ${f(op.target.r)}`;
    case "jointStep": return `${op.joint.toUpperCase()} ${op.delta > 0 ? "+" : ""}${f(op.delta)}° (실측 관절각 기준 한 칸 이동)`;
    case "joints": return "관절 직접 이동 (지원되지 않음)";
    case "suction": return `흡착 ${op.on ? "켜기" : "끄기"} (DO${setup?.suctionDO ?? "?"})`;
    case "enable": return "서보 활성화";
    case "disable": return "서보 비활성화";
  }
}
export { bitIsOn };

export function PracticeProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new PracticeSession());
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => () => { session.dispose(); }, [session]);
  // Always starts virtual and disconnected: nothing here is persisted.
  const [panelOpen, setPanelOpen] = useState(false);
  const [bridgeUrl, updateBridgeUrl] = useState("ws://127.0.0.1:8765");
  const bridgeUrlRef=useRef(bridgeUrl);bridgeUrlRef.current=bridgeUrl;
  const [setupDraft, updateSetupDraft] = useState<PracticeSetup>(defaultPracticeSetup);
  const draftRef=useRef(setupDraft);draftRef.current=setupDraft;
  const resetChecks=useCallback(()=>updateSetupDraft(s=>({...s,verified:defaultPracticeSetup().verified})),[]);
  const setSetupDraft=useCallback((s:PracticeSetup)=>updateSetupDraft(old=>changedSetup(old,s)),[]);
  const setBridgeUrl=useCallback((value:string)=>{if(value!==bridgeUrl)resetChecks();updateBridgeUrl(value);},[bridgeUrl,resetChecks]);
  useEffect(()=>{resetChecks();},[snap.connection,snap.source,snap.uncertainMotion,snap.measurement?.error,resetChecks]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [ask, setAsk] = useState<{ title: string; lines: string[]; okLabel: string; resolve: (v: boolean) => void } | null>(null);
  const askRef = useRef(ask); askRef.current = ask;

  const confirm = useCallback((title: string, lines: string[], okLabel = "확인하고 실행") =>
    new Promise<boolean>(resolve => {
      askRef.current?.resolve(false);
      setAsk({ title, lines, okLabel, resolve });
    }), []);
  const answer = (v: boolean) => { askRef.current?.resolve(v); setAsk(null); };
  /** Any pending confirmation is answered "no" so it can never run after navigation. */
  const cancelConfirmation = useCallback(() => { askRef.current?.resolve(false); askRef.current = null; setAsk(null); }, []);
  // A confirmation never outlives the mode or connection it was shown for.
  useEffect(() => { if (snap.connection !== "connected" && askRef.current) { askRef.current.resolve(false); setAsk(null); } }, [snap.connection]);

  const locks = useRef(0);
  const lockVirtual = useCallback(() => {
    locks.current++; session.setVirtualBusy(true);
    let done = false;
    return () => {
      if (done) return; done = true;
      locks.current = Math.max(0, locks.current - 1);
      if (locks.current === 0) session.setVirtualBusy(false);
    };
  }, [session]);

  const runOps = useCallback<RunOps>(async (ops, label, onStep, onStart, beforeExecute) => {
    const needsServo = ops.some(o => o.kind !== "enable" && o.kind !== "disable");
    const problem = session.readiness(needsServo); if (problem) throw new Error(problem);
    if(beforeExecute&&(session.getSnapshot().busy||session.getSnapshot().measurement?.moving))
      throw new Error("연속 실행 시작 전에 장비가 정지하고 다른 실행이 끝났는지 확인하세요.");
    const setup = session.getSnapshot().setup!;
    const connectionId=session.getConnectionId();
    if(new URL(bridgeUrl).href!==session.getBridgeUrl())throw new Error("연결 대상 입력이 변경되었습니다. 대상에 다시 연결하고 준비를 확인하세요.");
    if(installationKey(draftRef.current)!==installationKey(setup)||setupProblem({...draftRef.current,speed:setup.speed}))
      throw new Error("설치 설정이 변경되었거나 확인이 해제되었습니다. 관련 항목을 확인하고 준비 설정을 다시 적용하세요.");
    const findings=workspaceFindings(session.getSnapshot().measurement!.pose,setup,"현재 실측 TCP");
    let preview={...session.getSnapshot().measurement!.pose};
    ops.forEach((op,i)=>{
      if(op.kind!=="move")return;
      preview=op.relative?{x:preview.x+op.target.x,y:preview.y+op.target.y,z:preview.z+op.target.z,r:preview.r+op.target.r}:{...op.target};
      findings.push(...workspaceFindings(preview,setup,`${beforeExecute?"사각형 연속 실행":label} · 단계 ${i+1} ${op.motion} 목표`));
    });
    const outside=findings.filter(f=>f.kind==="outside");
    if(outside.length)throw new Error(outside.map(describeWorkspaceFinding).join("\n"));
    const mock = session.getSnapshot().source === "mock";
    const ok = await confirm(mock ? "모의 통신 실행 확인 — 실장비 아님" : "실제 MG400 실행 확인", [
      `${label}`,
      ...ops.map((o, i) => `${i + 1}. ${describeOperation(o, setup)}`),
      `속도 ${setup.speed}% (저속) · User ${setup.user} / Tool ${setup.tool}`,
      ...(draftRef.current.speed!==setup.speed?[`변경 예정 ${draftRef.current.speed}%는 미적용입니다. 이번 실행은 적용 확인된 ${setup.speed}%를 사용합니다.`]:[]),
      ...findings.map(describeWorkspaceFinding),
      "범위 검사는 좌표 끝점의 수치 비교이며 이동 경로·장애물·공구·배선·교정을 센서로 검증한 것이 아닙니다.",
      `허용 작업 범위와 위치 ±${setup.positionTolerance} mm, 방향 ±${setup.rotationTolerance} deg 안에서만 성공으로 봅니다.`,
      mock ? "모의 통신입니다. 실제 로봇은 움직이지 않으며 값은 실측이 아닙니다." : "로봇 주변을 비우고 물리 비상정지 버튼에 손이 닿는지 확인하세요.",
    ], mock ? "확인하고 모의 실행" : "확인하고 실행");
    if (!ok) return null;
    // Only the explicitly opted-in square continuation defers the physical
    // start. This callback performs virtual playback, never a robot operation.
    if (beforeExecute) await beforeExecute();
    if(session.getConnectionId()!==connectionId||session.getSnapshot().setup!==setup
      ||installationKey(draftRef.current)!==installationKey(setup)||setupProblem({...draftRef.current,speed:setup.speed}))
      throw new Error("확인 중 연결 또는 설치 설정이 변경되었습니다. 실제 적용 속도와 설정을 다시 확인하고 승인하세요.");
    if (beforeExecute) {
      if(new URL(bridgeUrlRef.current).href!==session.getBridgeUrl())
        throw new Error("연결 대상이 변경되어 연속 실행 승인을 폐기했습니다.");
      const recheck=session.readiness(needsServo);
      if(recheck)throw new Error(`가상 완료 후 실제 실행 차단: ${recheck}`);
      if(session.getSnapshot().busy||session.getSnapshot().measurement?.moving)
        throw new Error("가상 완료 후 장비 정지 상태를 확인하지 못했습니다.");
      const outsideNow=workspaceFindings(session.getSnapshot().measurement!.pose,setup,"실제 시작 직전 TCP").filter(f=>f.kind==="outside");
      if(outsideNow.length)throw new Error(outsideNow.map(describeWorkspaceFinding).join("\n"));
      // execute() also checks every target, speed setup, fresh telemetry and
      // connection generation again, before and between individual operations.
    }
    onStart?.();
    const runId = crypto.randomUUID();
    const source = mock ? "mock" : "hardware";
    const rows: RobotMeasurement[] = [];
    recordLearningAction("hardware-operations", "running", { id: runId, label, operations: ops, setup }, source);
    // Each journal row carries its own measurement.source and the resolved operation; measured prefixes survive errors.
    try {
    const results = await session.execute(ops, true, (m, i, op) => {
      rows.push(m);
      setJournal(j => [{ id: `${m.source}-${m.seq}-${i}`, at: new Date().toISOString(), source: m.source, label, operation: op, measurement: m }, ...j].slice(0, 60));
      recordLearningAction("hardware-operations", "running", { id: runId, label, operations: ops, measurements: [...rows] }, source);
      onStep?.(m, i, op);
    });
    recordLearningAction("hardware-operations", "completed", { id: runId, label, operations: ops, measurements: results }, source);
    return results;
    } catch (error) {
      recordLearningAction("hardware-operations", /중단|취소|cancel|abort|stop/i.test(error instanceof Error ? error.message : String(error)) ? "stopped" : "failed", { id: runId, label, operations: ops, measurements: rows,
        error: error instanceof Error ? error.message : String(error) }, source);
      throw error;
    }
  }, [session, confirm,bridgeUrl]);

  const value = useMemo<Ctx>(() => ({
    session, snap, hardware: snap.mode === "hardware", panelOpen, setPanelOpen, bridgeUrl, setBridgeUrl, robotIp: MG400_ROBOT_IP,
    setupDraft, setSetupDraft, confirm, runOps, cancelConfirmation, lockVirtual, journal,
  }), [session, snap, panelOpen, bridgeUrl, setupDraft, confirm, runOps, cancelConfirmation, lockVirtual, journal]);

  return <PracticeContext.Provider value={value}>
    {children}
    {ask && <div className="pr-modal" role="dialog" aria-modal="true" aria-label={ask.title}>
      <div className="pr-modal__box">
        <h2>{ask.title}</h2>
        <ul>{ask.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <p className="pr-warn">화면의 중단 버튼은 물리 비상정지가 아닙니다.</p>
        <div className="pr-row">
          <button type="button" data-testid="button-confirm-cancel" onClick={() => answer(false)}>취소</button>
          <button type="button" className="pr-danger" data-testid="button-confirm-ok" onClick={() => answer(true)}>{ask.okLabel}</button>
        </div>
      </div>
    </div>}
  </PracticeContext.Provider>;
}

export function usePractice(): Ctx {
  const c = useContext(PracticeContext);
  if (!c) throw new Error("PracticeProvider 안에서만 사용할 수 있습니다.");
  return c;
}

/** Locks mode changes for the whole time a virtual playback is active. */
export function useVirtualLock(active: boolean) {
  const { lockVirtual } = usePractice();
  useEffect(() => { if (!active) return; return lockVirtual(); }, [active, lockVirtual]);
}

