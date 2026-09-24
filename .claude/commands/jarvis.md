---
name: jarvis
description: Hand a goal to JARVIS - plan it, delegate to ECC specialist agents, verify, and report a briefing.
allowed-tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "Agent"]
---

# /jarvis

Project-level entry point for the JARVIS orchestrator, so it works in sessions
where the ECC plugin is not installed (for example Claude Code on the web).

## Goal

$ARGUMENTS

If the goal above is empty, ask the user for one in a single short question and stop.

## How It Works

Follow the workflow in `agents/jarvis.md` (also available as the project agent
`jarvis` in `.claude/agents/`):

1. **Understand** - restate the goal in one sentence, in the user's language
2. **Plan** - short numbered checklist, each step with an owner agent
3. **Execute** - delegate to specialists; when a specialist is not registered as a
   subagent, read its definition from `agents/<name>.md` and pass it in the prompt
   of a general-purpose agent, or do the step yourself
4. **Verify** - run `node tests/run-all.js` (or the relevant test files) and lint
5. **Brief** - finish with a `JARVIS BRIEFING` (Goal, Status, Done, Verification, Risks / Next)

## Examples

- `/jarvis fix the failing build and review the changes`
- `/jarvis bu projeyi incele ve güvenlik açıklarını raporla`

## Guardrails

- Never commit, push, deploy, or delete without explicit user approval
- Never skip or disable tests to get green
