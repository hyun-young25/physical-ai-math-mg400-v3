---
name: MG400 pick tray Three.js Y
description: Correct vertical position (TY) for the pick-and-place tray group, derived from FK + URDF chain.
---

## Rule
`TY = 136mm` — the tray group's world Three.js Y position.

## Derivation (robot Z = −10 = pick height)

| Step | Value |
|------|-------|
| COORD_OZ (App.tsx) | −41.202 mm |
| IK input z′ = −10 − COORD_OZ | 31.202 mm |
| FK height h = z′ | 31.202 mm |
| j1Ref URDF z=0.109m → Three.js y | 109 mm |
| j2Ref URDF local z=0.119m → Three.js y | +119 mm |
| **Shoulder (j2Ref) world Three.js y** | **228 mm** |
| Arm endpoint world y = shoulder + h | 259 mm |
| j4Ref URDF local z=0.031m → Three.js +y | +31 mm → j4Ref at 290 mm |
| Tracker mesh URDF local z=−0.120m → Three.js −y | −120 mm → tip at **170 mm** |
| Block top must = tip y → tray group Y = 170 − 34 | **136 mm** |

Block top within group = BASE_H(7) + BLOCK(27) = 34 mm above group origin.

## Why
The suction cup tip (endEffTrackerRef) at robot Z=−10 is at Three.js y≈170 mm.
If TY≠136, the arm visually misses the blocks during the pick animation.

## How to apply
- `const TY = 136` in `PickBlocks` component (Robot3D.tsx)
- Desk legs = TY − DT ≈ 118 mm (looks proportional next to MG400)
- Approach (robot Z=+40): tip y≈220 mm (50 mm above pick height) — correct travel range
