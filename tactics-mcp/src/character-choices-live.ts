import { sheetEnv } from "./live-sheet.js";
import { openChoicesFromPackage, type OpenChoice } from "./character-choices.js";

const WRITE_FIELDS = [
  "name",
  "level",
  "experience",
  "hp_current",
  "hp_temp",
  "hero_points",
  "stamina_current",
  "resolve_current",
  "inventory",
  "notes",
  "details",
  "roll_history",
  "custom_operations",
  "meta_data",
  "options",
  "variants",
  "content_sources",
  "operation_data",
  "spells",
  "companions",
] as const;

function enabledSources(character: Record<string, unknown>, coreId: number) {
  const enabled = (character.content_sources as { enabled?: unknown } | undefined)?.enabled;
  const ids = Array.isArray(enabled) ? enabled.filter((id): id is number => typeof id === "number") : [];
  return [...new Set([coreId, ...ids])];
}

async function runBuilder(character: Record<string, unknown>) {
  sheetEnv();
  const { COMMON_CORE_ID } = await import("../../src/constants/data.ts");
  const { fetchContentPackage, fetchContentSources } = await import("../../src/process/content/content-store.ts");
  const { executeOperations } = await import("../../src/process/operations/operations.main.ts");
  const { cloneDeep } = await import("lodash-es");
  const sources = enabledSources(character, COMMON_CORE_ID);
  await fetchContentSources(sources);
  const content = await fetchContentPackage(sources, { fetchSources: true, fetchCreatures: false });
  content.defaultSources = { PAGE: sources, INFO: sources };
  const next = cloneDeep(character);
  const results = await executeOperations(
    { type: "CHARACTER", data: { character: next as never, content, context: "CHARACTER-BUILDER" } },
    { directExecution: true, silent: true },
  );
  return { next: next as Record<string, unknown>, results };
}

export async function liveCharacterChoices(character: Record<string, unknown>, _userId: string): Promise<OpenChoice[]> {
  const { results } = await runBuilder(character);
  return openChoicesFromPackage(results as never);
}

export async function liveCharacterWrite(character: Record<string, unknown>) {
  const { next } = await runBuilder(character);
  const patch: Record<string, unknown> = {};
  for (const key of WRITE_FIELDS) {
    if (key in next) patch[key] = next[key];
  }
  return { ...character, ...patch };
}
