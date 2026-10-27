import { useEffect, useState } from "react";

export type TutorMode = "trial" | "gpt";
// Deliberately not persisted: opening/reloading the preview never opts into paid calls.
let mode: TutorMode = "trial";
const listeners = new Set<() => void>();
export function setTutorMode(next: TutorMode) {
  mode = next;
  listeners.forEach(notify => notify());
}
export function useTutorMode(): TutorMode {
  const [value, setValue] = useState(mode);
  useEffect(() => {
    const notify = () => setValue(mode);
    listeners.add(notify);
    notify();
    return () => { listeners.delete(notify); };
  }, []);
  return value;
}
