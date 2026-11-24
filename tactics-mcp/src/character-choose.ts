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

function selectionsKey(selections: Selections) {
  return JSON.stringify(Object.keys(selections).sort().map((key) => [key, selections[key]]));
}

function copyChoices(choices: OpenChoice[]): OpenChoice[] {
  return choices.map((choice) => ({ ...choice, options: choice.options.map((option) => ({ ...option })) }));
}

/**
 * Applies picks in order against an in-memory copy of the character. Each pick is
 * validated against the open choices produced by the picks before it, so a pick may
 * answer a dependent choice that an earlier pick in the same batch opened. A failed
 * pick leaves the selections exactly as they were before it and the batch continues.
 * Returns the final selections and one result per pick; it never writes.
 *
 * Picks that are already legal on the current open list share one builder run.
 * The builder runs again only when a pick re-answers a stored key (so nested
 * answers are stripped and the choice reopens) or when a pick names a choice the
 * current list does not have (a dependent choice an earlier pick may have opened).
 * Taking an option removes that option from other open choices of the same source,
 * which is the usual sibling exclusion (two boosts, two languages, two skills).
 */
export async function planPicks(character: Character, picks: ChoicePick[], list: ListChoices) {
  let selections = selectionsOf(character);
  const results: PickResult[] = [];
  let cached: { key: string; choices: OpenChoice[] } | null = null;

  async function load(next: Selections): Promise<PickError | null> {
    const key = selectionsKey(next);
    if (cached?.key === key) return null;
    try {
      cached = { key, choices: copyChoices(await list(withSelections(character, next))) };
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Character operations failed.";
      const retryable = /fetch failed|timeout|ECONNRESET|EAI_AGAIN|ENOTFOUND|UND_ERR/i.test(message);
      if (retryable) {
        try {
          cached = { key, choices: copyChoices(await list(withSelections(character, next))) };
          return null;
        } catch (again) {
          cached = null;
          const retryMessage = again instanceof Error ? again.message : message;
          return { code: "INTERNAL_ERROR", message: retryMessage, retryable: true };
        }
      }
      cached = null;
      return { code: "INTERNAL_ERROR", message, retryable: false };
    }
  }

  for (const [index, pick] of picks.entries()) {
    const wasAnswered = Object.prototype.hasOwnProperty.call(selections, pick.choiceId);
    const stripped = Object.fromEntries(
      Object.entries(selections).filter(([key]) => key !== pick.choiceId && !key.startsWith(`${pick.choiceId}_`)),
    );
    const viewed = wasAnswered ? stripped : selections;
    let failure = await load(viewed);
    let choice = cached?.choices.find((item) => item.id === pick.choiceId);
    // A choice opened by an earlier pick in this batch is absent until the builder runs again.
    if (!failure && !choice && !wasAnswered) {
      cached = null;
      failure = await load(viewed);
      choice = cached?.choices.find((item) => item.id === pick.choiceId);
    }
    if (failure) {
      results.push({ index, choiceId: pick.choiceId, optionId: pick.optionId, status: "error", ...failure });
      continue;
    }
    if (!choice) {
      results.push({ index, choiceId: pick.choiceId, optionId: pick.optionId, status: "error", code: "NOT_FOUND", message: "That choice is not open.", retryable: false });
      continue;
    }
    if (!choice.options.some((option) => option.id === pick.optionId)) {
      results.push({ index, choiceId: pick.choiceId, optionId: pick.optionId, status: "error", code: "VALIDATION_ERROR", message: "That option is not legal for this choice.", retryable: false });
      continue;
    }
    const source = choice.source;
    const optionId = pick.optionId;
    const replaced = wasAnswered ? selections[pick.choiceId] ?? null : null;
    selections = { ...stripped, [pick.choiceId]: optionId };
    results.push({ index, choiceId: pick.choiceId, optionId, status: "applied", replaced });
    if (cached) {
      cached = {
        key: selectionsKey(selections),
        choices: cached.choices
          .filter((item) => item.id !== pick.choiceId && !item.id.startsWith(`${pick.choiceId}_`))
          .map((item) => item.source === source
            ? { ...item, options: item.options.filter((option) => option.id !== optionId) }
            : item),
      };
    }
  }

  const original = selectionsOf(character);
  if (results.some((result) => result.status === "applied")) {
    // The loop's option filter only drops the same option id. Ask the builder once
    // whether every applied pick actually closed. A choice that is still open was ignored.
    cached = null;
    const failure = await load(selections);
    if (failure) {
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (result.status !== "applied") continue;
        results[index] = {
          index: result.index,
          choiceId: result.choiceId,
          optionId: result.optionId,
          status: "error",
          ...failure,
        };
      }
      selections = original;
    } else {
      const stillOpen = new Set((cached?.choices ?? []).map((choice) => choice.id));
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (result.status !== "applied" || !stillOpen.has(result.choiceId)) continue;
        results[index] = {
          index: result.index,
          choiceId: result.choiceId,
          optionId: result.optionId,
          status: "error",
          code: "VALIDATION_ERROR",
          message: "That option is not legal for this choice.",
          retryable: false,
        };
      }
      selections = replay(original, results);
    }
  }

  const applied = results.filter((result) => result.status === "applied").length;
  return { selections, results, applied, failed: results.length - applied };
}

function replay(original: Selections, results: PickResult[]): Selections {
  let selections = original;
  for (const result of results) {
    if (result.status !== "applied") continue;
    const stripped = Object.fromEntries(
      Object.entries(selections).filter(([key]) => key !== result.choiceId && !key.startsWith(`${result.choiceId}_`)),
    );
    selections = { ...stripped, [result.choiceId]: result.optionId };
  }
  return selections;
}
