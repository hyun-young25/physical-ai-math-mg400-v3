import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Vector3, type Group, type Object3D } from "three";
import { createPaperRobotPreview } from "./paperRobotAppearance";
import { usePaperScene } from "./paperSceneStore";

export function PaperRobotAppearance({ active, children, tcpRef }: { active: boolean; children: ReactNode; tcpRef?: RefObject<Object3D | null> }) {
  const { data, owner } = usePaperScene();
  const group = useRef<Group>(null);
  const mount = useRef<Group>(null);
  const currentLabel = useRef<Group>(null), previewLabel = useRef<Group>(null);
  const currentTip = useRef(new Vector3());
  const preview = useRef<ReturnType<typeof createPaperRobotPreview> | null>(null);
  const seenRun = useRef<string | null>(null);
  const [labels, setLabels] = useState({ current: false, preview: false });
  // Live hardware/mock updates remain the single original-colour model.
  const measured = data?.displaySource === "hardware" || data?.displaySource === "mock";
  const sessionKey = active && data ? `${owner}:${data.level}:${data.frame?.id ?? "unknown"}` : null;
  useLayoutEffect(() => {
    seenRun.current = null;
    setLabels({ current: false, preview: false });
    return () => { preview.current?.dispose(); preview.current = null; };
  }, [sessionKey, measured]);
  useFrame(() => {
    if (!sessionKey || measured || !group.current || !mount.current) return;
    if (!preview.current) {
      preview.current = createPaperRobotPreview(group.current);
      mount.current.add(preview.current.current);
      preview.current.syncCurrent();
      tcpRef?.current?.getWorldPosition(currentTip.current);
    }
    const run = data?.run;
    if (data?.running && run?.source === "dt" && run.status === "running") seenRun.current = run.id;
    // Opening a saved result does not fabricate a preview or an old physical pose.
    const show = !!run && run.source === "dt" && run.id === seenRun.current;
    if (!preview.current.frozen && !show) {
      preview.current.syncCurrent();
      tcpRef?.current?.getWorldPosition(currentTip.current);
    }
    preview.current.showPreview(show);
    const current = preview.current.frozen;
    if (labels.current !== current || labels.preview !== show) setLabels({ current, preview: show });
    currentLabel.current?.position.copy(currentTip.current);
    if (previewLabel.current && tcpRef?.current) tcpRef.current.getWorldPosition(previewLabel.current.position);
  }); // URDF updates its existing joint transforms at priority -1, before this display pass.
  return <group name="paper-robot-display">
    <group ref={group} name="paper-robot-appearance">{children}</group>
    <group ref={mount} name="paper-current-mount" dispose={null}/>
    <group ref={currentLabel} visible={labels.current}>
      {labels.current && <Html zIndexRange={[19,0]} style={{pointerEvents:"none"}}><span className="paper-robot-label paper-robot-label--current" data-testid="paper-current-label">현재 위치 · 고정<small>DT 기준 · 실측 아님</small></span></Html>}
    </group>
    <group ref={previewLabel} visible={labels.preview}>
      {labels.preview && <Html zIndexRange={[20,0]} style={{pointerEvents:"none"}}><span className="paper-robot-label paper-robot-label--preview" data-testid="paper-preview-label">{data?.running ? "예측 이동 중" : "예측 이동 위치"}<small>회색 모델 · DT</small></span></Html>}
    </group>
  </group>;
}
