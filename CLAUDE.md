@AGENTS.md

# Flux — orchestration rules for subagents

Three subagents live in `.claude/agents/`:

- **flux-implementer** (Opus) — writes and edits app code
- **flux-researcher** (Sonnet) — compares Flux against MyFitnessPal, Cal AI, Flow, Clue, Flo, Noom, Lifesum, Whoop, Oura on UX and feature mechanics
- **flux-auditor** (Opus, read-only) — flags safety, scope, drift, and ED-safety risks

## Delegation defaults

- Any task that produces or changes code → delegate to **flux-implementer**.
- Any task that asks "how does X app do Y" or "what's the standard pattern for Z" → delegate to **flux-researcher**.
- Risk review, code audit, "is this safe" → delegate to **flux-auditor**.

## Mandatory audit after implementation

**After every change from flux-implementer, automatically invoke flux-auditor before reporting work as done.** This is not optional and not conditional on the size of the change. The reason: the audit checklist covers ED-safety, birth-control branching, and Coach safety-prompt integrity — all of which can be silently broken by a one-line change.

The audit produces two outputs:
1. A report in chat
2. An `APPEND_TO .claude/audit-log.md:` block that should be appended to that file before reporting work complete

If the audit returns any **BLOCK** finding, do not report the implementation as done. Surface the blockers, ask Ting whether to address them, and only proceed after she decides.

## When auditor is not needed

- Pure research tasks from flux-researcher (no code changed)
- Conversational questions answered directly without delegating to implementer
- Reading files for context without modifying them
