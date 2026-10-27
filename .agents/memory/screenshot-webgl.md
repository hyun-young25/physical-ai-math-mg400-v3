---
name: Screenshot tool has no WebGL
description: The Replit screenshot tool uses a headless browser that fails WebGL, so canUseWebGL() returns false and IsoFallback SVG is always shown.
---

## Rule
`canUseWebGL()` (Robot3D.tsx line 10) creates a canvas and tests webgl/experimental-webgl context.
The screenshot tool's headless browser fails this test → always returns false → IsoFallback SVG is rendered.

Changes to ThreeDScene (camera position, lighting, 3D geometry) are INVISIBLE in screenshots.
Only IsoFallback SVG changes are visible in screenshots.

**Why:** Caused confusion when camera position changes (e.g., [300,-80,1050]→[400,400,600]) produced identical screenshots every time — because we were looking at the SVG fallback, not the 3D canvas.

**How to apply:** When debugging 3D visual issues, verify mathematically rather than relying on screenshots. IsoFallback changes CAN be verified via screenshot.

## Full browser verification
The screenshot fallback and a separate browser's real WebGL rendering are different verification paths. Local headless Chromium can render the actual MG400 CAD scene using software WebGL, even though the screenshot tool falls back to SVG.

**Why:** These browsers have different graphics capabilities. Earlier workspace restarts during lesson inspection were not proof that software WebGL could not run the lesson; an upward visual-state publication loop was involved.

**How to apply:** Test the real scene in a WebGL-capable browser rather than infer its availability from the screenshot tool. Check render/effect loops before attributing repeated restarts to graphics resources. Never replace the real model, force scene readiness, or weaken success/safety checks to claim a pass. Successful engine or protocol checks alone are not full scene verification.

## Offline authentication/log UI tests

Disconnecting the browser while the scene's external environment HDR is still loading can throw a resource-fetch error and block the development page with an error overlay. This is distinct from an outbox/recording failure.

**Why:** Browser offline/retry testing encountered `studio_small_03_1k.hdr` fetch failure even while queued records successfully retransmitted. The error came from graphics resource loading, not the learning-record API.

**How to apply:** For authentication/log-only tests, either finish loading scene resources before going offline or use the app's existing SVG fallback. This verifies account/log UI only; do not claim actual WebGL motion/scene verification from that pass.
