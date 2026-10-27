---
name: MG400 home position
description: 홈(초기값) 정의 — TCP/관절 표시값과 3D 시각 포즈의 기준점
---

## 홈 포지션 (초기값)

| 항목 | 값 |
|---|---|
| TCP X | 350.0 mm |
| TCP Y | 0.0 mm |
| TCP Z | 0.0 mm |
| TCP R | 0.0 ° |
| J1 (display) | 0.0 ° |
| J2 (display) | 32.27 ° |
| J3 (display) | 32.59 ° |
| J4 (display) | 0.0 ° |
| 3D visual j2 | 60.0 ° |
| 3D visual j3 | -115.0 ° |

## 구조

- `coords` state — TCP 표시값 (350,0,0,0). FK sync 없음 (제거됨).
- `displayJoints` state — 관절각 표시값 (0,32.27,32.59,0). 조그 시 visual joints delta와 동일하게 업데이트.
- `joints` state — 3D 로봇 시각 위치 전용 (j2=60, j3=-115). 사용자가 건드리지 말도록 요청.

## Why

실제 장비의 홈 좌표계와 시뮬레이션의 FK/IK 좌표계가 다름.
사용자가 정의한 홈 기준점에서 조그 델타를 누적하는 방식으로 일관성 유지.

## 주의

- `joints`(3D visual)는 사용자 요청 없이 절대 변경 금지.
- displayJoints와 coords는 표시 전용 — 실제 FK 계산값과 불일치 허용.
