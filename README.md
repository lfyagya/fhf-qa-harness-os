# FHF QA Engine

GSD Core + the FHF QA layer for the FHF workspace. **Start with [ONBOARDING.md](ONBOARDING.md).**

| Path | What it is |
|---|---|
| `setup.mjs` | One command: clones FHF repos, installs GSD Core (pinned), applies the FHF layer and guardrails |
| `repos.json` | FHF repositories: writable test lanes and read-only product source |
| `overlay/` | Copied into the workspace root: `CLAUDE.md` (also `AGENTS.md`), `.claude/agents`, `.claude/rules`, `.claude/skills` |

Change FHF behavior by editing `overlay/` or `repos.json`, then re-run `node setup.mjs`.
Never hand-edit the generated files in the workspace.

Third-party skills in `overlay/.claude/skills/` (`grill-me`, `grilling`, `grill-with-docs`,
`domain-modeling`) are from [mattpocock/skills](https://github.com/mattpocock/skills), MIT; each
folder keeps its LICENSE.
