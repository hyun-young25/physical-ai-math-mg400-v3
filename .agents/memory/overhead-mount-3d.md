---
name: Overhead-mount 3D visual fix
description: How the 3D scene and SVG fallback are configured for MG400 overhead-mount orientation, correct URDF mimic chain formulas, and what makes the visual obviously overhead-mounted.
---

## Root rotation
Root group rotation `[Math.PI/2, 0, 0]` maps URDF Z→THREE -Y.
Z+ in robot coords = arm retracts toward ceiling. ✓

## URDF mimic chain (authoritative — from mg400_description.urdf)
```
j2_2  mimics j2       → j2_2 = j2
j3_2  mimics j2_2 ×−1 → j3_2 = -j2
j3_1  mimics j3_2 ×1  → j3_1 = -j2

j4_2  mimics j3       → j4_2 = j3
j4_1  mimics j4_2 ×−1 → j4_1 = -j3
```

## Mapping URDF angles → Three.js rotation.y
j2Ref.rotation.y = PI2 - a2*dd  → URDF_j2 = PI2-a2*dd
j3Ref.rotation.y = -a3*dd       → URDF_j3 = -a3*dd

Derived formulas (correct):
```
j31Ref.rotation.y = a2*dd - PI2    // -URDF_j2 = -(PI2-a2*dd)
j41Ref.rotation.y = a3*dd          // -URDF_j3 = -(-a3*dd)
j32Ref.rotation.y = a2*dd - PI2    // same as j31 (j3_2 = -j2)
j42Ref.rotation.y = -a3*dd         // URDF_j3 = -a3*dd (j4_2 = j3)
```

Key invariant: total Y rotation from root to j41 frame = 0 for all a2, a3.
→ j41 local Z always = World -Y (DOWN) → TCP always points straight down. ✓

## Parallelogram forearm behavior
Forearm (j3_1 to j4_1, link3_1) always points at j3_deg degrees below horizontal in World.
TCP always points straight down regardless of j2/j3. ✓
This is the correct MG400 parallelogram mechanism behavior.

## Initial pose (working)
App.tsx: `{ j1: 0.0, j2: 70.0, j3: 20.0, j4: 0.0 }` → X=59.9, Z=-339.4.
At j2=70°: upper arm hangs 70° below horizontal. Forearm goes at j3=20° below horizontal (mostly sideways).

## Camera (working)
`[900, -200, 300]` looking at `[80, -240, 0]` (OrbitControls target).
Upper arm appears nearly vertical, forearm horizontal — clear overhead-mount appearance.

## IsoFallback SVG
iso() uses `CY - (X+Z)*sin(30°)*SC + Y*SC` (Y=0 at ceiling, Y+ down).
Z+ → TCP screen_y decreases = arm goes UP. ✓

**Why:** Without correct URDF mimic formulas, the parallelogram linkage mesh would be in the wrong position, and TCP would not point straight down. Previous formula `(a2+a3)*dd-PI2` was wrong for j31/j42.

**How to apply:** Any future kinematics change must re-derive from URDF mimic chain above.
