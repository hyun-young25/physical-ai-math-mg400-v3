---
name: MG400 parallel chain co-pivot fix
description: How to fix parallel linkage (l22G/l32G/l42G) separating from main chain links during movement.
---

## The Problem
l22G, l32G, l42G (dark carbon parallel bars) were in separate groups (j22Ref/j32Ref/j42Ref) at ROOT level — outside j1Ref. This caused two bugs:
1. j1 rotation did not affect the parallel chain (black bars don't orbit with j1)
2. Separate pivot groups with different joint origins caused visual separation when joints moved

## The Fix (minimal, correct)
Move parallel meshes into the corresponding main-chain group with a static URDF position offset:

- **l22G → j2Ref** at `[0.0865, -0.0053, -0.03897]`
- **l32G → j31Ref** at `[-0.03897, -0.03457, -0.0865]`
- **l42G → j41Ref** at `[-0.04769, -0.01707, -0.1936]`

Also removed: j22Ref, j32Ref, j42Ref refs, bridge scratch objects, updateBridge function, bridge calls in useFrame.

## Offset Derivation Formula
`offset_in_parent_local = R_cumulative(rest)^T × (parallel_joint_abs − main_joint_abs)`

Where cumulative rotation at each level (at home/rest):
- j2Ref: R_Y(PI2) → R_Y(-PI2)·Δ = [-Δz, Δy, Δx]
- j31Ref: R_Y(PI2)·R_Y(-PI2) = I → offset = Δ directly
- j41Ref: same as j31Ref = I → offset = Δ directly

**Why:** STL mesh vertices are in link-local frame. The position offset shifts the mesh origin from the wrong pivot (j22/j32/j42) to the correct one (j2/j31/j41), while keeping the same world position at rest and correctly orbiting with the parent joint.

**How to apply:** If re-adding parallel links or adding new STL links, always verify whether the link's joint origin matches the parent group's origin. If not, compute `R_cumulative^T × (link_joint_abs − parent_group_abs)` as the mesh position.
