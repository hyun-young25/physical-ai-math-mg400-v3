import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import InstallationProfiles from "./InstallationProfiles";
import { bitIsOn, describeOperation, usePractice } from "./PracticeProvider";
import { measurementFresh, setupProblem, targetProblem, type PracticeSetup, type PracticeSnapshot, type RobotMeasurement } from "./practiceSession";

export const MOCK_LABEL = "모의 통신 · 실측 아님";
export const sourceLabel = (s: "hardware" | "mock" | null) => s === "mock" ? MOCK_LABEL : s === "hardware" ? "실제 MG400 실측" : "측정 없음";
const BASE = import.meta.env.BASE_URL;
const fx = (n: number) => Number(n.toFixed(2)).toString();

function useNow(active: boolean) {
  const [, setNow] = useState(() => Date.now());
  useEffect(() => { if (!active) return; const id = setInterval(() => setNow(Date.now()), 400); return () => clearInterval(id); }, [active]);
  // Feedback can arrive between timer ticks. An earlier tick time would give
  // a negative age and incorrectly mark a brand-new measurement as stale.
  return Date.now();
}

function Bits({ bits, label }: { bits: string | null; label: string }) {
  return <div className="pr-bits" aria-label={label}>{Array.from({ length: 16 }, (_, i) =>
    <i key={i} title={`${label} ${i + 1}: ${bits === null ? "측정 없음" : bitIsOn(bits, i + 1) ? "ON" : "OFF"}`}
      className={bits === null ? "unknown" : bitIsOn(bits, i + 1) ? "on" : ""}>{i + 1}</i>)}</div>;
}

/** Formatting is display-only; never round or replace the received measurement. */
function readoutNumber(n: number, decimals = 2): string {
  if (Math.abs(n) >= 100000) return n.toExponential(decimals);
  return Number(n.toFixed(decimals)).toFixed(decimals);
}

function MeasurementReadout({ snap, now }: { snap: PracticeSnapshot; now: number }) {
  const m = snap.connection === "connected" ? snap.measurement : null;
  const fresh = measurementFresh(m, now);
  const age = m ? Math.max(0, now - m.receivedAt + m.ageMs) : null;
  const status = !m ? snap.connection === "connected" ? "수신 대기" : snap.connection === "connecting" ? "연결 중" : "미연결"
    : fresh ? "최신" : "오래됨 · 사용 불가";
  const axes = (label: string, keys: readonly string[], values: Record<string, number> | null) =>
    <div className="pr-measurement-group">
      <div className="pr-measurement-label">{label}</div>
      <div className="pr-measurement-axes">{keys.map(k => <div key={k}>
        <span>{k.toUpperCase()}</span><span title={values ? String(values[k]) : "측정 없음"}>{values ? readoutNumber(values[k]) : "—"}</span>
      </div>)}</div>
    </div>;
  return <section className="pr-measurement" aria-label="실시간 측정값" data-testid="live-measurement">
    <dl className="pr-measurement-meta">
      <dt>측정 상태</dt><dd><span data-testid="measurement-freshness" className={`pr-badge ${!m ? "off" : fresh ? "hw" : "stale"}`}>{status}</span></dd>
      <dt>출처</dt><dd data-testid="measurement-source">{sourceLabel(m?.source ?? snap.source)}</dd>
      <dt>나이</dt><dd data-testid="measurement-age" title={age === null ? "측정 없음" : `${age} ms`}>{age === null ? "—" : `${readoutNumber(age, 3)} ms`}</dd>
      <dt>seq</dt><dd data-testid="measurement-seq" title={m ? String(m.seq) : "측정 없음"}>{m?.seq ?? "—"}</dd>
    </dl>
    <div className="pr-measurement-values" style={m && !fresh ? { opacity: .5 } : undefined}>
      {axes("TCP · X/Y/Z mm, R °", ["x", "y", "z", "r"], m?.pose ?? null)}
      {axes("관절 · °", ["j1", "j2", "j3", "j4"], m?.joints ?? null)}
      <dl className="pr-measurement-meta">
        <dt>모드</dt><dd>{m?.robotMode ?? "—"}</dd>
        <dt>서보</dt><dd>{m ? m.enabled ? "활성" : "비활성" : "—"}</dd>
        <dt>운동</dt><dd>{m ? m.moving ? "이동 중" : "정지" : "—"}</dd>
        <dt>오류</dt><dd>{m ? m.error ? "오류 있음" : "없음" : "—"}</dd>
        <dt>User/Tool</dt><dd>{m ? `${m.user} / ${m.tool}` : "—"}</dd>
      </dl>
      <div className="pr-measurement-io">
        <div><div className="pr-measurement-label">DI · 입력</div><Bits bits={m?.inputBits ?? null} label="입력"/></div>
        <div><div className="pr-measurement-label">DO · 출력</div><Bits bits={m?.outputBits ?? null} label="출력"/></div>
      </div>
    </div>
    <p className="pr-note pr-measurement-note" data-testid={!m ? "text-no-measurement" : "measurement-note"}>
      <span>{!m ? snap.connection === "connected" ? "아직 측정값을 받지 못했습니다." : "미연결 · 측정값 없음" : fresh ? "현재 연결의 최신 측정값입니다." : "측정 지연 · 마지막 수신값"}</span>
      <span>{!m ? "가상값으로 대체하지 않습니다." : !fresh ? "오래된 값은 실행에 쓰지 않습니다." : "\u00a0"}</span>
    </p>
  </section>;
}

