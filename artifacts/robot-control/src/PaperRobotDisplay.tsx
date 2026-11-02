import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Object3D } from "three";
import { createPaperRobotPreview } from "./paperRobotAppearance";
import { publishPaperRobotDisplay, usePaperScene } from "./paperSceneStore";

export function PaperRobotAppearance({ active, children, tcpRef }: { active: boolean; children: ReactNode; tcpRef?: RefObject<Object3D | null> }) {
  const { data, owner } = usePaperScene();
  const group = useRef<Group>(null);
  const mount = useRef<Group>(null);
  const preview = useRef<ReturnType<typeof createPaperRobotPreview> | null>(null);
  const seenRun = useRef<string | null>(null);
  const shown = useRef({ current: false, preview: false });
  // Live hardware/mock updates remain the single original-colour model.
  const measured = data?.displaySource === "hardware" || data?.displaySource === "mock";
  const sessionKey = active && data ? `${owner}:${data.level}:${data.frame?.id ?? "unknown"}` : null;
  useLayoutEffect(() => {
    seenRun.current = null;
    shown.current = { current: false, preview: false };
    publishPaperRobotDisplay(owner, shown.current);
    return () => {
      publishPaperRobotDisplay(owner, { current: false, preview: false });
      preview.current?.dispose();
      preview.current = null;
    };
  }, [sessionKey, measured, owner]);
  useFrame(() => {
    if (!sessionKey || measured || !group.current || !mount.current) return;
    if (!preview.current) {
      preview.current = createPaperRobotPreview(group.current);
      mount.current.add(preview.current.current);
      preview.current.syncCurrent();
    }
    const run = data?.run;
    if (data?.running && run?.source === "dt" && run.status === "running") seenRun.current = run.id;
    // Opening a saved result does not fabricate a preview or an old physical pose.
    const show = !!run && run.source === "dt" && run.id === seenRun.current;
    if (!preview.current.frozen && !show) {
      preview.current.syncCurrent();
    }
    preview.current.showPreview(show);
    preview.current.setCurrentOpacity(show && data?.running && run?.status === "running" ? 0.6 : null);
    const nextShown = { current: preview.current.frozen, preview: show };
    if (shown.current.current !== nextShown.current || shown.current.preview !== nextShown.preview) {
      shown.current = nextShown;
      publishPaperRobotDisplay(owner, nextShown);
    }
  }); // URDF updates its existing joint transforms at priority -1, before this display pass.
  return <group name="paper-robot-display">
    <group ref={group} name="paper-robot-appearance">{children}</group>
    <group ref={mount} name="paper-current-mount" dispose={null}/>
  </group>;
}
