import { sheetEnv } from "./live-sheet.js";
import { companionChoicesFromPackage } from "./character-companions.js";

function enabledSources(character: Record<string, unknown>, coreId: number) {
  const enabled = (character.content_sources as { enabled?: unknown } | undefined)?.enabled;
  const ids = Array.isArray(enabled) ? enabled.filter((id): id is number => typeof id === "number") : [];
  return [...new Set([coreId, ...ids])];
}

// Same creature operation pass CompanionsPanel uses for COMPANION_<index>, after the character level is on the CHARACTER store.
// Level -100 companions read that level in getEntityLevel.
export async function liveCompanionChoices(character: Record<string, unknown>, creature: Record<string, unknown>, index: number) {
  sheetEnv();
  const { COMMON_CORE_ID } = await import("../../src/constants/data.ts");
  const { fetchContentPackage, fetchContentSources } = await import("../../src/process/content/content-store.ts");
  const { executeOperations } = await import("../../src/process/operations/operations.main.ts");
  const { resetVariables, setVariable } = await import("../../src/process/variables/variable-manager.ts");
  const sources = enabledSources(character, COMMON_CORE_ID);
  await fetchContentSources(sources);
  const content = await fetchContentPackage(sources, { fetchSources: true, fetchCreatures: false });
  content.defaultSources = { PAGE: sources, INFO: sources };
  resetVariables("CHARACTER");
  const level = typeof character.level === "number" ? character.level : 1;
  setVariable("CHARACTER", "LEVEL", level);
  const results = await executeOperations(
    { type: "CREATURE", data: { id: `COMPANION_${index}`, creature: creature as never, content } },
    { directExecution: true, silent: true },
  );
  return companionChoicesFromPackage(results as never);
}
