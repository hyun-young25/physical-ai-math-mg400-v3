---
name: MG400 j42Ref position hard lock
description: j42Ref.position MUST NOT be modified — 4 attempts all catastrophically broke the arm; root cause unknown.
---

## Rule

**Never modify `j42Ref.current.position` in useFrame or anywhere else.**

The JSX-declared position `[0.0679, 0.0005, 0.01197]` (in j32Ref local) must remain as-is.

## Failed attempts (all broke the arm completely)

1. **worldToLocal freeze** — computed j41 world pos at first frame, converted to j32Ref local via worldToLocal, froze. Failed: stale matrix at first frame.
2. **getWorldPosition + getWorldQuaternion (no scale)** — subtracted j32 world from j41 world, applied inverse quaternion. Failed: quaternion only undoes rotation, not the scale=1000 root group → 1000× error → arm flew away.
3. **getWorldPosition + getWorldQuaternion (with scale correction theory)** — same as above but with hypothesis about scale. Failed: arm flew away.
4. **worldToLocal per-frame** — `j41Ref.getWorldPosition(v)` then `j32Ref.updateWorldMatrix(true,false)` then `j32Ref.worldToLocal(v)` then `j42Ref.position.copy(v)`. Failed: arm completely rotated/broke catastrophically.

## Root cause (unknown)

Despite worldToLocal being mathematically correct (uses full inverse matrix including scale=1000), the arm breaks. The exact reason is unknown without browser console debugging. Possibly a feedback loop or R3F reconciler conflict.

**Why:** Every single approach to modify j42Ref.position caused catastrophic visual failure. The constraint is empirically absolute.

**How to apply:** The blue-circle wrist joint visual gap (l42G ↔ l41G) cannot be fixed via j42Ref.position tracking. If a future fix is attempted, it must use a different approach (e.g., offsetting only the l42G mesh inside j42Ref, or a bridge mesh between j41 and j42 world positions).
