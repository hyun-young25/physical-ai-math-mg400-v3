---
name: MG400 link2_1 upper hole
description: User-confirmed visual upper hole position on l21G mesh in j2Ref local space.
---

# l21G (link2_1) upper hole — user-confirmed

**j2Ref local: [-0.017, 0.029, 0.147]**

Confirmed 2025-06-27 via red sphere + interactive XYZ slider.

**Why:** URDF j3 kinematic origin [-0.00105, 0.03577, 0.175] does NOT match the visual hole center on the STL mesh. Must use empirically measured value.

**How to apply:** Pass as `l21UpperHole` prop to URDFRobot (currently used only as a reference; no live alignment logic attached to it yet — the value is recorded for future use).

**Debug pattern used:** red sphere (`meshBasicMaterial color="red" depthTest={false}`) placed as child of j2Ref group at the target position; slider panel in ThreeDScene overlay adjusts position. Remove both after confirmation.
