import { useEffect,useState,useSyncExternalStore,type ComponentType } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import LearningEntry from "./LearningEntry";
import LearningTeacher from "./LearningTeacher";
import { getOwnerIdentity,setLearningUser,type LearningUser } from "./learningClient";
import { initializeLearningSync,stopLearningSync,flushLearningQueue,canLeaveLearningVisit,getLearningSaveState,subscribeLearningSave } from "./learningSync";
import "./learningAccounts.css";
export default function LearningShell(){
  const auth=useAuth({basePath:import.meta.env.BASE_URL});
  const professor=new URLSearchParams(window.location.search).get("professor")==="1";
  const [user,setUser]=useState<LearningUser|null>(null),[Content,setContent]=useState<ComponentType|null>(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState("");
  const state=useSyncExternalStore(subscribeLearningSave,getLearningSaveState);
  useEffect(()=>{void flushLearningQueue();},[]);
  async function loadLearningApp(){
    let lastError:unknown;
    // A transient failure to fetch Vite's lazy App module must not strand a
    // learner after their visit has already been created and saved.
    for(let attempt=0;attempt<2;attempt++){
      try{return await import("./App");}
      catch(error){
        lastError=error;
        if(attempt===0)await new Promise(resolve=>setTimeout(resolve,350));
      }
    }
    throw lastError;
  }
  useEffect(()=>{
    if(!professor||auth.isLoading)return;
    if(!auth.isAuthenticated)return;
    let live=true;
    getOwnerIdentity().then(({user:owner})=>{if(live){setLearningUser(owner);setUser(owner);}})
      .catch(err=>{if(live)setError(err instanceof Error?err.message:"소유자 권한을 확인하지 못했습니다.");});
    return()=>{live=false;};
  },[professor,auth.isLoading,auth.isAuthenticated]);
  async function prepare(next:LearningUser){
    setLoading(true);setError("");setUser(next);
    try{
      // No historical hydration. Every ID entry is a new, write-only visit.
      await initializeLearningSync(next);
      const {default:App}=await loadLearningApp();setContent(()=>App);
    }catch(err){setError(err instanceof Error?err.message:"학습 화면을 불러오지 못했습니다.");}
    finally{setLoading(false);}
  }
  async function changeStudent(){
    setContent(null);
    await new Promise(resolve=>setTimeout(resolve,0));
    await flushLearningQueue();
    if(!canLeaveLearningVisit()){
      setError("전송 실패와 브라우저 임시 저장 실패가 겹쳤습니다. 연결을 복구한 후 다시 전송하고 학생을 변경하세요.");
      return;
    }
    stopLearningSync();setLearningUser(null);
    // Reset every lesson cache and robot state; old pending visits keep original attribution.
    window.location.assign(import.meta.env.BASE_URL);
  }
  if(professor){
    if(user?.role==="teacher")return <LearningTeacher user={user} onLogout={auth.logout}/>;
    return <section className="la-root"><div className="la-card"><div className="la-body">
      <h2>교수자</h2>
      {auth.isLoading?<p role="status">계정 인증을 확인하는 중입니다.</p>
        :!auth.isAuthenticated?<><p>프로젝트 소유자 계정으로 인증해야 학습 기록을 확인할 수 있습니다.</p><button className="la-btn" onClick={auth.login}>로그인</button></>
        :error?<><p className="la-error" role="alert">{error}</p><p className="la-hint">현재 인증된 계정 ID: <code>{auth.user?.id}</code></p><button className="la-btn ghost" onClick={auth.logout}>로그아웃</button></>
        :<p role="status">프로젝트 소유자 권한을 확인하는 중입니다.</p>}
      <a href={import.meta.env.BASE_URL}>학생 화면으로</a>
    </div></div></section>;
  }
  if(!user)return <LearningEntry onEnter={next=>{void prepare(next);}} onProfessor={auth.login}/>;
  return <>
    <header className="learning-student-bar">
      <strong>{user.login}</strong>
      <small role="status" className={`learning-save-${state.state}`}>{state.message}</small>
      {state.state==="failed"&&<button onClick={()=>{void flushLearningQueue();}}>다시 전송</button>}
      <button onClick={()=>{void changeStudent();}}>학생 변경</button>
      <button className="learning-professor-inline" onClick={auth.login}>교수자</button>
    </header>
    {loading?<p className="learning-shell-message" role="status">학습을 시작하는 중입니다.</p>
      :error?<section className="learning-shell-error" role="alert"><p>{error}</p><button disabled={!canLeaveLearningVisit()} onClick={()=>{void prepare(user);}}>다시 불러오기</button></section>
      :Content?<Content/>:null}
  </>;
}
