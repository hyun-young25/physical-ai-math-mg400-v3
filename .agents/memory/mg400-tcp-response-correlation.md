---
name: MG400 TCP response correlation
description: Preserve correct command/result pairing on the MG400 Dashboard TCP protocol.
---

MG400 Dashboard responses echo the command but do not include a unique request ID. Verify the echoed command against the pending request. If a response is malformed, mismatched, or a command times out, close the connection and reject every pending request; do not reuse that socket for later commands.

**Why:** A late reply can arrive after a timeout. If the client removes the timed-out request and keeps the socket open, the reply can be mistaken for the result of the next command, including a pose observation or status.

**How to apply:** Keep command acknowledgements separate from fresh post-command telemetry. After timeout or protocol desynchronization, require reconnect before accepting more controller responses.
