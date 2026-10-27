import { MODE_LABEL, type CoordinateMode, type CoordinateVector } from "./coordinateLearning";

export const coordinatePoint = (p: CoordinateVector) => `(${[p.x,p.y,p.z].map(n=>Number(n.toFixed(2))).join(", ")})`;
export const coordinateDelta = (p: CoordinateVector) => `(${[p.x,p.y,p.z].map(n=>`${n>0?"+":""}${Number(n.toFixed(2))}`).join(", ")})`;
export function CoordinateMeaning() {
  return <div className="coordinate-meaning">
    <div><strong>절대 이동 · 어디로?</strong><p>원점 O를 기준으로 한 <b>도착 위치</b>를 명령에 넣습니다.</p><p className="lesson-note">실행 출발점이 달라도 같은 위치를 지정합니다.</p></div>
    <div><strong>상대 이동 · 얼마나?</strong><p>실행할 때의 TCP 위치에서 이동할 <b>변화량</b>을 명령에 넣습니다.</p><p className="lesson-note">실행 출발점 + 변화량이 도착 위치입니다.</p></div>
    <p className="lesson-note">두 방식 모두 같은 로봇 기준축을 씁니다. 절대·상대는 좌표 표현 방식이며, MoveJ·MoveL은 이동 경로를 만드는 방식입니다. 이 실습은 모두 MoveL입니다.</p>
  </div>;
}
export function CoordinateCommandTable({ rows }: { rows: {
  mode: CoordinateMode; argument: CoordinateVector | null; from: CoordinateVector; to?: CoordinateVector;
}[] }) {
  return <div className="coordinate-command-readout">
    <table><caption>명령에 넣은 값과 실행 결과 구분 · (X, Y, Z), mm</caption>
      <thead><tr><th>표현 방식</th><th>명령에 넣은 값</th><th>DT 도착 좌표</th></tr></thead>
      <tbody>{rows.map((row,i)=><tr key={i}><th>{MODE_LABEL[row.mode]}</th>
        <td><small>{row.mode === "absolute" ? "원점 기준 위치" : "출발점에서의 변화량"}</small>
          {row.argument ? (row.mode === "absolute" ? coordinatePoint(row.argument) : coordinateDelta(row.argument)) : "입력 대기"}</td>
        <td>{row.to ? coordinatePoint(row.to) : "아직 실행하지 않음"}</td></tr>)}</tbody>
    </table>
    {rows.filter(row=>row.mode === "relative" && row.to && row.argument).map((row,i)=><p className="lesson-formula" key={i}>
      출발 위치 + 상대 명령의 변화량 = 도착 위치<br/>{coordinatePoint(row.from)} + {coordinateDelta(row.argument!)} = {coordinatePoint(row.to!)}
    </p>)}
  </div>;
}
