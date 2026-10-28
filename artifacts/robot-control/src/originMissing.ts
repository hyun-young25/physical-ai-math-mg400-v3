export type PointXY = {x:number;y:number};
/** A constant observed offset alone never establishes an omitted origin.
 * Check the learner's submitted coordinates against target minus origin. */
export function omitsOrigin(planned:PointXY[],target:PointXY[],origin:PointXY,tolerance=0.1):boolean {
  return planned.length>=4 && planned.length===target.length && Math.hypot(origin.x,origin.y)>tolerance
    && planned.every((p,i)=>Number.isFinite(p.x)&&Number.isFinite(p.y)
      && Math.abs(p.x-(target[i].x-origin.x))<=tolerance
      && Math.abs(p.y-(target[i].y-origin.y))<=tolerance);
}
