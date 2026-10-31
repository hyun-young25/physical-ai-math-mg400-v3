---
name: Playwright video capture
description: Playwright browser video capture depends on its expected FFmpeg executable being available.
---

Before using `BrowserContext.recordVideo`, check for the FFmpeg executable at the path expected by the installed Playwright version. A system `ffmpeg` on `PATH` may not satisfy Playwright's recorder.

**Why:** The app container had system FFmpeg, but Playwright refused to create a video context because its versioned cache executable was missing. Pointing that cache path at the existing system binary allowed recording to start; the capture still needs a valid duration and a complete UI run before it can be treated as a deliverable.

**How to apply:** Verify the recorder can finalize a playable WebM/MP4 and inspect duration before presenting it. A large partial WebM without duration is not a finished demo.
