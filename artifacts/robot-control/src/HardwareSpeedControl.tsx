import {useRef,useState} from "react";
import {usePractice} from "./PracticeProvider";
import {installationKey,measurementFresh,setupProblem} from "./practiceSession";

/** All physical operations consume the acknowledged session setup, never this draft. */
export function HardwareSpeedControl(){
  const p=usePractice(),latest=useRef(p);latest.current=p;
  const [error,setError]=useState(""),[pending,setPending]=useState(false);
  if(!p.hardware)return null;
  const {snap,session,setupDraft:draft}=p,applied=snap.setup;
  const sameTarget=()=>{try{return new URL(latest.current.bridgeUrl).href===session.getBridgeUrl();}catch{return false;}};
  const invalid=!Number.isFinite(draft.speed)||draft.speed<1||draft.speed>20;
  const installationChanged=!applied||installationKey(draft)!==installationKey(applied)||!!setupProblem({...draft,speed:applied.speed});
  const blocked=pending||snap.busy||!sameTarget()||snap.connection!=="connected"||!measurementFresh(snap.measurement)||!!snap.measurement?.moving
    ||!!snap.measurement?.error||![4,5].includes(snap.measurement?.robotMode??0)||snap.uncertainMotion;
  const apply=async()=>{
    if(!applied)return;
    const speed=draft.speed,connection=session.getConnectionId();setPending(true);setError("");
    try{
      const yes=await p.confirm("실장비 속도 변경 확인",[
        `현재 적용 ${applied.speed}% → 변경 예정 ${speed}%`,
        "최신 측정상 정지 상태에서 속도 설정만 전달합니다. 서보·이동·흡착 명령은 보내지 않습니다.",
        "수동 이동·과제 실행·과제 시작점 이동에 같은 비율을 사용합니다. 비율은 실제 TCP 속도(mm/s) 실측값이 아닙니다.",
      ],"정지 상태에서 속도 적용");
      if(!yes)return;
      if(!sameTarget()||session.getSnapshot().setup!==applied||session.getConnectionId()!==connection
        ||latest.current.setupDraft.speed!==speed||installationKey(latest.current.setupDraft)!==installationKey(applied)
        ||setupProblem({...latest.current.setupDraft,speed}))
        throw new Error("확인 중 설정이나 연결이 변경되었습니다. 다시 확인하세요.");
      await session.applySpeed(speed);
    }catch(e){setError(e instanceof Error?e.message:"속도 적용 실패");}
    finally{setPending(false);}
  };
  return <section className="pr-speed-control" aria-label="공통 실장비 속도" data-testid="hardware-speed-control"
    style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:8,padding:"7px 12px",background:"#fff7df",flexShrink:0,fontSize:12}}>
    <strong data-testid="applied-hardware-speed">현재 적용: {applied?`${applied.speed}% (브리지 응답 확인)`:"미확인 · 준비 필요"}</strong>
    <label>변경 예정 속도 %
      <input aria-label="변경 예정 실장비 속도" type="number" min={1} max={20} step={1} value={Number.isFinite(draft.speed)?draft.speed:""}
        disabled={blocked} style={{width:58,marginLeft:6}} onChange={e=>p.setSetupDraft({...draft,speed:e.target.value===""?NaN:Number(e.target.value)})}/>
    </label>
    <input aria-label="실장비 저속 비율" type="range" min={1} max={20} step={1}
      value={Number.isFinite(draft.speed)?Math.min(20,Math.max(1,draft.speed)):5} disabled={blocked}
      onChange={e=>p.setSetupDraft({...draft,speed:Number(e.target.value)})}/>
    <button type="button" data-testid="button-apply-speed" disabled={blocked||invalid||installationChanged||applied?.speed===draft.speed}
      onClick={()=>void apply()}>{pending?"적용 확인 중…":"정지 상태에서 속도 적용"}</button>
    <button type="button" onClick={()=>p.setPanelOpen(true)}>설치 프로필·준비 설정</button>
    <span>1~20% · 기본 5% · 수동/과제/시작점 공통 · 변경 예정 값은 적용 전까지 사용하지 않음</span>
    {installationChanged&&<span>설치 확인·설정 적용이 먼저 필요합니다.</span>}
    {!sameTarget()&&snap.connection==="connected"&&<span>입력한 연결 대상이 다릅니다. 대상에 재연결하고 설치를 확인하세요.</span>}
    {error&&<span role="alert">{error}</span>}
  </section>;
}
