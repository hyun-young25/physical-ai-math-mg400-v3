import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type Group } from "three";
import { placeCoordinateLabels, tcpSharesEndpoint, type CoordinateLabel, type PlacedLabel, type ProjectedLabel } from "./coordinateLabelLayout";

const SVG_NS = "http://www.w3.org/2000/svg";
/** A single pointer-transparent screen layer. No React render or DOM measurement per frame. */
export function CoordinateScreenLabels({ labels, anchor, tcp, description = "2-2 좌표 위치 라벨" }: {
  labels: CoordinateLabel[]; anchor: RefObject<Group|null>; tcp: RefObject<Group|null>; description?: string;
}) {
  const { gl, camera, size } = useThree();
  const layer = useRef<SVGSVGElement|null>(null);
  const nodes = useRef(new Map<string,{group:SVGGElement;line:SVGLineElement;width:number}>());
  const previous = useRef(new Map<string,PlacedLabel>());
  const world = useMemo(()=>new Vector3(),[]), projected = useMemo(()=>new Vector3(),[]);
  const localTcp = useMemo(()=>new Vector3(),[]), origin = useMemo(()=>new Vector3(),[]);
  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const svg = document.createElementNS(SVG_NS,"svg");
    svg.setAttribute("aria-label",description);
    Object.assign(svg.style,{position:"absolute",inset:"0",width:"100%",height:"100%",pointerEvents:"none",overflow:"hidden"});
    const lines = document.createElementNS(SVG_NS,"g"), boxes = document.createElementNS(SVG_NS,"g");
    svg.append(lines,boxes); parent.appendChild(svg); layer.current=svg;
    for (const label of labels) {
      const line=document.createElementNS(SVG_NS,"line"),group=document.createElementNS(SVG_NS,"g");
      const rect=document.createElementNS(SVG_NS,"rect"),text=document.createElementNS(SVG_NS,"text"),title=document.createElementNS(SVG_NS,"title");
      title.textContent=label.fullText; text.textContent=label.text;
      text.setAttribute("x","8");text.setAttribute("y","17");text.setAttribute("fill",label.color);
      text.setAttribute("font-size","12");text.setAttribute("font-weight","800");
      text.setAttribute("font-family","'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif");
      group.append(rect,text,title);boxes.appendChild(group);
      // Conservative fallback also covers fonts loading after mount.
      const fallback=Array.from(label.text).reduce((n,c)=>n+(/[^\x00-\x7F]/.test(c)?12:8),0);
      const width=Math.ceil(Math.max(text.getComputedTextLength(),fallback))+16;
      rect.setAttribute("width",String(width));rect.setAttribute("height","26");rect.setAttribute("rx","6");
      rect.setAttribute("fill","rgba(255,255,255,.96)");rect.setAttribute("stroke",label.color);rect.setAttribute("stroke-opacity",".25");
      line.setAttribute("stroke",label.color);line.setAttribute("stroke-width","1.2");line.setAttribute("opacity",".7");
      lines.appendChild(line);group.style.display="none";line.style.display="none";
      nodes.current.set(label.id,{group,line,width});
    }
    return () => { svg.remove();layer.current=null;nodes.current.clear();previous.current.clear(); };
  }, [gl,labels,description]);
  useFrame(() => {
    if (!layer.current || !anchor.current || !tcp.current) return;
    const input:ProjectedLabel[]=[];
    camera.updateMatrixWorld();
    tcp.current.getWorldPosition(localTcp);anchor.current.getWorldPosition(origin);localTcp.sub(origin);
    const redundantTcp=anchor.current.visible&&tcpSharesEndpoint(labels,localTcp.toArray());
    for (const label of labels) {
      const node=nodes.current.get(label.id); if (!node) continue;
      node.group.style.display="none";node.line.style.display="none";
      if(label.live&&redundantTcp)continue;
      const reference=label.live?tcp.current:anchor.current;
      if (!reference.visible) continue;
      reference.getWorldPosition(world);world.add(projected.set(...label.position));
      projected.copy(world).applyMatrix4(camera.matrixWorldInverse);
      if (projected.z>=0) continue;
      projected.copy(world).project(camera);
      if (Math.abs(projected.x)>1 || Math.abs(projected.y)>1 || Math.abs(projected.z)>1) continue;
      input.push({id:label.id,x:(projected.x+1)*size.width/2,y:(1-projected.y)*size.height/2,width:node.width,height:26});
    }
    const placed=placeCoordinateLabels(input,size.width,size.height,[
      {x:size.width-180,y:size.height-194,width:180,height:194},
    ],previous.current);
    previous.current=new Map(placed.map(p=>[p.id,p]));
    for (const p of placed) {
      const node=nodes.current.get(p.id)!;
      node.group.style.display="";node.line.style.display="";
      node.group.setAttribute("transform",`translate(${p.box.x.toFixed(1)} ${p.box.y.toFixed(1)})`);
      node.line.setAttribute("x1",String(p.x));node.line.setAttribute("y1",String(p.y));
      node.line.setAttribute("x2",String(p.leader.x));node.line.setAttribute("y2",String(p.leader.y));
    }
  });
  return null;
}
