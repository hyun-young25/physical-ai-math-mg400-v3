---
name: MG400 parallel chain closed-loop tracking
description: How to correctly close the parallel chain loop; previous warning about dynamic tracking was based on wrong target (j3Ref vs j31Ref).
---

# MG400 Parallel Chain Closed-Loop Tracking

## The physical constraint
j32Ref (origin of link3_2 fan bracket) and j31Ref (origin of link3_1 arm) share the same physical bolt pin.
j42Ref (origin of link4_2 wrist bracket) and j41Ref (origin of link4_1 arm) share the same physical bolt pin.

## Correct solution (implemented)
In useFrame, AFTER setting all joint rotations, override each parallel bracket's LOCAL POSITION to track the main chain's corresponding joint world position:

```js
// j32Ref → j31Ref (NOT j3Ref — j31Ref is INSIDE j3Ref at [0.0679, 0.0005, 0.01197])
if (j32Ref.current && j31Ref.current && j22Ref.current) {
  j22Ref.current.updateWorldMatrix(true, false);
  j31Ref.current.getWorldPosition(_eb_p1.current);
  j22Ref.current.worldToLocal(_eb_p1.current);
  j32Ref.current.position.copy(_eb_p1.current);
}

// j42Ref → j41Ref
if (j42Ref.current && j41Ref.current && j32Ref.current) {
  j32Ref.current.updateWorldMatrix(true, false);
  j41Ref.current.getWorldPosition(_wb_p1.current);
  j32Ref.current.worldToLocal(_wb_p1.current);
  j42Ref.current.position.copy(_wb_p1.current);
}
```

**Why `updateWorldMatrix(true, false)` is REQUIRED:** Without it, the parent's world matrix may be stale after rotation updates earlier in the same frame, causing worldToLocal to return wrong results.

**Why NOT j3Ref:** The previous failed attempt tracked j32Ref → j3Ref. j3Ref is the GROUP that contains j31Ref as a child. j31Ref is the actual shared pin (at [0.0679, 0.0005, 0.01197] offset from j3Ref). Using j3Ref put j32Ref 116mm away from the correct pin.

**Rotation formula stays locked:** j32Ref.rotation.y = -a3·dd - PI2 (do NOT remove -PI2). Set position AFTER rotation each frame.

**Bridge cylinders: NOT needed.** Dynamic tracking makes j32Ref = j31Ref_world for all poses. No bridge cylinder is required.

## Effect on l22G
l22G (parallel upper arm bar) is a child of j22Ref — it stays at its original visual position. There is a structural gap between where l22G ends (URDF j32 position) and where l32G now appears (at j31Ref). This is an inherent URDF open-tree limitation of closed-loop mechanisms.
