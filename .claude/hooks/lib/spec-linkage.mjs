// Shared parser for a spec's per-rule `traces:` block - the declared cross-layer edge.
//
// Rationale (2026-09-16): build-knowledge-index.mjs owned this parser privately and reported
// 0 of 611 business rules traced. A gate that re-implemented the same shape would drift from the
// reporter the first time either changed, and the two would disagree about what "traced" means
// while both looked green. One parser, two callers.
//
// Shape (all lists optional; at least one non-empty makes a rule traced):
//   business_rules:
//     - id: BR-RMT-029
//       traces:
//         api: [GET_REMARKETING_TITLES_ENDPOINT]   # names from tests/example_env
//         db: [TITLE_REMARKETING_TRACKER]          # constants from db_schema.py
//         tests: [backend:tests/smoke/.../test_x.py]

export const BR_ID_RE = /\bBR-[A-Z]{2,}-\d+\b/;
export const BR_ID_GLOBAL_RE = /\bBR-[A-Z]{2,}-\d+\b/g;

export function parseRuleTraces(text) {
  const start = text.indexOf("\nbusiness_rules:");
  if (start < 0) return [];
  const rest = text.slice(start + 1);
  const end = rest.search(/\n[a-z_]+:/);
  const body = end < 0 ? rest : rest.slice(0, end);
  return body
    .split(/\n(?=\s*-\s*id:\s*BR-)/)
    .map((entry) => {
      const id = entry.match(BR_ID_RE)?.[0];
      if (!id) return null;
      const list = (key) => {
        const inline = entry.match(new RegExp(`^\\s*${key}:\\s*\\[(.+)\\]\\s*$`, "m"));
        if (inline) {
          return inline[1]
            .split(",")
            .map((v) => v.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        }
        const blockStart = entry.search(new RegExp(`^\\s*${key}:\\s*$`, "m"));
        if (blockStart < 0) return [];
        const after = entry.slice(blockStart).split("\n").slice(1);
        const items = [];
        for (const line of after) {
          const item = line.match(/^\s*-\s*(.+?)\s*$/);
          if (!item) break;
          items.push(item[1].replace(/^["']|["']$/g, ""));
        }
        return items;
      };
      const traces = { ui: list("ui"), api: list("api"), db: list("db"), tests: list("tests") };
      return { id, traces, traced: Object.values(traces).some((v) => v.length > 0) };
    })
    .filter(Boolean);
}

// Rules in this spec that are newly untraced - not covered by the baseline. The baseline is the
// ratchet: everything untraced when the gate landed is exempt, so the count can only fall.
export function untracedRules(text, baselineIds) {
  const exempt = baselineIds instanceof Set ? baselineIds : new Set(baselineIds ?? []);
  return parseRuleTraces(text)
    .filter((rule) => !rule.traced && !exempt.has(rule.id))
    .map((rule) => rule.id);
}

// A baselined rule that has gained traces must leave the baseline, or the ratchet silently
// stops tightening - the same "remove it from the list once it is documented" rule ADR-0027
// applied to hook rationales.
export function tracedButBaselined(text, baselineIds) {
  const exempt = baselineIds instanceof Set ? baselineIds : new Set(baselineIds ?? []);
  return parseRuleTraces(text)
    .filter((rule) => rule.traced && exempt.has(rule.id))
    .map((rule) => rule.id);
}
