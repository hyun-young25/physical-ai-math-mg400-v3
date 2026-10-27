import { useEffect, useMemo } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SuctionZoomView, drawSuctionZoom, suctionZoomViewport } from "./suctionZoom";

type ViewRefs = {
  slotRef:RefObject<HTMLDivElement|null>;
  angleRef:RefObject<HTMLOutputElement|null>;
};

export function SuctionZoomPass({ sourceRef, slotRef, angleRef }:ViewRefs & { sourceRef:RefObject<THREE.Group|null> }) {
  const view = useMemo(() => new SuctionZoomView(), []);
  const size = useMemo(() => new THREE.Vector2(), []);
  useEffect(() => () => view.release(), [view]);
  // Priority 1 runs after the robot's live-joint update. Unmount restores Fiber's normal rendering.
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera);
    const source = sourceRef.current, slot = slotRef.current;
    if (!source || !slot) return;
    const angle = view.sync(source);
    if (angle === null) return;
    const rect = suctionZoomViewport(gl.domElement.getBoundingClientRect(), slot.getBoundingClientRect(), gl.getSize(size));
    if (rect) drawSuctionZoom(gl, view, rect);
    const text = `${Math.abs(angle) < 0.005 ? "0.00" : angle.toFixed(2)}°`;
    if (angleRef.current && angleRef.current.textContent !== text) angleRef.current.textContent = text;
  }, 1);
  return null;
}

export function SuctionZoomPanel({ slotRef, angleRef, onClose }:ViewRefs & { onClose?:()=>void }) {
  useEffect(() => {
    const close = (event:KeyboardEvent) => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <section id="suction-zoom-panel" aria-label="흡착기 확대보기" style={{
    position:"absolute", left:14, bottom:14, zIndex:15,
    width:"min(280px, calc(100% - 28px))", height:"min(260px, calc(100% - 28px))",
    display:"flex", flexDirection:"column", border:"1px solid #b9c8d4", borderRadius:10,
    overflow:"hidden", boxShadow:"0 3px 14px #0f172a26", color:"#263747", fontSize:13,
  }} onPointerDown={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()}>
    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"8px 12px",background:"#fff"}}>
      <strong>흡착기 확대</strong>
      <button type="button" aria-label="흡착기 확대보기 닫기" onClick={onClose}
        style={{border:"1px solid #cbd5e1",borderRadius:5,background:"#fff",padding:"3px 8px",cursor:"pointer",color:"#334155"}}>닫기</button>
    </header>
    <div ref={slotRef} role="img" aria-label="현재 J4 각도를 따르는 흡착기 3D 확대 화면" style={{flex:"1 1 0",minHeight:0,pointerEvents:"none"}}/>
    <footer style={{padding:"7px 12px",background:"#fff",display:"flex",justifyContent:"space-between",gap:8}}>
      <span>현재 R·J4 <output ref={angleRef}>—</output></span>
      <span style={{color:"#64748b",fontSize:11}}>표면 무늬로 회전 관찰</span>
    </footer>
  </section>;
}
