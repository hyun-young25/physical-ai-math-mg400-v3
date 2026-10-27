---
name: MG400 link4_2 locked transform
description: Confirmed final transform for l42G mesh aligning both boss holes; sign error lesson.
---

# l42G (link4_2) mesh transform — CONFIRMED + LOCKED

```jsx
<mesh geometry={l42G} material={wM} castShadow receiveShadow
      rotation={[0, -0.271, 0]}
      scale={[0.9013, 1, 0.9013]}/>
```

## What this achieves

- **뒷구멍** (back boss) at mesh-local [0, 0.0235, 0]: lies on local Y axis → **not affected** by R_Y rotation or XZ scale → stays at world [118.163, 375.419] ✓
- **앞의 윗구멍** (front upper boss) at mesh-local [0.175, 0.0235, 0.003]: after scale → [0.15773, 0.0235, 0.002704] → after R_Y(-0.271) → j42Ref local [0.15122, 0.0235, **+0.04493**] → world [257.7, 301.9] = j41 윗구멍 target ✓
- STL is physically 175mm; kinematic distance is 158mm → scale 0.9013 = 158/175.4

## Critical sign rule (burned in)

**rotation.y = +0.271 is WRONG.** It moves the front boss to j42Ref Z = **-0.03971** (wrong direction).  
**rotation.y = -0.271 is CORRECT.** It moves the front boss to j42Ref Z = **+0.04493** = target.

**Why:** Three.js R_Y(θ) formula: `z' = -x·sin(θ) + z·cos(θ)`. With x=0.15773 dominant, sin(+0.271)>0 makes z' negative. sin(-0.271)<0 flips z' to positive = toward target.

## DO NOT CHANGE

User explicitly locked this transform. Do not modify rotation, scale, or position of l42G without user instruction.
