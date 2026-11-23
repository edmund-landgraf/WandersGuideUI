/** Computed eidolon for a summoner. Null when the character has not chosen an eidolon type. */

export type EidolonAttack = { name: string; damage: string | null };

export type EidolonExport = {
  summoner_id: number | null;
  feature_id: number;
  name: string;
  type: string;
  tradition: string | null;
  size: string | null;
  attributes: Record<string, number>;
  ac: number | null;
  hp_pool: number | null;
  saves: { fortitude: string; reflex: string; will: string; perception: string };
  attacks: EidolonAttack[];
  senses: string[];
  languages: string[];
  skills: string[];
  speed: string | null;
  evolutions: { id: number; name: string }[];
};

type Block = {
  id: number;
  name?: string | null;
  description?: string | null;
  type?: string | null;
};

const ATTR: Record<string, string> = {
  str: "ATTRIBUTE_STR",
  dex: "ATTRIBUTE_DEX",
  con: "ATTRIBUTE_CON",
  int: "ATTRIBUTE_INT",
  wis: "ATTRIBUTE_WIS",
  cha: "ATTRIBUTE_CHA",
};

const STARTING_SAVES = {
  fortitude: "expert",
  reflex: "trained",
  will: "expert",
  perception: "trained",
};

function field(text: string, label: string) {
  const match = text.match(new RegExp(`^${label}\\s*:?\\s*(.+)$`, "im"));
  return match ? match[1].trim() : null;
}

function list(line: string | null) {
  if (!line) return [];
  return line.split(",").map((part) => part.trim()).filter(Boolean);
}

export function parseEidolonAttributes(text: string) {
  const attributes: Record<string, number> = {};
  for (const match of text.matchAll(/\b(Str|Dex|Con|Int|Wis|Cha)\s*([+\u2212\u2013-]?\d+)/gi)) {
    const key = ATTR[match[1].toLowerCase()];
    attributes[key] = Number(match[2].replace(/[\u2212\u2013]/g, "-"));
  }
  return attributes;
}

export function eidolonArmorClass(attributes: Record<string, number>, text: string) {
  const dex = attributes.ATTRIBUTE_DEX;
  if (typeof dex !== "number") return null;
  const stated = text.match(/\+(\d+)\s*AC\b/i);
  const item = stated ? Number(stated[1]) : dex >= 4 ? 1 : 2;
  return 10 + 3 + dex + item;
}

function parseAttacks(line: string | null): EidolonAttack[] {
  return list(line).map((part) => {
    const match = part.match(/^([^()]+?)(?:\s*\(([^)]+)\))?$/);
    return { name: (match?.[1] ?? part).trim(), damage: match?.[2]?.trim() ?? null };
  });
}

function isEidolonType(name: string) {
  return /eidolon$/i.test(name) && !/^eidolon$/i.test(name.trim());
}

export function buildEidolonExport(input: {
  summonerId?: number | null;
  maxHp?: number | null;
  selections?: Record<string, string> | null;
  blocks?: Block[] | null;
}): EidolonExport | null {
  const selections = input.selections ?? {};
  const blocks = input.blocks ?? [];
  const byId = new Map(blocks.filter((block) => typeof block.id === "number").map((block) => [block.id, block]));
  const evolutionIds = new Set(
    blocks.filter((block) => block.type === "class-feature" && /evolution/i.test(block.name ?? "")).map((block) => block.id)
  );
  let type: Block | undefined;
  const evolutions: Block[] = [];
  for (const [key, value] of Object.entries(selections)) {
    const id = Number(value);
    if (!Number.isInteger(id)) continue;
    const block = byId.get(id);
    if (!block?.name) continue;
    if (isEidolonType(block.name)) type = block;
    if ([...evolutionIds].some((featureId) => key.startsWith(`class-feature-${featureId}_`) || key.startsWith(`class-feature-${featureId}`))) {
      if (!isEidolonType(block.name)) evolutions.push(block);
    }
  }
  if (!type?.name) return null;
  const text = type.description ?? "";
  const attributes = parseEidolonAttributes(text);
  return {
    summoner_id: input.summonerId ?? null,
    feature_id: type.id,
    name: type.name,
    type: type.name.replace(/\s+eidolon$/i, ""),
    tradition: field(text, "Tradition"),
    size: field(text, "Size"),
    attributes,
    ac: eidolonArmorClass(attributes, text),
    hp_pool: input.maxHp ?? null,
    saves: STARTING_SAVES,
    attacks: parseAttacks(field(text, "Suggested Attacks")),
    senses: list(field(text, "Senses")),
    languages: list(field(text, "Languages") ?? field(text, "Language")),
    skills: list(field(text, "Skills")),
    speed: field(text, "Speed"),
    evolutions: evolutions.map((block) => ({ id: block.id, name: block.name ?? "" })),
  };
}
