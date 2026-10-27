import type { LearningAiController } from "./LearningAiFeedback";

const entries=new Map<string,LearningAiController>();
const listeners=new Set<()=>void>();
let snapshot:LearningAiController|null=null;
function emit() {
  snapshot=[...entries.values()].at(-1)??null;
  listeners.forEach(listener=>listener());
}
export function updateTutor(token:string,ai:LearningAiController) {
  entries.set(token,ai);emit();
}
export function unregisterTutor(token:string) { entries.delete(token);emit(); }
export const subscribeTutor=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};
export const tutorSnapshot=()=>snapshot;
