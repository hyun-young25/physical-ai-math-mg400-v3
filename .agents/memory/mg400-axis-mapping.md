---
name: MG400 axis mapping Three.js
description: Correct Robot↔Three.js coordinate mapping for MG400 floor overlay and coord guide arrows
---

## Rule

Robot X → Three.js **+X** (arm forward at J1=0)  
Robot Y → Three.js **−Z** (arm left at J1=90°)  
Robot Z → Three.js **+Y** (vertical, up)

## In code

`XYFloorOverlay`:
```
tx = rx   // Robot X → Three.js +X
tz = -ry  // Robot Y → Three.js −Z
corner = [tx, 0, 0]   // X-component line goes along +X
endPt  = [tx, 0, tz]  // Y-component line goes along −Z
arc: pts.push(new THREE.Vector3(r*Math.cos(a), 0, -r*Math.sin(a)))
```

`CoordGuideArrows` DIRS:
```
x: new THREE.Vector3(1, 0, 0)   // +X
y: new THREE.Vector3(0, 0, -1)  // −Z
z: new THREE.Vector3(0, 1, 0)   // +Y
```

Static floor arrows:
```
X방향 → toX    (Three.js +X)
Y방향 → toNegZ (Three.js −Z)
```

**Why:** The URDF robot rotation `[-π/2, 0, 0]` keeps URDF X = Three.js X. At J1=0 the arm extends in the URDF/Three.js +X direction. The "front" view preset (camera at [1150,280,40], looking along −X) shows the arm head-on, confirming robot X = Three.js +X. Previous code had X and Y swapped (tx=ry, tz=-rx), causing floor projection lines and coord guide arrows to point in wrong directions.

**How to apply:** Any time you add new floor projections, 2D overlays, or direction vectors for robot coordinates, use this mapping. Do NOT use the old tx=ry/tz=-rx pattern.