/** Measured values only: shows a real/mock measurement, never a virtual coordinate. */
export function MeasuredCard({ title, measurements }: { title: string; measurements: RobotMeasurement[] }) {
  if (!measurements.length) return null;
  const mock = measurements[0].source === "mock";
  return <div className={`pr-measured${mock ? " mock" : ""}`} data-testid="card-measured">
    <h4><span className={`pr-hwtag${mock ? " mock" : ""}`}>{sourceLabel(measurements[0].source)}</span> {title}</h4>
    <table><thead><tr><th>#</th><th>X</th><th>Y</th><th>Z</th><th>R</th></tr></thead><tbody>
      {measurements.map((m, i) => <tr key={m.seq}><td>{i + 1}</td><td>{fx(m.pose.x)}</td><td>{fx(m.pose.y)}</td><td>{fx(m.pose.z)}</td><td>{fx(m.pose.r)}</td></tr>)}
    </tbody></table>
    <small>측정 seq {measurements.map(m => m.seq).join(", ")} · 가상 DT 계산값이 아닙니다.</small>
  </div>;
}

function Num({ label, value, onChange, step = "any", disabled }: { label: string; value: number | null; onChange: (v: number) => void; step?: string; disabled?: boolean }) {
  return <label>{label}<input type="number" step={step} disabled={disabled} value={value === null || Number.isNaN(value) ? "" : value}
    onChange={e => onChange(e.target.value === "" ? NaN : Number(e.target.value))}/></label>;
}

const CHECKS: { key: keyof PracticeSetup["verified"]; label: string }[] = [
  { key: "firmware", label: "컨트롤러 버전 V1.5.6.0 이상 확인" },
  { key: "network", label: "PC와 로봇 IP가 같은 대역(서로 다른 주소)" },
  { key: "coordinates", label: "User 좌표계 번호와 원점 확인" },
  { key: "tool", label: "Tool 번호와 흡착 TCP 확인" },
  { key: "io", label: "흡착·해제 DO와 진공 DI 배선 확인" },
  { key: "workspace", label: "작업 범위 안에 장애물이 없음" },
];

