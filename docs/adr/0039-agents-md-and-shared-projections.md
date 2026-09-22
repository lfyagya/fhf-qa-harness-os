# ADR-0039 — AGENTS.md is the instruction entry

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-22 |

## Context

ADR-0038 projected one hook list to Claude and Cursor, and left rule text in `.claude/rules`. Codex stayed `instruction-only`. The generated `AGENTS.md` told every other tool to read `CLAUDE.md` first, so the shared file pointed at a Claude file. Codex now runs the same lifecycle events from `.codex/hooks.json` (exit 2 blocks; `UserPromptSubmit` accepts `additionalContext`). `PreToolUse` rejects `continue`. Unknown JSON fields fail the hook and the tool call proceeds. ChatGPT's website chat still has no project hook runner.

## Decision

1. `AGENTS.md` is the instruction entry. `CLAUDE.md` imports it with `@AGENTS.md`. Copilot and Gemini instructions point at `AGENTS.md`. Codex and Cursor read `AGENTS.md` directly. The file names `rules/` and does not paste every rule into itself.
2. Rule text lives in `rules/`. `.claude/rules/*.md` is a symlink to that file. `.cursor/rules/*.mdc` is generated from the same file: `paths` frontmatter becomes `globs`, and a file with no `paths` is `alwaysApply`. The three always-on policies (`task-approval`, `thin-tests`, `pre-human-review`) use one body. The path-scoped Claude pre-human-review text is replaced by that always-on body.
3. `engineering.harness.hooks` stays the only hook list. `.codex/hooks.json` is a projection of the events Codex has. `PostToolUseFailure` is omitted because Codex has no such event; the repeat guard still runs on `PreToolUse` and `PostToolUse`. `engineering.harness.adapters.codex.hookCapability` is `hooks-json`. `instructionFile` stays `AGENTS.md`. Codex commands set `FHF_HOOK_HOST=codex` so the shared emitter omits fields Codex rejects (`user_message`, `additional_context`) and never sends `continue` on `PreToolUse`. Claude and Cursor commands stay byte-identical. The launcher resolves the git root when `CLAUDE_PROJECT_DIR` and `CURSOR_PROJECT_DIR` are unset. Lane repositories do not receive a second hook file (ADR-0032). The tool-name matcher is one string, the union of the names Claude, Cursor, and Codex use for that action, so the same guard fires in each tool. Empty `.codex/` directories on those lanes are still removed.

## Consequences

A tool that can read `AGENTS.md` gets the same entry. A tool that can run hooks runs the same scripts. ChatGPT's website chat follows `AGENTS.md` only. Codex `SessionEnd` allows at most three seconds. A Codex `Read` tool is not part of the documented tool list, so the read guard runs when the tool name is `Read`. Gate edits still require `FHF_ALLOW_HARNESS_EDIT=1`.
