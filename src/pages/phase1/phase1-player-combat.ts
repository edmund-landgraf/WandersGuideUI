type PlayerCombatantLike = {
  type?: string;
  ally?: boolean | null;
  data?: { hp_current?: number | null; name?: string | null } | null;
};

const TRAILING_INSTANCE = /^(.*?)(?:\s+\((\d+)\)|\s+(\d+))$/;

export function isEnemyCreature(combatant: PlayerCombatantLike): boolean {
  return combatant.type === 'CREATURE' && combatant.ally !== true;
}

export function isPlayerVisibleCombatant(combatant: PlayerCombatantLike): boolean {
  if (!isEnemyCreature(combatant)) return true;
  const hp = combatant.data?.hp_current;
  // A new creature often has no stored HP yet. The GM grid shows that as full HP.
  if (hp == null) return true;
  return hp > 0;
}

export function playerVisibleCombatants<T extends PlayerCombatantLike>(combatants: T[]): T[] {
  return combatants.filter(isPlayerVisibleCombatant);
}

export function playerEnemyLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const match = trimmed.match(TRAILING_INSTANCE);
  const base = (match?.[1] ?? trimmed).trim();
  const paren = match?.[2];
  const spaced = match?.[3];
  const initials = base
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((piece) => piece[0]!.toUpperCase())
    .join('');
  if (paren) return `${initials} (${paren})`;
  if (spaced) return `${initials}${spaced}`;
  return initials;
}

export function playerSaveDc(modifier: number): number {
  return 10 + modifier;
}

export function playerAllyRoundLog<T extends { entries: { ally: boolean }[] }>(log: T[]): T[] {
  return log.flatMap((round) => {
    const entries = round.entries.filter((entry) => entry.ally);
    if (entries.length === 0) return [];
    return [{ ...round, entries }];
  });
}
