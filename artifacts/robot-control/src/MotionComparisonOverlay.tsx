import { Html, Line } from "@react-three/drei";
import { MOTION_COLORS, motionFloorPath, motionFloorPoint, type MotionComparisonVisual } from "./motionComparison";

export function MotionComparisonOverlay({ visual }: { visual: MotionComparisonVisual }) {
  const sameXY = Math.hypot(visual.from.x - visual.to.x, visual.from.y - visual.to.y) < 0.1;
  const endpoints = sameXY
    ? [{ label: "A·B", point: visual.from }]
    : [{ label: "A", point: visual.from }, { label: "B", point: visual.to }];
  return <group>
    {(["MoveJ", "MoveL"] as const).map(mode => {
      // A small height separation keeps a dashed MoveL leg legible even when
      // its projection coincides with MoveJ. No raised TCP path is implied.
      const points = motionFloorPath(visual.paths[mode] ?? [], mode === "MoveJ" ? 4 : 4.5);
      return points.length > 1 ? <Line key={mode} points={points} color={MOTION_COLORS[mode]}
        lineWidth={3} dashed={mode === "MoveL"} dashSize={6} gapSize={4} depthWrite={false}/> : null;
    })}
    {endpoints.map(({ label, point }) => <group key={label} position={motionFloorPoint(point, 6)}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[3, 20]}/>
        <meshBasicMaterial color="#334155"/>
      </mesh>
      <Html center position={[0, 13, 0]} occlude zIndexRange={[100, 0]} style={{ pointerEvents: "none" }}>
        <span style={{ padding: "2px 5px", borderRadius: 4, background: "rgba(255,255,255,.94)",
          color: "#334155", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>{label}</span>
      </Html>
    </group>)}
  </group>;
}

export function MotionComparisonLegend({ runningMode }: { runningMode: MotionComparisonVisual["runningMode"] }) {
  return <div style={{ position: "absolute", left: 14, bottom: 16, padding: "8px 12px", borderRadius: 8,
    background: "rgba(255,255,255,.94)", fontSize: 12, pointerEvents: "none", color: "#475569" }}>
    <div style={{ display: "flex", gap: 14, fontWeight: 800 }}>
      <span style={{ color: MOTION_COLORS.MoveJ }}>━ MoveJ</span>
      <span style={{ color: MOTION_COLORS.MoveL }}>┄ MoveL</span>
      {runningMode && <span>{runningMode} 실행 중</span>}
    </div>
    <div style={{ marginTop: 4 }}>바닥: DT 경로의 XY 투영 · 높이(Z)는 로봇에서 관찰</div>
  </div>;
}
