import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Group } from "three";
import { softenPaperRobot } from "./paperRobotAppearance";

export function PaperRobotAppearance({ active, children }: { active: boolean; children: ReactNode }) {
  const group = useRef<Group>(null);
  useLayoutEffect(() => {
    if (active && group.current) return softenPaperRobot(group.current);
    return undefined;
  }, [active]);
  return <group ref={group} name="paper-robot-appearance">{children}</group>;
}
