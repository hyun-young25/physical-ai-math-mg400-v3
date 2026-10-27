import { useState,type FormEvent } from "react";
import { enterStudent,type LearningUser } from "./learningClient";
import "./learningAccounts.css";
export default function LearningEntry({onEnter,onProfessor}:{onEnter:(user:LearningUser)=>void;onProfessor:()=>void}){
  const [login,setLogin]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function start(e:FormEvent){
    e.preventDefault();if(!login.trim())return;
    setBusy(true);setError("");
    try{onEnter(await enterStudent({login:login.trim()}));}
    catch(err){setError(err instanceof Error?err.message:"학습을 시작하지 못했습니다.");}
    finally{setBusy(false);}
  }
  return <div className="la-root la-entry">
    <button type="button" className="learning-professor-link" onClick={onProfessor}>교수자</button>
    <div className="la-card">
      <div className="la-head"><div className="la-kicker">MG400 LEARNING</div><div className="la-title">MG400 수학 학습</div></div>
      <form className="la-body" onSubmit={start}>
        <label className="la-field">학생 아이디<input className="la-input" aria-label="학생 아이디" autoComplete="off" maxLength={60}
          value={login} onChange={e=>setLogin(e.target.value)} required/></label>
        {error&&<p className="la-error" role="alert">{error}</p>}
        <button className="la-btn" type="submit" disabled={busy||!login.trim()}>{busy?"시작 중...":"학습 시작"}</button>
      </form>
    </div>
  </div>;
}
