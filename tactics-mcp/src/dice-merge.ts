type DiceLogLike = {
  id?: string;
  initiated_by_user_id?: string;
  [key: string]: unknown;
};

type DiceStateLike = {
  title?: string;
  dc?: number | null;
  stat?: string | null;
  results?: unknown;
  results_audience?: string;
  [key: string]: unknown;
};

function sameUser(left: unknown, right: string) {
  return String(left ?? "").trim().toLowerCase() === right.trim().toLowerCase();
}

/** Player patches may only add, edit, or drop rolls they started. Untagged rows stay. */
export function mergePlayerDiceRollLog(existing: unknown, incoming: unknown, userId: string): DiceLogLike[] {
  const current = Array.isArray(existing) ? (existing as DiceLogLike[]) : [];
  const next = Array.isArray(incoming) ? (incoming as DiceLogLike[]) : [];
  const incomingById = new Map<string, DiceLogLike>();
  for (const entry of next) {
    if (entry.id) incomingById.set(entry.id, entry);
  }
  const result: DiceLogLike[] = [];
  const seen = new Set<string>();
  for (const entry of current) {
    if (entry.id && sameUser(entry.initiated_by_user_id, userId)) {
      const replacement = incomingById.get(entry.id);
      if (replacement) {
        result.push({ ...replacement, id: entry.id, initiated_by_user_id: userId });
        seen.add(entry.id);
      }
      continue;
    }
    result.push(entry);
    if (entry.id) seen.add(entry.id);
  }
  for (const entry of next) {
    if (entry.id && seen.has(entry.id)) continue;
    if (!sameUser(entry.initiated_by_user_id, userId)) continue;
    result.push({ ...entry, initiated_by_user_id: userId });
    if (entry.id) seen.add(entry.id);
  }
  return result;
}

/** Players may change title, DC, check, and grid results. Side and challenge stay as the GM left them. */
export function mergePlayerDiceRollState(existing: unknown, incoming: unknown): DiceStateLike | undefined {
  const current = existing && typeof existing === "object" ? (existing as DiceStateLike) : undefined;
  if (!incoming || typeof incoming !== "object") return current;
  const patch = incoming as DiceStateLike;
  const next: DiceStateLike = { ...(current ?? {}) };
  if ("title" in patch) next.title = patch.title;
  if ("dc" in patch) next.dc = patch.dc ?? null;
  if ("stat" in patch) next.stat = patch.stat ? patch.stat : undefined;
  if ("results" in patch) next.results = patch.results ?? {};
  if (patch.results_audience === "public") next.results_audience = "public";
  return next;
}
