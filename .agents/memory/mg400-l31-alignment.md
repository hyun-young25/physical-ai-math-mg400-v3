---
name: MG400 l31G alignment — hR anchor rule (FINAL)
description: Correct way to keep hR fixed. Uses hardcoded j31Ref local constant — no dynamic computation.
---

## 최종 확정 방식 (CONFIRMED WORKING)

`_l31_tgtR.current.set(0.177, 0, 0.008)` — j31Ref 로컬 상수, 동적 계산 없음.

```js
// Step 1 — base orientation only
_l31_extraE.current.set(0, -0.271, 0);
_l31_baseQ.current.setFromEuler(_l31_extraE.current);
l3R.current.quaternion.copy(_l31_baseQ.current);

// Step 2 — hR anchor: j31Ref 로컬 상수 (절대 dynamic 계산 금지)
_l31_tgtR.current.set(0.177, 0, 0.008);

// Step 3 — hL target: j32Ref local → world → j31Ref local
// Step 4 — delta rotation (setFromUnitVectors)
// Step 5 — reposition so hR stays at anchor
```

## 절대 하면 안 되는 패턴 (모두 hR을 움직임)

```js
// ❌ WRONG 1 — worldToLocal이 arm rotation에 따라 변함
l3R.current.parent.getWorldPosition(_l31_pwp.current);
_l31_posOffV.current.set(l31PosOffset[0] + pwp.x, ...);
l3R.current.parent.worldToLocal(_l31_posOffV.current);
_l31_tgtR.current = baseQ * hR_mesh + l3R.position;  // 동적 → 흔들림

// ❌ WRONG 2 — j31Ref local에 l31PosOffset 직접 set → mesh 사라짐
l3R.current.position.set(l31PosOffset[0], l31PosOffset[1], l31PosOffset[2]);

// ❌ WRONG 3 — j41Ref 추적 → hR이 j41Ref 위치([175,-17,3.25])로 이동
j41Ref.current.getWorldPosition(_l31_tgtR.current);
j31Ref.current.worldToLocal(_l31_tgtR.current);
```

## 핵심 값 (LOCKED)

| 항목 | 값 | 좌표계 |
|------|-----|--------|
| hR anchor | `[0.177, 0, 0.008]` | j31Ref 로컬 (2025-06-27 확정) |
| hL target | `[0.052, 0.019, -0.021]` | j32Ref 로컬 (2025-06-28 확정) |
| baseQ | `Euler(0, -0.271, 0)` | — |
| hR mesh-local | `[0.168, -0.017, -0.056]` | mesh 로컬 |
| hL mesh-local | `[-0.045, -0.003, -0.002]` | mesh 로컬 |

**Why:** `_l31_tgtR`이 dynamic이면 hL slider/drag/arm movement 시 매 프레임 오차가 생겨 hR이 흔들림. 상수로 하드코딩해야 완전히 고정됨.
