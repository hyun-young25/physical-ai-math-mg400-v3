import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import FeedbackOperatorStatus from "./FeedbackOperatorStatus";
import {
  downloadTeacherCsv, listLearningStudents, listTeacherRecords,
  type LearningEvent, type LearningFilter, type LearningStudent, type LearningUser,
} from "./learningClient";
import "./learningAccounts.css";

const CHAPTERS = ["기초수학","좌표와 이동","도형 경로","운동학","픽앤플레이스","공정 확장","실장비 조작"];
const PAGE = 100;

const FIELD_DESC: Record<string, string> = {
  feedbackStatus:"맞춤 피드백 상태(requested 요청·displayed 실제 제공·discarded 답 변경/화면 종료로 미제공)",
  provider:"피드백 출처(openai AI 생성·rules 기본 안내)", trigger:"요청 계기",
  initialPrediction:"최초 예측과 풀이", execution:"출처·전후 위치·시점·실행 결과",
  history:"동일 문제의 이전 답·수정과 실제 제공 힌트", judgment:"기존 수학 판정(변경하지 않음)",
  text:"실제로 제공한 피드백 문장", support:"지원/도전 방식", createdAt:"피드백 생성 시각",
  answer: "학생이 제출한 답", correct: "정답 여부", score: "점수", attempts: "시도 횟수", attempt: "시도 번호",
  x: "X 좌표(mm)", y: "Y 좌표(mm)", z: "Z 좌표(mm)", r: "회전 각도(도)", j1: "J1 관절 각도", j2: "J2 관절 각도",
  j3: "J3 관절 각도", j4: "J4 관절 각도", level: "난이도", status: "진행 상태", completed: "완료 여부",
  duration: "소요 시간", elapsed: "경과 시간", step: "단계", question: "문항", value: "입력 값",
};
const describe = (path: string) => FIELD_DESC[path.split(".").pop()!.replace(/\[\d+\]$/, "")] ?? "";

function flatten(v: unknown, prefix = "", out: [string, string][] = []): [string, string][] {
  if (v !== null && typeof v === "object") {
    const entries = Array.isArray(v) ? v.map((x, i) => [`[${i}]`, x] as const) : Object.entries(v);
    if (!entries.length) out.push([prefix || "(비어 있음)", Array.isArray(v) ? "[]" : "{}"]);
    for (const [k, x] of entries) flatten(x, Array.isArray(v) ? `${prefix}${k}` : prefix ? `${prefix}.${k}` : String(k), out);
  } else out.push([prefix || "(값)", v === null ? "null" : typeof v === "string" ? v : JSON.stringify(v)]);
  return out;
}
const dayStartIso = (d: string) => { const [y,m,dd] = d.split("-").map(Number); return new Date(y, m-1, dd).toISOString(); };
const nextDayIso = (d: string) => { const [y,m,dd] = d.split("-").map(Number); return new Date(y, m-1, dd+1).toISOString(); };
const fmt = (s: string | null) => s ? new Date(s).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "medium" }) : "-";
const msg = (e: unknown, f: string) => e instanceof Error ? e.message : f;

