import {useRef,useState} from "react";
import {usePractice} from "./PracticeProvider";
import {defaultPracticeSetup,installationKey,MG400_ROBOT_IP,setupProblem,type PracticeSetup} from "./practiceSession";

const KEY="mg400-human-installation-profiles-v1";
type Profile={id:string;name:string;bridge:string;robot:string;source:"hardware"|"mock";confirmedAt:string;setup:PracticeSetup};
function read():{profiles:Profile[];error:string}{
  try{
    const raw=localStorage.getItem(KEY);if(!raw)return {profiles:[],error:""};
    const values:unknown=JSON.parse(raw);
    if(!Array.isArray(values)||values.length>12)throw Error();
    const profiles=values as Profile[];
    for(const v of profiles){
      if(!v||typeof v.name!=="string"||v.name.length>60||typeof v.id!=="string"||v.robot!==MG400_ROBOT_IP
        ||!["hardware","mock"].includes(v.source)||!Number.isFinite(Date.parse(v.confirmedAt))||setupProblem(v.setup))throw Error();
      const url=new URL(v.bridge);if(!["ws:","wss:"].includes(url.protocol)||url.username||url.password)throw Error();
    }
    return {profiles,error:""};
  }catch{return {profiles:[],error:"저장 프로필을 읽지 못했습니다. 기존 내용은 자동 적용하지 않습니다. 설치 값을 직접 확인하세요."};}
}
export default function InstallationProfiles(){
  const p=usePractice(),latest=useRef(p);latest.current=p;
  const [stored,setStored]=useState(read),[selected,setSelected]=useState(()=>stored.profiles[0]?.id??""),[name,setName]=useState(""),[error,setError]=useState("");
  const profile=stored.profiles.find(v=>v.id===selected),s=p.snap.setup;
  const save=()=>{
    setError("");
    if(stored.error)return setError("읽을 수 없는 기존 프로필을 덮어쓰지 않습니다. 저장 상태를 먼저 확인하세요.");
    if(!name.trim()||!s||setupProblem(p.setupDraft)||installationKey(s)!==installationKey(p.setupDraft))
      return setError("설치 확인과 설정 적용을 완료하고 프로필 이름을 입력하세요. 미적용 값은 저장하지 않습니다.");
    try{
      if(stored.profiles.length>=12&&!stored.profiles.some(v=>v.name===name.trim()))throw new Error("limit");
      const next:Profile={id:crypto.randomUUID(),name:name.trim().slice(0,60),robot:MG400_ROBOT_IP,bridge:p.session.getBridgeUrl(),
        source:p.snap.source!,confirmedAt:new Date().toISOString(),setup:structuredClone(s)};
      const profiles=[next,...stored.profiles.filter(v=>v.name!==next.name)];
      localStorage.setItem(KEY,JSON.stringify(profiles));setStored({profiles,error:""});setSelected(next.id);
    }catch{setError("프로필을 저장하지 못했습니다. 최대 12개와 브라우저 저장 권한을 확인하세요. 기존 프로필은 유지합니다.");}
  };
  const load=()=>{
    if(!profile)return;
    p.setBridgeUrl(profile.bridge);
    p.setSetupDraft({...structuredClone(profile.setup),verified:defaultPracticeSetup().verified});
    setError("프로필 값만 불러왔습니다. 이전 사람 확인은 현재 세션의 자동 확인이 아닙니다. 설치·주변 조건을 다시 확인하세요.");
  };
  const reuse=async()=>{
    if(!profile)return;
    setError("");
    const connection=p.session.getConnectionId();
    const approvedDraft=structuredClone(p.setupDraft);
    const same=()=>{
      try{return new URL(latest.current.bridgeUrl).href===profile.bridge&&p.session.getBridgeUrl()===profile.bridge
        &&p.session.getSnapshot().source===profile.source&&p.session.getSnapshot().connection==="connected";}
      catch{return false;}
    };
    if(!same()||installationKey(p.setupDraft)!==installationKey(profile.setup))
      return setError("연결 대상·출처 또는 설치 설정이 저장 프로필과 다릅니다. 값을 불러온 후 연결하고, 변경된 항목은 직접 확인하세요.");
    try{
      const yes=await p.confirm("저장 설치 프로필 재확인",[
        `${profile.name} · ${profile.robot} · ${profile.bridge} · ${profile.source==="mock"?"모의 통신 — 실장비 검증 아님":"사람이 확인한 실장비 설치"}`,
        `이전 사람 확인: ${new Date(profile.confirmedAt).toLocaleString("ko-KR")}`,
        "IP·펌웨어·User 원점·Tool TCP/교정·IO 배선·검증 범위·장애물·주변 조건이 동일한지 사람이 직접 확인합니다.",
        `User ${profile.setup.user} / Tool ${profile.setup.tool} · 흡착 DO${profile.setup.suctionDO} · 속도 변경 예정 ${p.setupDraft.speed}%`,
        `작업 범위 ${JSON.stringify(profile.setup.workspace)}`,
        "저장 정보는 센서 검증이 아닙니다. 달라진 항목이 있으면 취소하고 해당 설치를 다시 점검하세요. 설정만 적용하며 이동하지 않습니다.",
      ],"설치 및 주변 조건이 동일함을 확인하고 적용");
      if(!yes)return;
      if(!same()||connection!==p.session.getConnectionId()||JSON.stringify(latest.current.setupDraft)!==JSON.stringify(approvedDraft))
        throw new Error("연결 또는 설정이 변경되었습니다. 다시 확인하세요.");
      const candidate={...approvedDraft,verified:{...profile.setup.verified}};
      await p.session.applySetup(candidate);
      p.setSetupDraft(candidate);
    }catch(e){setError(e instanceof Error?e.message:"프로필 적용 실패");}
  };
  return <section aria-label="사용자 확인 설치 프로필">
    <h4>설치 프로필 · 사람 확인 기록</h4>
    <p className="pr-note">이 브라우저에 설치 값만 저장합니다. 자동 연결·이동·센서 검증은 하지 않습니다. 새 연결은 재확인이 필요합니다.</p>
    <label>프로필 이름<input value={name} maxLength={60} onChange={e=>setName(e.target.value)}/></label>
    <small>같은 이름으로 저장하면 해당 프로필을 현재 적용 값으로 갱신합니다.</small>
    <button type="button" data-testid="button-save-installation" disabled={!s||p.snap.busy} onClick={save}>현재 적용·확인한 설치 프로필 저장</button>
    <label>저장 설치 프로필<select value={selected} onChange={e=>setSelected(e.target.value)}>
      <option value="">프로필 선택</option>{stored.profiles.map(v=><option key={v.id} value={v.id}>{v.name} ({v.source==="mock"?"모의":"사람 확인"})</option>)}
    </select></label>
    {profile&&<>
      <p>저장 확인 {new Date(profile.confirmedAt).toLocaleString("ko-KR")} · {profile.robot} · User {profile.setup.user} / Tool {profile.setup.tool} ·
        DO {profile.setup.suctionDO}/{profile.setup.releaseDO??"없음"} · DI {profile.setup.vacuumDI??"없음"} · 저장 속도 {profile.setup.speed}%</p>
      <p>저장 작업 범위: {Object.entries(profile.setup.workspace).map(([k,v])=>`${k}=${v}`).join(" / ")}</p>
      <button type="button" disabled={p.snap.busy||!!p.snap.measurement?.moving} onClick={load}>설치 값만 불러오기 · 미적용</button>
      <button type="button" data-testid="button-reuse-installation" disabled={p.snap.busy||!!p.snap.measurement?.moving||p.snap.connection!=="connected"}
        onClick={()=>void reuse()}>설치 및 주변 조건이 동일함을 확인하고 적용</button>
    </>}
    {(stored.error||error)&&<p role="status">{stored.error||error}</p>}
  </section>;
}
