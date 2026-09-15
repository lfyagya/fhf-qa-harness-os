---
name: skill-creator
description: "Draft an ADR-0022 skill proposal. Use only when the user says skill-creator or create a skill. Stay in parent. Do not write consumer skills or add an allow-list name."
---

# Skill creator (FHF-routed)

Stay in the parent. This skill is callable only from the `skill-creator` route.

## Job

Draft one skill proposal that can pass ADR-0022: single job, vendor path under
`fhf-harness-os/.claude/skills/<name>/SKILL.md`, allow-list name, route `invoke`,
proof it does not steal generate / gate / debug / ship.

## Do not

- Write the skill into a consumer clone.
- Add a name to `engineering.harness.skills` from chat.
- Enable a marketplace plugin as an always-on catalog entry.

The owner adds the name, the route `invoke`, and syncs after the ADR.
