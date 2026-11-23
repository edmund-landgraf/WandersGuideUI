export const LINK_FLAG = "foundry-wanderersguide-import";

function linkage(flags, keys) {
  const raw = flags?.[LINK_FLAG];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const key of keys) {
    if (raw[key] == null || raw[key] === "") continue;
    out[key] = raw[key];
  }
  return Object.keys(out).length ? out : null;
}

function allowFlags(flags, keys) {
  const rules = flags?.pf2e?.rulesSelections;
  const next = rules && typeof rules === "object" && !Array.isArray(rules) ? { pf2e: { rulesSelections: rules } } : {};
  const link = linkage(flags, keys);
  if (link) next[LINK_FLAG] = link;
  return next;
}

/** Top-level actor and embedded item flags only. Nested module flags are removed. */
export function scrubActorFlags(actor) {
  if (!actor || typeof actor !== "object") return actor;
  actor.flags = allowFlags(actor.flags, ["wgId", "host"]);
  if (Array.isArray(actor.items)) {
    for (const item of actor.items) {
      if (!item || typeof item !== "object") continue;
      item.flags = allowFlags(item.flags, ["wgItemId", "wgInvId"]);
      if (item.system?.flags) delete item.system.flags[LINK_FLAG];
    }
  }
  return actor;
}
