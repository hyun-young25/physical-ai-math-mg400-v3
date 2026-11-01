---
name: Square execution evidence links
description: Prevent prior square measurements from being treated as evidence for a new run.
---

For the square lesson, a matching plan key alone does not establish that a controller measurement belongs to the current attempt. Give each DT mission and hardware measurement a distinct ID; record the exact prevalidation mission ID on the measurement; require both IDs and the plan to match before using it as current AI evidence. Persist stopped, disconnected, and failed attempts as incomplete records so an older same-plan measurement cannot become the latest evidence by omission.

**Why:** Repeating an unchanged plan leaves the same plan key. Without a run-to-run link, a previous successful measurement can appear to support a later DT or failed hardware attempt.

**How to apply:** Bind execution analysis and its UI availability to the current completed mission ID and linked measurement ID. Keep earlier measurements in history only, with their own attempt identity and status.