export default function LearningTeacher({ user, onLogout }: { user: LearningUser; onLogout: () => void }) {
  const [students, setStudents] = useState<LearningStudent[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState("");

  const [login, setLogin] = useState("");
  const [chapter, setChapter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);

  const [records, setRecords] = useState<LearningEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [recLoading, setRecLoading] = useState(true);
  const [recError, setRecError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const reqId = useRef(0);

  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState("");

  const loadMeta = useCallback(async () => {
    setMetaLoading(true); setMetaError("");
    try {
      const s = await listLearningStudents();
      setStudents(s.students);
    } catch (e) { setMetaError(msg(e, "학생 정보를 불러오지 못했습니다.")); }
    finally { setMetaLoading(false); }
  }, []);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  const filter = useMemo<LearningFilter>(() => ({
    login: login || undefined, chapter: chapter || undefined,
    from: from ? dayStartIso(from) : undefined, to: to ? nextDayIso(to) : undefined,
  }), [login, chapter, from, to]);
  const dateInvalid = !!from && !!to && from > to;

  const loadRecords = useCallback(async () => {
    const id = ++reqId.current;
    if (dateInvalid) { setRecLoading(false); setRecords([]); setTotal(0); setRecError("시작일이 종료일보다 늦습니다."); return; }
    setRecLoading(true); setRecError("");
    try {
      const r = await listTeacherRecords(filter, offset);
      if (id !== reqId.current) return;
      setRecords(r.records); setTotal(r.total);
    } catch (e) { if (id === reqId.current) setRecError(msg(e, "학습 기록을 불러오지 못했습니다.")); }
    finally { if (id === reqId.current) setRecLoading(false); }
  }, [filter, offset, dateInvalid]);
  useEffect(() => { loadRecords(); }, [loadRecords]);
  useEffect(()=>{
    const timer=setInterval(()=>{if(document.visibilityState==="visible"){void loadMeta();void loadRecords();}},15000);
    return()=>clearInterval(timer);
  },[loadMeta,loadRecords]);

  const resetPage = () => { setOffset(0); setOpen(null); };
  async function csv(all: boolean) {
    setCsvBusy(true); setCsvError("");
    try { await downloadTeacherCsv(all ? {} : filter); }
    catch (e) { setCsvError(msg(e, "CSV를 내려받지 못했습니다.")); }
    finally { setCsvBusy(false); }
  }

  const sel = students.filter(s => !login || s.login === login);
  const sumEvents = sel.reduce((a, s) => a + s.record_count, 0);
  const sumAttempts = sel.reduce((a, s) => a + s.attempt_count, 0);

  return (
    <div className="la-root la-shell">
      <header className="la-bar">
        <strong style={{ fontSize: 14 }}>MG400 학습 기록</strong>
        <span style={{ fontSize: 12, color: "#999" }}>교사용</span>
        <span className="who">{user.login} 선생님</span>
        <button className="la-btn ghost sm" type="button" onClick={onLogout}>로그아웃</button>
      </header>
      <div className="la-main">
        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="la-panel">
            <div className="la-row" style={{ justifyContent: "space-between" }}>
              <h3>학생 아이디별 기록</h3>
              <button className="la-btn ghost sm" type="button" onClick={loadMeta}>새로고침</button>
            </div>
            {metaError && <div className="la-error" role="alert">{metaError} <button className="la-btn ghost sm" type="button" onClick={loadMeta}>다시 시도</button></div>}
            {metaLoading ? <div className="la-skel"/> : (
              <div className="la-list">
                <button type="button" className="la-li" aria-pressed={!login} onClick={() => { setLogin(""); resetPage(); }}><span>전체 아이디</span><small>{students.length}개</small></button>
                {students.map(s => (
                  <button key={s.id} type="button" className="la-li" aria-pressed={login === s.login}
                    onClick={() => { setLogin(s.login); resetPage(); }}
                    title={`최근 활동 ${fmt(s.last_activity)}`}>
                    <span>{s.login}</span>
                    <small>사건 {s.record_count} / 기록 묶음 {s.attempt_count}</small>
                  </button>
                ))}
                {!students.length && <div className="la-empty" style={{ padding: 12 }}>아직 학습을 시작한 학생이 없습니다.</div>}
              </div>
            )}
          </section>
        </aside>

        <main style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <FeedbackOperatorStatus/>
          <section className="la-panel">
            <div className="la-filters">
              <label className="la-field">학생
                <select className="la-input" value={login} onChange={e => { setLogin(e.target.value); resetPage(); }}>
                  <option value="">전체</option>
                  {students.map(s => <option key={s.login} value={s.login}>{s.login}</option>)}
                </select>
              </label>
              <label className="la-field">단원
                <select className="la-input" value={chapter} onChange={e => { setChapter(e.target.value); resetPage(); }}>
                  <option value="">전체</option>
                  {CHAPTERS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="la-field">시작일<input className="la-input" type="date" value={from} onChange={e => { setFrom(e.target.value); resetPage(); }} /></label>
              <label className="la-field">종료일(포함)<input className="la-input" type="date" value={to} onChange={e => { setTo(e.target.value); resetPage(); }} /></label>
              <button className="la-btn ghost" type="button" onClick={() => { setLogin(""); setChapter(""); setFrom(""); setTo(""); resetPage(); }}>필터 초기화</button>
            </div>
            <div className="la-row" style={{ justifyContent: "space-between", fontSize: 12.5 }}>
              <span>
                조건에 맞는 이벤트 <strong>{total.toLocaleString()}</strong>건
                <span className="la-hint"> · 선택 학생 누적: 기록 이벤트 {sumEvents.toLocaleString()}건, 기록 묶음 {sumAttempts.toLocaleString()}개</span>
              </span>
              <span className="la-row">
                <button className="la-btn ghost sm" type="button" disabled={csvBusy || dateInvalid} onClick={() => csv(false)}>현재 조건 CSV</button>
                <button className="la-btn sm" type="button" disabled={csvBusy} onClick={() => csv(true)}>전체 CSV</button>
              </span>
            </div>
            <div className="la-hint" style={{ fontSize: 11 }}>사건은 제출·확정·실행·지원 등 기록 변경 이력입니다. 기록 묶음에는 여러 좌표 시도가 함께 들어갈 수 있습니다. 실제 시도 ID와 실행 회차는 원문 항목에서 구분합니다. CSV는 중첩 항목을 ‘항목 경로 / 값’으로 펼치므로 사건 한 건이 여러 행이 됩니다. 별도 이해도 시험 결과가 아닙니다.</div>
            {csvError && <div className="la-error" role="alert">{csvError}</div>}
          </section>

          <section className="la-panel">
            {recError && <div className="la-error" role="alert">{recError} {!dateInvalid && <button className="la-btn ghost sm" type="button" onClick={loadRecords}>다시 시도</button>}</div>}
            {recLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{Array.from({ length: 6 }, (_, i) => <div key={i} className="la-skel" />)}</div>
            ) : !records.length && !recError ? (
              <div className="la-empty">조건에 맞는 학습 기록이 없습니다.<br /><span className="la-hint">필터를 넓히거나 학생이 학습을 시작했는지 확인하세요.</span></div>
            ) : records.length > 0 && (
              <div className="la-scroll">
                <table className="la-table">
                  <thead><tr><th>발생 시각</th><th>학생 아이디</th><th>단원</th><th>과제</th><th>종류</th><th>변경 항목</th><th></th></tr></thead>
                  <tbody>
                    {records.map(r => {
                      const isOpen = open === r.event_id;
                      return (
                        <Fragment key={r.event_id}>
                          <tr className={isOpen ? "open" : ""}>
                            <td>{fmt(r.occurred_at)}</td><td>{r.login}</td><td>{r.chapter}</td><td>{r.task}</td>
                            <td><span className="la-pill">{r.event_kind}</span></td>
                            <td>{r.changed_paths.length}개</td>
                            <td><button className="la-btn ghost sm" type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.event_id)}>{isOpen ? "접기" : "자세히"}</button></td>
                          </tr>
                          {isOpen && (
                            <tr className="open"><td colSpan={7}>
                              <div className="la-hint" style={{ marginBottom: 8, fontSize: 11 }}>
                                순번 {r.sequence} · 수신 {fmt(r.received_at)} · 기록 {r.store_key}/{r.record_id} · 콘텐츠 {r.content_version} · 출처 {r.data_source}
                              </div>
                              {r.changed_paths.length > 0 && <div style={{ fontSize: 12, marginBottom: 8 }}>변경된 경로: {r.changed_paths.map(p => <code key={p} className="la-pill" style={{ marginRight: 4 }}>{p}</code>)}</div>}
                              <div className="la-payload">
                                {flatten(r.payload).map(([p, v]) => (
                                  <Fragment key={p}>
                                    <span className="p" style={r.changed_paths.includes(p) ? { fontWeight: 700 } : undefined}>{p}</span>
                                    <span className="v">{v}</span>
                                    {describe(p) && <span className="d">{describe(p)}</span>}
                                  </Fragment>
                                ))}
                              </div>
                            </td></tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {total > PAGE && (
              <div className="la-row" style={{ justifyContent: "flex-end", fontSize: 12 }}>
                <span>{offset + 1}–{Math.min(offset + PAGE, total)} / {total.toLocaleString()}</span>
                <button className="la-btn ghost sm" type="button" disabled={offset === 0 || recLoading} onClick={() => { setOffset(Math.max(0, offset - PAGE)); setOpen(null); }}>이전</button>
                <button className="la-btn ghost sm" type="button" disabled={offset + PAGE >= total || recLoading} onClick={() => { setOffset(offset + PAGE); setOpen(null); }}>다음</button>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