export function PracticeDock({ panelContainer }: { panelContainer?: HTMLElement | null }) {
  const p = usePractice();
  const latest=useRef(p);latest.current=p;
  const { session, snap, hardware, panelOpen, setPanelOpen } = p;
  const now = useNow(hardware);
  const [modeError, setModeError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [localError, setLocalError] = useState("");
  const [target, setTarget] = useState({ x: "300", y: "0", z: "100", r: "0" });
  const m = snap.measurement;
  const fresh = measurementFresh(m, now);
  const draft = p.setupDraft;
  const setDraft = (patch: Partial<PracticeSetup>) => p.setSetupDraft({ ...draft, ...patch });
  const ws = (k: keyof PracticeSetup["workspace"], v: number) => p.setSetupDraft({ ...draft, workspace: { ...draft.workspace, [k]: v } });
  const problem = setupProblem(draft);
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  let host = ""; try { host = new URL(p.bridgeUrl).hostname; } catch { host = ""; }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(host);
  const insecureBlocked = secure && p.bridgeUrl.startsWith("ws:") && !loopback;

  const changeMode = (mode: "virtual" | "hardware") => {
    setModeError("");
    try { session.setMode(mode); } catch (e) { setModeError(e instanceof Error ? e.message : "모드를 바꿀 수 없습니다."); setPanelOpen(true); }
  };
  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusyAction(name); setLocalError("");
    try { await fn(); } catch (e) { setLocalError(e instanceof Error ? e.message : "작업 실패"); }
    finally { setBusyAction(""); }
  };
  const connect = () => run("connect", async () => {
    if (insecureBlocked) throw new Error("HTTPS 페이지는 신뢰할 수 있는 wss:// 또는 같은 PC의 127.0.0.1 브리지만 허용합니다. 안전하지 않은 ws:// 로 자동 전환하지 않습니다.");
    await session.connect(p.bridgeUrl.trim());
  });
  const applySetup = () => run("setup", async () => {
    const bad = setupProblem(draft); if (bad) throw new Error(bad);
    const approved=structuredClone(draft),connection=session.getConnectionId();
    if(new URL(p.bridgeUrl).href!==session.getBridgeUrl())throw new Error("입력한 연결 대상이 현재 연결과 다릅니다. 해당 PC에 다시 연결하고 설치를 확인하세요.");
    const ok = await p.confirm("준비 설정 적용 확인", [
      `User ${draft.user} / Tool ${draft.tool}, 흡착 DO${draft.suctionDO}, 해제 DO${draft.releaseDO ?? "없음"}, 진공 DI${draft.vacuumDI ?? "없음"}`,
      `저속 ${draft.speed}%, 위치 허용 ${draft.positionTolerance} mm, 방향 허용 ${draft.rotationTolerance} deg`,
      "설정만 전달합니다. 서보 활성화, 이동, 흡착은 하지 않습니다.",
    ], "설정 적용");
    if (ok) {
      if(connection!==session.getConnectionId()||JSON.stringify(latest.current.setupDraft)!==JSON.stringify(approved)
        ||new URL(latest.current.bridgeUrl).href!==session.getBridgeUrl())throw new Error("연결 또는 설치 확인 내용이 변경되었습니다. 다시 확인하세요.");
      await session.applySetup(approved);
    }
  });
  const toggleServo = (on: boolean) => run("servo", async () => {
    const bad = session.readiness(false); if (bad) throw new Error(bad);
    await p.runOps([{ kind: on ? "enable" : "disable" }], on ? "서보 활성화" : "서보 비활성화");
  });
  const move = (motion: "MoveJ" | "MoveL") => run("move", async () => {
    const t = { x: Number(target.x), y: Number(target.y), z: Number(target.z), r: Number(target.r) };
    if (!session.getSnapshot().setup) throw new Error("준비 설정을 먼저 적용하세요.");
    const bad = targetProblem(t, session.getSnapshot().setup!); if (bad) throw new Error(bad);
    await p.runOps([{ kind: "move", motion, target: t }], "수동 이동");
  });
  const suction = (on: boolean) => run("suction", async () => { await p.runOps([{ kind: "suction", on }], on ? "흡착 켜기" : "흡착 끄기"); });
  const stop = () => session.stop();

  const shownError = localError || snap.error || modeError;
  const sourceBadge = snap.source === "mock" ? <span className="pr-badge mock">{MOCK_LABEL}</span>
    : snap.source === "hardware" ? <span className="pr-badge hw">실제 MG400</span> : <span className="pr-badge off">미연결</span>;

  return <><div className="pr-dock" data-testid="practice-dock">
    <div className="pr-pill" role="group" aria-label="실습 모드">
      <button type="button" aria-pressed={!hardware} disabled={snap.busy || snap.uncertainMotion || !!m?.moving} data-testid="button-mode-virtual" onClick={() => changeMode("virtual")}>가상 DT</button>
      <button type="button" aria-pressed={hardware} disabled={snap.busy || snap.uncertainMotion || !!m?.moving} data-testid="button-mode-hardware" onClick={() => changeMode("hardware")}>실제 로봇</button>
      <button type="button" className="pr-gear" aria-expanded={panelOpen} data-testid="button-practice-panel" onClick={() => setPanelOpen(!panelOpen)}>안내·연결</button>
    </div>
    {snap.busy && <div className="pr-lock" role="status">실행 중 · 모드 변경 잠김</div>}
    </div>
    {panelOpen && createPortal(<div className="pr-panel" role="region" aria-label="실습 설정" id="practice-settings">
      <div className="pr-panel-heading"><h2>안내·연결</h2><button type="button" data-testid="button-practice-close" onClick={() => setPanelOpen(false)}>닫기</button></div>
      {shownError && <div className="pr-err" role="alert" data-testid="text-practice-error">{shownError}
        <div className="pr-row"><button type="button" onClick={() => { setLocalError(""); setModeError(""); session.clearError(); }}>닫기</button></div></div>}
      {!hardware && <>
        <h3>가상 DT 실습</h3>
        <p className="pr-note">디지털 트윈에서 예측과 계획을 먼저 확인합니다. 실제 로봇에는 어떤 명령도 보내지 않습니다. 같은 계획은 &lsquo;실제 로봇&rsquo; 모드에서 실측으로 다시 확인할 수 있고, 작성 중인 입력은 모드를 바꿔도 유지됩니다.</p>
      </>}
      {hardware && <>
        <div className="pr-note" role="status" style={{background:"#eef5ff",padding:10,color:"#0b2d5c"}}>
          <strong className="pr-readiness-summary">{snap.busy ? "실장비 명령 실행 중" : session.readiness() || "조작 준비 완료"}</strong>
          <p>연결 → 아래 4번 준비 설정 적용 → 필요 시 5번 서보 활성화 → 패널을 닫고 화면 하단 TCP·관절각 ± 버튼으로 조작합니다.</p>
          {snap.connection === "connected" && !snap.jointStepSupported && <p>현재 브리지는 TCP 이동만 지원합니다. 관절각 버튼을 쓰려면 새 브리지를 내려받아 재실행하세요.</p>}
        </div>
        <h3>1. 안내</h3>
        <p className="pr-note">로봇 옆 PC에서 브리지를 실행합니다. 이 화면은 PC 브리지에만 연결하며 로봇 IP를 직접 열지 않습니다.</p>
        <div className="pr-row">
          <a href={`${BASE}mg400-bridge.zip`} download><button type="button" data-testid="link-bridge-zip">브리지 내려받기</button></a>
          <a href={`${BASE}mg400-practice-guide.md`} target="_blank" rel="noreferrer"><button type="button" data-testid="link-practice-guide">실습 안내서</button></a>
        </div>
        <ol className="pr-note" style={{ paddingLeft: 18 }}>
          <li>MG400/M1Pro 컨트롤러 V1.5.6.0 이상 (제조사 <a href="https://github.com/Dobot-Arm/TCP-IP-4Axis-Python" target="_blank" rel="noreferrer">TCP-IP-4Axis-Python</a> 지원 범위).</li>
          <li>MG400 연결 대상은 192.168.1.6으로 고정됩니다. PC를 로봇 LAN1에 연결하고 PC는 192.168.1.X(예: 192.168.1.20)로 서로 다르게 설정합니다.</li>
          <li>DobotStudio Pro에서 TCP/IP 보조 개발(secondary development)을 켭니다.</li>
          <li>User/Tool 번호와 흡착 DO를 DobotStudio Pro 값과 맞춥니다.</li>
        </ol>
        <p className="pr-note">PC 실행 옵션의 이 앱 Origin: <code data-testid="text-app-origin">{window.location.origin}</code><br/>실장비 경로는 공식 문서 기반 구현이며 실제 MG400 시험 전입니다.</p>
        {secure && <p className="pr-note">HTTPS 페이지에서는 신뢰할 수 있는 wss:// 브리지를 권장합니다. 같은 PC의 127.0.0.1도 브라우저 정책에 따라 차단될 수 있습니다. 인증서·Origin·방화벽을 확인하세요. 보안을 끄거나 안전하지 않은 주소로 자동 전환하지 않습니다.</p>}

        <h3>2. 연결 {sourceBadge}</h3>
        <div className="pr-grid2">
          <label>PC 브리지 주소 (ws:// 또는 wss://)<input type="text" value={p.bridgeUrl} disabled={snap.connection !== "disconnected"} data-testid="input-bridge-url" onChange={e => p.setBridgeUrl(e.target.value)}/></label>
          <label>MG400 IPv4<input type="text" value={p.robotIp} readOnly aria-describedby="fixed-robot-ip-note" data-testid="input-robot-ip"/></label>
        </div>
        <p id="fixed-robot-ip-note" className="pr-note">로봇 연결 대상 IP는 192.168.1.6으로 고정되어 수정할 수 없습니다. 이전에 저장된 다른 주소는 연결에 사용하지 않습니다. PC 브리지 주소는 별도입니다.</p>
        {insecureBlocked && <p className="pr-warn">HTTPS 페이지에서 ws:// 원격 주소는 차단됩니다. wss:// 또는 127.0.0.1을 쓰세요.</p>}
        <div className="pr-row">
          {snap.connection === "disconnected"
            ? <button type="button" className="pr-primary" data-testid="button-bridge-connect" disabled={busyAction === "connect" || snap.busy || snap.uncertainMotion} onClick={connect}>PC 브리지 연결</button>
            : <button type="button" data-testid="button-bridge-disconnect" onClick={() => session.disconnect()}>{snap.connection === "connecting" ? "연결 중 · 취소" : "연결 해제"}</button>}
        </div>
        {snap.source === "mock" && <p className="pr-warn">{MOCK_LABEL}: 이 브리지는 모의 응답을 보냅니다. 학습 기록에 실측으로 취급되지 않습니다.</p>}
        {snap.uncertainMotion && <div className="pr-err">실제 정지 여부가 확인되지 않았습니다. 로봇이 멈춰 있는 것을 현장에서 직접 확인한 뒤 눌러 주세요.
          <div className="pr-row"><button type="button" data-testid="button-ack-stop" onClick={() => { try { session.acknowledgePhysicalStop(); } catch (e) { setLocalError(e instanceof Error ? e.message : ""); } }}>현장에서 정지를 확인했습니다</button></div></div>}

        <h3>3. 실시간 측정</h3>
        <MeasurementReadout snap={snap} now={now}/>

        <h3 data-testid="preparation-heading">4. 준비 확인 · 보정</h3>
        <InstallationProfiles/>
        <p className="pr-note">사람이 DobotStudio Pro와 현장 설치에서 확인한 값입니다. 센서의 장애물·공구·배선·교정 검증이 아닙니다. 같은 연결·설정에서는 확인을 재사용하며, 관련 값이나 연결이 바뀌면 다시 확인합니다.</p>
        {CHECKS.map(c => <label key={c.key} className="pr-check"><input type="checkbox" checked={draft.verified[c.key]} disabled={snap.busy}
          data-testid={`check-${c.key}`} onChange={e => setDraft({ verified: { ...draft.verified, [c.key]: e.target.checked } })}/>{c.label}</label>)}
        <div className="pr-grid4" style={{ marginTop: 6 }}>
          <Num label="User" value={draft.user} step="1" onChange={v => setDraft({ user: v })}/>
          <Num label="Tool" value={draft.tool} step="1" onChange={v => setDraft({ tool: v })}/>
          <Num label="흡착 DO" value={draft.suctionDO} step="1" onChange={v => setDraft({ suctionDO: v })}/>
          <Num label="해제 DO" value={draft.releaseDO} step="1" onChange={v => setDraft({ releaseDO: Number.isNaN(v) ? null : v })}/>
          <Num label="진공 DI" value={draft.vacuumDI} step="1" onChange={v => setDraft({ vacuumDI: Number.isNaN(v) ? null : v })}/>
          <label>출력 극성<select value={draft.activeHigh ? "high" : "low"} onChange={e => setDraft({ activeHigh: e.target.value === "high" })}><option value="high">High=켜짐</option><option value="low">Low=켜짐</option></select></label>
          <Num label="속도 %" value={draft.speed} onChange={v => setDraft({ speed: v })}/>
          <Num label="위치 허용 mm" value={draft.positionTolerance} onChange={v => setDraft({ positionTolerance: v })}/>
          <Num label="방향 허용 deg" value={draft.rotationTolerance} onChange={v => setDraft({ rotationTolerance: v })}/>
        </div>
        <p className="pr-note">작업 범위 — 아래 기본 입력값은 현장 안전성을 인증한 범위가 아닙니다. 설치에서 검증한 프로필을 선택하거나 담당자가 각 경계를 확인하세요. 제조사 최대 도달 범위는 안전한 직육면체 작업 공간을 뜻하지 않습니다. 공구/TCP·지그·장애물·바닥·케이블 여유와 User 원점이 확인되지 않으면 실행하지 마세요.</p>
        <div className="pr-grid4">
          {(["xMin", "xMax", "yMin", "yMax", "zMin", "zMax", "rMin", "rMax"] as const).map(k =>
            <Num key={k} label={k} value={draft.workspace[k]} onChange={v => ws(k, v)}/>)}
        </div>
        {problem && !snap.setup && <p className="pr-note">{problem}</p>}
        <div className="pr-row">
          <button type="button" className="pr-primary" data-testid="button-apply-setup"
            disabled={!!problem || snap.connection !== "connected" || !fresh || snap.busy || !!m?.moving || snap.uncertainMotion
              || JSON.stringify(draft)===JSON.stringify(snap.setup) || busyAction === "setup"} onClick={applySetup}>준비 설정 적용</button>
          {snap.setup && <span className="pr-badge hw">현재 적용 속도 {snap.setup.speed}% · 변경 예정 {draft.speed}%{JSON.stringify(draft)!==JSON.stringify(snap.setup)?" · 변경 미적용":" · 설정 적용됨"}</span>}
        </div>

        <h3>5. 수동 조작 · 별도 확인</h3>
        <div className="pr-row">
          <button type="button" data-testid="button-servo-on" disabled={!snap.setup || !!m?.enabled || snap.busy} onClick={() => toggleServo(true)}>서보 활성화</button>
          <button type="button" data-testid="button-servo-off" disabled={!snap.setup || !m?.enabled || snap.busy} onClick={() => toggleServo(false)}>서보 비활성화</button>
        </div>
        <div className="pr-grid4" style={{ marginTop: 6 }}>
          {(["x", "y", "z", "r"] as const).map(k => <label key={k}>{k.toUpperCase()}<input type="number" step="any" value={target[k]} onChange={e => setTarget({ ...target, [k]: e.target.value })}/></label>)}
        </div>
        <div className="pr-row">
          <button type="button" data-testid="button-move-j" disabled={!snap.setup || snap.busy} onClick={() => move("MoveJ")}>MoveJ 이동</button>
          <button type="button" data-testid="button-move-l" disabled={!snap.setup || snap.busy} onClick={() => move("MoveL")}>MoveL 이동</button>
          <button type="button" data-testid="button-suction-on" disabled={!snap.setup || snap.busy} onClick={() => suction(true)}>흡착 켜기</button>
          <button type="button" data-testid="button-suction-off" disabled={!snap.setup || snap.busy} onClick={() => suction(false)}>흡착 끄기</button>
        </div>
        <div className="pr-row">
          <button type="button" className="pr-danger" data-testid="button-practice-stop" onClick={stop}>화면 중단 요청</button>
        </div>
        <p className="pr-warn">화면 중단은 물리 비상정지가 아닙니다. 흡착은 자동으로 끄지 않습니다. 위험하면 로봇의 물리 비상정지를 누르세요.</p>

        {p.journal.length > 0 && <>
          <h3>실측 기록 (이번 세션)</h3>
          <ul className="pr-note" style={{ paddingLeft: 16 }} data-testid="list-journal">
            {p.journal.slice(0, 8).map(j => <li key={j.id}>{j.source === "mock" ? "[모의] " : "[실측] "}{j.label} · {describeOperation(j.operation, snap.setup)} → X {fx(j.measurement.pose.x)} Y {fx(j.measurement.pose.y)} Z {fx(j.measurement.pose.z)} R {fx(j.measurement.pose.r)}</li>)}
          </ul></>}
      </>}
    </div>, panelContainer || document.body)}
  </>;
}



