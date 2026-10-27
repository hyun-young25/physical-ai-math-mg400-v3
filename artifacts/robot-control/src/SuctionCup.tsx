import { useEffect, useMemo } from "react";
import { createSuctionCup, disposeSuctionCup } from "./suctionCupGeometry";

export function SuctionCup({ sourceRef }:{ sourceRef?: React.MutableRefObject<import("three").Group|null> }) {
  const cup=useMemo(()=>createSuctionCup(),[]);
  useEffect(() => {
    if (sourceRef) sourceRef.current = cup;
    return () => { if (sourceRef?.current === cup) sourceRef.current = null; };
  }, [cup, sourceRef]);
  useEffect(()=>()=>disposeSuctionCup(cup),[cup]);
  return <primitive object={cup}/>;
}
