---
name: MG400 link4 hole positions
description: Confirmed hole positions for link4_1 and link4_2 STL meshes, verified by user slider + console world-position measurement.
---

# MG400 link4 hole positions (user-confirmed)

## link4_1 "윗구멍" (upper hole)
- **j41Ref local**: [0.030, 0.017, 0.030]
- **World position at home**: [257.693, 301.878, 0.03]

## link4_2 "앞의 윗구멍" (front upper hole)
- **j42Ref local** (mesh at position=[0,0,0]): [0.175, 0.0235, 0.003]
- **World position at home**: [245.504, 255.343, 0]

## link4_2 "뒷구멍" (back hole)
- **j42Ref local**: [0, 0.0235, 0]
- **World position at home**: [118.163, 375.419, 0]
- This is where j32 connects; mesh stays at position=[0,0,0] to keep this correct.

## Alignment gap (front upper hole → l41 윗구멍)
- World gap: [+12.189, +46.534] mm (home position)
- A mesh offset of [-0.0238, 0, +0.0418] in j42Ref local closes the gap to <0.03mm BUT shifts the back hole by ~47mm — not acceptable.
- Decision: keep mesh at [0,0,0], back hole alignment takes priority.

**Why:** The back hole is a kinematic anchor (j32 connection); the front hole misalignment is a known STL vs URDF discrepancy to be resolved separately.
