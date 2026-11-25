/** A Strike is a basic attack, not any action that mentions making a Strike. */
export function isEncounterStrike(ability: {
  name: string; type?: string; source?: string; actions?: unknown;
  actionCost?: unknown; description?: string | null;
}): boolean {
  if (ability.source === "Weapon") return true;
  if (ability.type !== "action") return false;
  const cost = ability.actionCost ?? ability.actions;
  if (cost != null && cost !== "ONE-ACTION" && cost !== 1) return false;
  const name = ability.name.trim();
  if (/^(?:melee |ranged )?strike$/i.test(name)) return true;
  const description = (ability.description ?? "").replace(/<[^>]+>/g, " ").replace(/[*_#]/g, "").trim();
  // AMBA blocks and generated inventory attacks begin with a melee/ranged
  // attack heading; don't classify later prose about a Strike as an attack.
  return /^(?:melee|ranged)\b[^\n]{0,180}\b(?:damage|[+-]\s*\d+\b)/i.test(description)
    || /^(?:melee|ranged)\s+weapon\s+strike\b/i.test(description);
}
