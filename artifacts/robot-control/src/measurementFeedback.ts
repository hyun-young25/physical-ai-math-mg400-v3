type Measurement = {errorX:number;errorY:number;errorZ:number;distanceError:number};
export function measurementHint(items:Measurement[],source:"hardware"|"virtual") {
  if(!items.length)return "실행 결과를 확인한 뒤 목표와 비교하세요.";
  const mean=(key:"errorX"|"errorY"|"errorZ")=>items.reduce((s,v)=>s+v[key],0)/items.length;
  const x=mean("errorX"),y=mean("errorY"),z=mean("errorZ");
  const rmse=Math.sqrt(items.reduce((s,v)=>s+v.distanceError**2,0)/items.length);
  if(rmse<=2)return source==="hardware"
    ?"이번 실행에서 목표와 장비가 보고한 좌표의 차이가 작습니다. 반복 실행과 측정 기준을 함께 확인하세요."
    :"가상 센서 연습값과 목표의 차이가 작습니다. 이 결과로 실제 장비의 정확도를 판단하지 않습니다.";
  if(Math.abs(z)>Math.max(Math.abs(x),Math.abs(y),2))return "Z 방향 차이가 반복됩니다. TCP 또는 물체 윗면 높이의 기준을 확인해 보세요.";
  if(Math.hypot(x,y,z)>=rmse*0.65)return "여러 점이 비슷한 방향으로 이동했습니다. 작업 원점이나 좌표계 오프셋을 확인해 보세요.";
  if((items[Math.max(0,items.length-2)]?.distanceError??0)>Math.max(3,(items[0]?.distanceError??0)*1.5))
    return "후반 지점의 차이가 커졌습니다. 자세·위치에 따라 어떤 성분이 달라지는지 비교하세요.";
  return "점마다 차이의 방향이 다릅니다. ΔX·ΔY·ΔZ를 비교하고, 한 조건씩 수정해 다시 확인하세요.";
}
