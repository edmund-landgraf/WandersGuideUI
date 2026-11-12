import type { OpenChoice } from "./character-choices.js";

export type ChoicePick = { choiceId: string; optionId: string };

export type PickError = {
  code: "NOT_FOUND" | "VALIDATION_ERROR" | "INTERNAL_ERROR";
  message: string;
  retryable: boolean;
};

export type PickResult =
  | { index: number; choiceId: string; optionId: string; status: "applied"; replaced: string | null }
  /** Legal, but not saved because the batch was atomic and another pick failed. */
  | { index: number; choiceId: string; optionId: string; status: "not_saved"; replaced: string | null }
  | ({ index: number; choiceId: string; optionId: string; status: "error" } & PickError);

type Character = Record<string, unknown>;
type Selections = Record<string, string>;
export type ListChoices = (character: Character) => Promise<OpenChoice[]>;

export function selectionsOf(character: Character): Selections {
  const operation = (character.operation_data as Record<string, unknown> | undefined) ?? {};
  return { ...((operation.selections as Selections | undefined) ?? {}) };
}

export function withSelections(character: Character, selections: Selections): Character {
  const operation = (character.operation_data as Record<string, unknown> | undefined) ?? {};
  return { ...character, operation_data: { ...operation, selections } };
}

/**
 * Plans one pick on top of `selections`, exactly as the single `choose` tool does:
 * drop the target key and every nested `${choiceId}_*` answer, rerun the builder on
 * the stripped selections when the target was already answered (so it shows up as
 * open again), and accept the option only when it is one of that choice's legal options.
 * Nothing is written here. The caller decides when to save.
 */
export async function planPick(
  character: Character,
  selections: Selections,
  pick: ChoicePick,
  list: ListChoices,
): Promise<{ ok: true; selections: Selections; replaced: string | null } | ({ ok: false } & PickError)> {
  const wasAnswered = Object.prototype.hasOwnProperty.call(selections, pick.choiceId);
  // Remove the target and nested answers before rerunning the builder. This makes an
  // answered choice visible again and prevents stale dependent selections from
  // surviving a changed parent choice.
  const stripped = Object.fromEntries(
    Object.entries(selections).filter(([key]) => key !== pick.choiceId && !key.startsWith(`${pick.choiceId}_`)),
  );
  let choices: OpenChoice[];
  try {
    choices = await list(withSelections(character, wasAnswered ? stripped : selections));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Character operations failed.";
    return { ok: false, code: "INTERNAL_ERROR", message, retryable: true };
  }
  const choice = choices.find((item) => item.id === pick.choiceId);
  if (!choice) return { ok: false, code: "NOT_FOUND", message: "That choice is not open.", retryable: false };
  if (!choice.options.some((option) => option.id === pick.optionId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "That option is not legal for this choice.", retryable: false };
  }
  return {
    ok: true,
    selections: { ...stripped, [pick.choiceId]: pick.optionId },
    replaced: wasAnswered ? selections[pick.choiceId] ?? null : null,
  };
}

/**
 * Applies picks in order against an in-memory copy of the character. Each pick is
 * validated against the open choices produced by the picks before it, so a pick may
 * answer a dependent choice that an earlier pick in the same batch opened. A failed
 * pick leaves the selections exactly as they were before it and the batch continues.
 * Returns the final selections and one result per pick; it never writes.
 */
export async function planPicks(character: Character, picks: ChoicePick[], list: ListChoices) {
  let selections = selectionsOf(character);
  const results: PickResult[] = [];
  for (const [index, pick] of picks.entries()) {
    const planned = await planPick(character, selections, pick, list);
    if (planned.ok) {
      selections = planned.selections;
      results.push({ index, choiceId: pick.choiceId, optionId: pick.optionId, status: "applied", replaced: planned.replaced });
    } else {
      const { ok: _ok, ...error } = planned;
      results.push({ index, choiceId: pick.choiceId, optionId: pick.optionId, status: "error", ...error });
    }
  }
  const applied = results.filter((result) => result.status === "applied").length;
  return { selections, results, applied, failed: results.length - applied };
}
