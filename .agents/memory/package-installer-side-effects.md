---
name: Package installer side effects
description: Failed package-install callbacks can still change the workspace's Replit environment configuration.
---

A failed package-install callback is not necessarily a no-op. Check configuration diffs after failure and preserve the project's existing environment unless a runtime change is actually required.

**Why:** The package installer attempted a pnpm workspace-root addition without the required root flag, failed, but still inserted a Nix channel setting. The setting was unrelated to the requested app change.

**How to apply:** In this pnpm workspace, make root dev-tool additions explicit. After installer failure, inspect environment/configuration changes as well as package changes. Remove unintended configuration changes only through the validated configuration tools; do not replace unrelated user settings.

Command stdout from the sandbox shell callback may use CRLF even when the source file uses LF. Do not assume that piping command output through a file-write callback preserves the original file's newline format.

**Why:** A validated configuration restoration from command stdout produced an unintended whole-file whitespace diff until newlines were normalized.

**How to apply:** Prefer file reads for textual configuration copies. When command output is necessary, normalize newlines and check the resulting diff before finishing.