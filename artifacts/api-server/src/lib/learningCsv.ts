type Obj = Record<string, unknown>;
export function flattenValues(value: unknown, path = "", output: [string, unknown][] = []): [string, unknown][] {
  if (value === null || typeof value !== "object") output.push([path, value]);
  else if (Array.isArray(value)) {
    if (!value.length) output.push([path, "[]"]);
    value.forEach((v, i) => flattenValues(v, `${path}[${i}]`, output));
  } else {
    const entries = Object.entries(value);
    if (!entries.length) output.push([path, "{}"]);
    for (const [key, v] of entries) flattenValues(v, path ? `${path}.${key}` : key, output);
  }
  return output;
}
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Leading whitespace/control characters cannot disguise an Excel formula.
  if (typeof value !== "number" && (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export const CSV_HEADERS = ["수업 코드","학생 아이디","단원","과제","기록 ID","사건 ID","사건 종류",
  "기록 시각(UTC)","서버 수신 시각(UTC)","콘텐츠 버전","출처","최초 예측","수정·확정값",
  "실행 결과","지원 사용","근거·비교·해석","독립 수행","변경 경로","학습 방문 ID","항목 경로","항목 값"];
function overview(value: unknown) {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 2000 ? text.slice(0,2000) + " … [전체 값은 아래 항목 경로/값 참조]" : text;
}
export function* csvRows(event: Obj) {
  const p = event.payload as Obj ?? {};
  const base = [event.class_code,event.login,event.chapter,event.task,event.record_id,event.event_id,event.event_kind,
    event.occurred_at instanceof Date ? event.occurred_at.toISOString() : event.occurred_at,
    event.received_at instanceof Date ? event.received_at.toISOString() : event.received_at,event.content_version,event.data_source,
    overview(p.prediction ?? p.answers ?? p.predictions), overview(p.answerReviews ?? p.revisions ?? p.draft),
    overview(p.runs ?? p.outcome ?? p.results ?? p.executed),
    overview(p.feedbackEvents ?? p.supportRecords ?? p.hints),
    overview({ reason:p.reason, reflection:p.reflection, reflections:p.reflections, explanations:p.explanations, revisionPlan:p.revisionPlan }),
    (p.condition as Obj | undefined)?.independent ?? p.independent ?? "",overview(event.changed_paths),event.visit_id??""];
  let first = true;
  for (const [path,value] of flattenValues(p)) {
    // Large nested execution histories must not be repeated for every leaf.
    const columns = first ? base : base.map((v,i)=>i>=11&&i<=17?"":v);
    first = false;
    if (typeof value === "string" && value.length > 30000) {
      for (let offset=0;offset<value.length;offset+=30000)
        yield [...columns,`${path} (문자 ${offset}~${Math.min(offset+30000,value.length)})`,value.slice(offset,offset+30000)].map(csvCell).join(",")+"\r\n";
    } else yield [...columns,path,value].map(csvCell).join(",")+"\r\n";
  }
}
