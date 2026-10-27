import { getEvidenceItem, setEvidenceItem } from "./learningSync";
/** Student-scoped local backup plus durable, idempotent server outbox. */
export function readEvidence<T>(key:string, valid:(value:unknown)=>value is T):T[] {
  try {
    const parsed:unknown=JSON.parse(getEvidenceItem(key)??"[]");
    return Array.isArray(parsed)?parsed.filter(valid):[];
  } catch { return []; }
}
export function writeEvidence(key:string, records:unknown[]):boolean {
  try { setEvidenceItem(key,JSON.stringify(records));return true; }
  catch { return false; }
}
export function downloadEvidence(filename:string,value:unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
