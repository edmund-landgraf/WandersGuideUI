const BASE = 'Random Encounter';

export function nextEncounterName(existing: Iterable<string>): string {
  const names = [...existing].map((name) => name.trim()).filter(Boolean);
  const used = new Set(names.map((name) => name.toLowerCase()));
  if (!used.has(BASE.toLowerCase())) return BASE;
  let index = 1;
  while (used.has(`${BASE} (${index})`.toLowerCase())) {
    index += 1;
  }
  return `${BASE} (${index})`;
}
