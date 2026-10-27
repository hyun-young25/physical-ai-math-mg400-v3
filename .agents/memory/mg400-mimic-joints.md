---
name: MG400 mimic joint formulas
description: Correct rotation formulas for MG400 passive/mimic joints. Wrong formula makes TCP immobile when j3 changes, or puts TCP in wrong position, or arm visually breaks as j3 moves.
---

## Correct formulas (derived from URDF geometry + FK match)

```
j2Ref.rotation.y  =  PI2 - a2*dd          // driven
j3Ref.rotation.y  = -a3*dd                // driven
j31Ref.rotation.y = -PI2                  // CONSTANT -π/2
j41Ref.rotation.y =  (a2 + a3)*dd
j4Ref.rotation.z  =  a4*dd                // driven

j22Ref.rotation.y =  PI2 - a2*dd
j32Ref.rotation.y = -a3*dd - PI2          // NOT (a2-a3)*dd-PI2 — see Why below
j42Ref.rotation.y =  (a2 + a3)*dd
```

**NO visual counter-rotation groups (j31VisRef, j41VisRef must NOT exist).**
Adding a vis wrapper (+a2*dd on j31) makes the mesh point in the a3-only direction,
which diverges from FK as j3 changes → arm visually breaks.

**Why j31 = -π/2 (derivation):**
Forearm mesh P_j41 = [0.175, 0, 0] is along URDF X axis.
FK requires forearm direction = World [cos(j2+j3), sin(j2+j3), 0].
After root R_X(-π/2): root_local [cos(j2+j3), 0, sin(j2+j3)] is needed.
R_Y(net) * [1,0,0] = [cos(net), 0, -sin(net)].
Setting this = [cos(j2+j3), 0, sin(j2+j3)] → net = -(j2+j3)*dd.
j2 + j3 + j31 = -(j2+j3) → j31 = -PI2. QED.

**Why j41 = (a2+a3)*dd:**
Net total j2+j3+j31+j41 must = 0 for TCP orientation fixed.
(PI2-a2) + (-a3) + (-PI2) + j41 = 0 → j41 = a2+a3. QED.

**l31G mesh root-local direction** (NO vis group):
j2+j3+j31 = -(a2+a3)*dd → R_Y(-(a2+a3)*dd)*[1,0,0] = [cos(a2+a3), 0, sin(a2+a3)]
→ World [cos(a2+a3), sin(a2+a3)] = FK forearm direction. Always correct for all j3. ✓

**l41G mesh root-local** = j2+j3+j31+j41 = 0 → URDF designed orientation. ✓

**Parallel chain:**
j22+j32 = (PI2-a2) + (-a3-PI2) = -(a2+a3)*dd → parallel to l31G ✓
j22+j32+j42 = -(a2+a3) + (a2+a3) = 0 → l42G same orientation as l41G ✓

**Verification at j2=70°, j3=20°:**
TCP 3D position relative to shoulder: reach≈55.6mm, height≈339.9mm.
FK gives reach=59.9mm, height=339.4mm. Matches within 4mm (URDF offset). ✓

**Wrong formulas history:**
1. j31=(a2+a3)*dd-PI2, j41=0: net=0 but forearm always along World X → TCP immobile
2. j31=a2*dd-PI2, j41=a3*dd: URDF formulas for ceiling mount, wrong for tabletop
3. j31=-PI2 + j31VisRef=+a2*dd: mesh direction follows j3 only → breaks as j3 changes
4. j32=(a2-a3)*dd-PI2: wrong, makes parallel bar diverge from l31G direction

**How to apply:**
Any time useFrame rotation block is touched, these exact formulas must be used.
NEVER add j31VisRef or j41VisRef groups. NEVER use a2*dd-PI2 for j31.
Root rotation on root group: [-PI/2, 0, 0] (URDF Z → World +Y).
