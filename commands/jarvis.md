---
description: Hand a goal to JARVIS, the orchestrator agent that plans, delegates to ECC specialist agents, verifies, and reports back with a briefing.
---

# Jarvis Command

Invoke the **jarvis** agent to take a goal end to end.

## Usage

`/jarvis <goal>`

Examples:

- `/jarvis add rate limiting to the /login endpoint and test it`
- `/jarvis fix the failing build and review the changes`
- `/jarvis bu projeyi incele ve güvenlik açıklarını raporla`

## What Happens

1. JARVIS restates the goal and writes a short plan with an owner agent per step
2. Steps are delegated to specialists (planner, tdd-guide, code-reviewer, security-reviewer, build-error-resolver, ...), in parallel where independent
3. Tests, lint, and build are run to verify the result
4. A `JARVIS BRIEFING` summarizes status, changes, verification, and next steps

JARVIS never commits, pushes, or deploys without your approval.
