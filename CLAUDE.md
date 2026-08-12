@AGENTS.md

# Wren — orchestration rules for subagents

Four subagents live in `.claude/agents/`:

- **wren-designer** (Opus) — matches submitted mockups pixel-faithfully; the mockup is its spec, brand tokens its vocabulary. Edits presentation only.
- **wren-implementer** (Opus) — writes and edits app code
- **wren-researcher** (Sonnet) — compares Wren against MyFitnessPal, Cal AI, Flow, Clue, Flo, Noom, Lifesum, Whoop, Oura on UX and feature mechanics
- **wren-auditor** (Opus, read-only) — flags safety, scope, drift, and ED-safety risks

## Delegation defaults

- Any task whose success is "make this screen match the mockup" → delegate to **wren-designer**, then run implementer (integrity) → auditor (safety) after it.
- Any task that produces or changes code → delegate to **wren-implementer**.
- Any task that asks "how does X app do Y" or "what's the standard pattern for Z" → delegate to **wren-researcher**.
- Risk review, code audit, "is this safe" → delegate to **wren-auditor**.

## Mandatory audit after implementation

**After every change from wren-implementer or wren-designer, automatically invoke wren-auditor before reporting work as done.** This is not optional and not conditional on the size of the change. (In the design-phase pipeline the order is designer → implementer → auditor.) The reason: the audit checklist covers ED-safety, birth-control branching, and Coach safety-prompt integrity — all of which can be silently broken by a one-line change.

The audit produces two outputs:
1. A report in chat
2. An `APPEND_TO .claude/audit-log.md:` block that should be appended to that file before reporting work complete

If the audit returns any **BLOCK** finding, do not report the implementation as done. Surface the blockers, ask Ting whether to address them, and only proceed after she decides.

## When auditor is not needed

- Pure research tasks from wren-researcher (no code changed)
- Conversational questions answered directly without delegating to implementer
- Reading files for context without modifying them
