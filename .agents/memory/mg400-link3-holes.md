---
name: MG400 link3_2 hole positions
description: User-confirmed visual hole positions on l31G/l32G meshes; rigid body alignment targets.
---

# l31G (link3_1) 확인된 위치 (2025-06-28 현재)

## hR — 오른쪽 구멍 (LOCKED)

**`l31PosOffset = [-34.6518, -31.5474, 0.8969]`** (월드 mm 오프셋, j31Ref 월드 위치 기준)

- 코드에서 `const l31PosOffset: [number,number,number] = [-34.6518, -31.5474, 0.8969]` 로 하드코딩
- 2025-06-28 사용자 확인 완료; **절대 변경 금지**
- 사용 방법: `worldToLocal(j31Ref_worldPos + l31PosOffset)` → j31Ref 로컬 위치 (rotation 포함)

## hL — 왼쪽 구멍 (j32Ref 로컬, LOCKED)

**`l31LeftTarget = [0.052, 0.019, -0.021]`** (j32Ref local 좌표)

- `debugLeftHole` state 초기값 = `[0.052, 0.019, -0.021]`
- 2025-06-27 슬라이더로 확인; 2025-06-28 현재도 유지
- 초록 구(🟢) 드래그 시 이 값이 실시간 업데이트되고 오버레이에 표시됨
- 화면 하단 `🟢 hL j32: [x, y, z]` = 현재 실시간 값

## mesh-local 구멍 위치 (기준값)

- hL mesh-local: `[-0.045, -0.003, -0.002]` → `_l31_hL` ref
- hR mesh-local: `[0.168, -0.017, -0.056]` → `_l31_hR` ref
- baseQ: `Euler(0, -0.271, 0)`

---

# l32G (link3_2) hole positions

## 아래구멍 (lower hole)

**j32Ref local: [0.037, 0.047, -0.021]**

- Confirmed by user via interactive XYZ slider at home position
- Note: URDF j4_2 kinematic origin is [0.0679, 0.0005, 0.01197] — this is NOT the visual hole center

## 중간구멍 (middle hole)

**mesh-local: [0.038, 0.011, -0.020]** (confirmed by user 2025-06-27)

- l31G 중간구멍 mesh-local: [0, -0.010, 0.001] (confirmed by user 2025-06-27)
- 두 중간구멍은 world space에서 일치해야 함 (맞물림 조건)

## 위구멍 (upper hole / pivot)

- j32Ref origin [0,0,0] = j3_2 joint pivot = where link3_2 mounts to link2_2
- This is the rotation axis, not necessarily a visible hole center

## Why the URDF origin differs from visual hole

j32Ref.rotation.y = -a3*dd - PI2 (includes -PI/2 baked offset). The STL geometry
has its own local orientation, so visual boss positions do not match URDF xyz origins directly.
Must measure empirically (slider method) for accurate visual alignment.
