import { useEffect, useRef, useMemo, type ComponentRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { OrbitControls } from "@react-three/drei";
import { COORDINATE_STUDY_VIEW, CoordinateViewSession, fitStudyView, type StudyView } from "./coordinateStudyView";

/** Request on lesson entry or explicit button press; ordinary renders and Home do not recenter. */
export function CoordinateStudyCamera({ requestKey, preset, view = COORDINATE_STUDY_VIEW, minimumAspect }: {
  requestKey?: number; preset: "free" | "top" | "side" | "front"; view?: StudyView; minimumAspect?: number;
}) {
  const camera = useThree(s => s.camera);
  const size = useThree(s => s.size);
  const framedView = useMemo(() => fitStudyView(view, size.width / Math.max(1, size.height), minimumAspect),
    [view, size.width, size.height, minimumAspect]);
  const controls = useThree(s => s.controls) as ComponentRef<typeof OrbitControls> | null;
  const session = useRef<CoordinateViewSession | null>(null);
  const enabled = requestKey !== undefined;
  useEffect(() => {
    if (!enabled || !controls) return;
    const activeView = new CoordinateViewSession(camera, controls.target, () => controls.update(), framedView);
    session.current = activeView;
    const cancel = () => activeView.cancel();
    controls.addEventListener("start", cancel);
    return () => {
      controls.removeEventListener("start", cancel);
      activeView.restore(); session.current = null;
    };
  }, [enabled, camera, controls, framedView]);
  useEffect(() => {
    if (enabled) session.current?.request();
  }, [enabled, requestKey, controls, framedView]);
  useEffect(() => {
    if (preset !== "free") session.current?.cancel();
  }, [preset, requestKey, controls, framedView]);
  useFrame((_, delta) => session.current?.step(delta), -0.5);
  return null;
}
