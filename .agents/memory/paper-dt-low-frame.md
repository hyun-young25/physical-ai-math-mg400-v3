---
name: Paper DT low-frame completion
description: Preserve completion, failure, and cancellation behavior for paper-coordinate DT under slow browser rendering.
---

For paper-coordinate DT playback, measure segment duration from the time a frame is scheduled, not from the first delayed animation callback. Keep a per-frame no-progress watchdog (12 seconds in the current environment); on timeout, cancellation, or failure, reject the run, cancel the pending frame, release the execution state, and ignore late callbacks. A successful run must still visit every target and return to its start.

**Why:** the software-WebGL browser showed animation-frame gaps around 0.9–4.6 seconds. Starting each segment's clock on its first callback made every segment wait for an unnecessary extra frame, so the browser run stayed active without reaching saved observations before the verification deadline.

**How to apply:** when changing DT scheduling or timeouts, preserve all waypoint and outline checks. Test successful return, no-frame timeout, explicit cancellation, unreachable intermediate poses, and late callbacks; never turn a stalled run into a synthetic success.
