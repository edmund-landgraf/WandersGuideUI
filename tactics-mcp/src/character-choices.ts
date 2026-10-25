export type ChoiceOption = { id: string; name: string; traits: string[] };
export type OpenChoice = {
  id: string;
  source: string;
  kind: string;
  remaining: number;
  already: string[];
  options: ChoiceOption[];
};

type ResultNode = {
  selection?: {
    id?: string;
    title?: string;
    options?: Record<string, unknown>[];
  };
  result?: {
    source?: { name?: string; _select_uuid?: string };
    results?: ResultNode[];
  };
} | null;

function traitsOf(option: Record<string, unknown>) {
  const raw = option.traits;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function optionOf(option: Record<string, unknown>): ChoiceOption | null {
  const id = typeof option._select_uuid === "string" ? option._select_uuid : typeof option.id === "number" || typeof option.id === "string" ? String(option.id) : "";
  if (!id) return null;
  const name = typeof option.name === "string" ? option.name : id;
  return { id, name, traits: traitsOf(option) };
}

function filledNames(results: ResultNode[] | undefined): string[] {
  const names: string[] = [];
  for (const result of results ?? []) {
    if (!result) continue;
    if (typeof result.result?.source?.name === "string") names.push(result.result.source.name);
    names.push(...filledNames(result.result?.results));
  }
  return names;
}

export function collectOpenChoices(results: ResultNode[] | undefined, source: string, alreadyNames: string[] = [], trail = ""): OpenChoice[] {
  const already = [...new Set([...alreadyNames, ...filledNames(results)])];
  const found: OpenChoice[] = [];
  for (const result of results ?? []) {
    if (!result) continue;
    const selectionId = result.selection?.id || result.selection?.title || "";
    if (result.selection && !result.result?.source) {
      const options = (result.selection.options ?? []).map(optionOf).filter((item): item is ChoiceOption => item !== null);
      const kind = options.length ? kindOf(result.selection.options?.[0]) : "select";
      found.push({
        id: [source, trail, selectionId].filter(Boolean).join("_"),
        source,
        kind,
        remaining: 1,
        already,
        options,
      });
    }
    const selectedUuid = result.result?.source?._select_uuid ?? "";
    const nextTrail = [trail, selectionId, selectedUuid].filter(Boolean).join("_");
    found.push(...collectOpenChoices(result.result?.results, source, already, nextTrail));
  }
  return found;
}

function kindOf(option: Record<string, unknown> | undefined) {
  const content = option?._content_type;
  return typeof content === "string" ? content : "select";
}

export type ChoicePackage = {
  ancestryResults?: ResultNode[];
  backgroundResults?: ResultNode[];
  classResults?: ResultNode[];
  class2Results?: ResultNode[];
  characterResults?: ResultNode[];
  ancestrySectionResults?: { baseSource?: { id?: number; name?: string }; baseResults?: ResultNode[] }[];
  classFeatureResults?: { baseSource?: { id?: number; name?: string }; baseResults?: ResultNode[] }[];
  contentSourceResults?: { baseSource?: { id?: number; name?: string }; baseResults?: ResultNode[] }[];
  itemResults?: { baseSource?: { id?: number; name?: string }; baseResults?: ResultNode[] }[];
};

function sectionPrefix(fallback: string, source: { id?: number; name?: string } | undefined) {
  return typeof source?.id === "number" ? `${fallback}-${source.id}` : fallback;
}

export function openChoicesFromPackage(pkg: ChoicePackage): OpenChoice[] {
  const sections: OpenChoice[][] = [
    collectOpenChoices(pkg.ancestryResults, "ancestry"),
    collectOpenChoices(pkg.backgroundResults, "background"),
    collectOpenChoices(pkg.classResults, "class"),
    collectOpenChoices(pkg.class2Results, "class-2"),
    collectOpenChoices(pkg.characterResults, "character"),
  ];
  for (const section of pkg.ancestrySectionResults ?? []) {
    sections.push(collectOpenChoices(section.baseResults, sectionPrefix("ancestry-section", section.baseSource)));
  }
  for (const section of pkg.classFeatureResults ?? []) {
    sections.push(collectOpenChoices(section.baseResults, sectionPrefix("class-feature", section.baseSource)));
  }
  for (const section of pkg.contentSourceResults ?? []) {
    sections.push(collectOpenChoices(section.baseResults, sectionPrefix("content-source", section.baseSource)));
  }
  for (const section of pkg.itemResults ?? []) {
    sections.push(collectOpenChoices(section.baseResults, sectionPrefix("item", section.baseSource)));
  }
  return sections.flat();
}

export type ChoiceRunner = (character: Record<string, unknown>, userId: string) => Promise<OpenChoice[]>;

let runner: ChoiceRunner | null = null;
let applier: ((character: Record<string, unknown>) => Promise<Record<string, unknown>>) | null | undefined;

export function setCharacterChoiceRunner(next: ChoiceRunner | null) {
  runner = next;
}

/** null skips the operation pass. undefined uses the builder operation pass. */
export function setCharacterWriteApplier(next: ((character: Record<string, unknown>) => Promise<Record<string, unknown>>) | null | undefined) {
  applier = next;
}

export async function listCharacterChoices(character: Record<string, unknown>, userId: string) {
  if (runner) return runner(character, userId);
  const { liveCharacterChoices } = await import("./character-choices-live.js");
  return liveCharacterChoices(character, userId);
}

export async function applyCharacterWrite(character: Record<string, unknown>) {
  if (applier === null) return character;
  if (applier) return applier(character);
  const { liveCharacterWrite } = await import("./character-choices-live.js");
  return liveCharacterWrite(character);
}
