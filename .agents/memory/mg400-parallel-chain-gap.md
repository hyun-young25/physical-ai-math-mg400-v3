---
name: MG400 parallel chain gap fix
description: How the parallel chain visual gap (elbow + wrist) is resolved and what must NOT be changed.
---

## The 51mm gap problem
The URDF places j22Ref at a different position than j2Ref (offset ~39mm in j1Ref frame). After arm rotation, this causes:
- ~51mm gap at elbow: j3Ref (main chain) ↔ j32Ref (parallel chain)
- Originally ~120mm gap at wrist: j41Ref ↔ j42Ref

## What was tried and FAILED
Moving j22Ref from [0.004529, -0.0305, 0.1415] to [0.043503, -0.00653, 0.119] to make j32Ref_world ≈ j3Ref_world:
- Mathematically correct for kinematics
- VISUALLY DISASTROUS — l22G mesh (parallel upper arm STL) is a direct child of j22Ref; moving j22Ref moves l22G completely out of place (user reaction: ㅠㅠ)
- NEVER move j22Ref; the l22G STL is designed for its original position

## What WORKS
1. **j42Ref repositioned**: changed from URDF [0.0679, 0.0005, 0.0120] to [0.174969784, -0.017, 0.003252] (same local offset as j41Ref from j31Ref, i.e., 175mm instead of 68mm). This reduces wrist gap from 120mm → 51mm without moving l22G or l32G.
2. **Bridge cylinders**: `elbowBridgeRef` and `wristBridgeRef` are `<mesh>` elements at the Canvas scene level (NOT inside the scaled root group). `updateBridge()` in useFrame spans each cylinder between the two anchor refs each frame. CylinderGeometry args=[6,6,1,12]; scale.y=distance. Color #1a1a1a (dark metallic) matches robot parallel chain.

## JSX structure (must NOT change)
```
j22Ref group [0.004528856, -0.0305, 0.1415]  ← FIXED
  l22G mesh  ← sibling of j32Ref, NEVER offset
  j32Ref group [-0.001050497, 0.0065, 0.174996846]
    l32G mesh
    j42Ref group [0.174969784, -0.017, 0.003252]  ← changed from URDF 68mm to 175mm
      l42G mesh
```

## Key rules

**j22Ref position CANNOT change** — l22G mesh is a direct child; moving j22Ref moves l22G to wrong place.
**j42Ref position MUST stay at URDF original [0.067896585, 0.0005, 0.011972]** — changing this to [0.175, -0.017, 0.003] (j41's offset) only minimizes gap at home pose; at other poses j32Ref rotation path diverges from j31Ref, causing LARGE pose-dependent separation (arm appears completely disconnected at non-home poses). NEVER change j42Ref's local position again.

## Forearm visibility issue

l31G (link3_1 STL) spans j31Ref→j41Ref (~175mm forearm rod) but is a THIN ROD.
When the arm points toward the camera (j1 ≈ 90° from default), l31G is viewed end-on and becomes invisible as a tiny dot, making the end-effector appear completely detached.

**Fix:** Added `forearmBridgeRef` cylinder (radius 9mm, color #d8d8d8) spanning j3Ref↔j41Ref in the scene-level bridge system. This makes the forearm always visible regardless of camera angle.

**Why:** The 3 bridge cylinders now cover all visual gaps:
1. `elbowBridgeRef`: j3Ref ↔ j32Ref (main↔parallel chain at elbow, ~51mm)
2. `wristBridgeRef`: j41Ref ↔ j42Ref (main↔parallel chain at wrist, URDF-defined gap)
3. `forearmBridgeRef`: j3Ref ↔ j41Ref (full forearm span, ~175mm, prevents end-on invisibility)
