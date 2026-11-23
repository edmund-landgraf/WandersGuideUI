export function sameFunctionsHost(left, right) {
  const origin = (value) => {
    const text = String(value ?? "").trim().replace(/\/+$/, "");
    if (!text) return null;
    try { return new URL(text).origin; }
    catch { return null; }
  };
  const a = origin(left);
  const b = origin(right);
  return !!a && a === b;
}

/** wgId first. World id plus actor id only when wgId is absent. A bad wgId does not create. */
export function findBuilderCharacter(characters, { wgId, worldId, actorId, host, signedInHost }) {
  if (host && signedInHost && !sameFunctionsHost(host, signedInHost)) {
    return { action: "reject", reason: "host-mismatch" };
  }
  if (wgId != null && wgId !== "") {
    const match = characters.find((character) => character.id === wgId || character.id === Number(wgId));
    if (!match) return { action: "reject", reason: "rejected-link" };
    return { action: "update", character: match };
  }
  const fallback = characters.find((character) => {
    const foundry = character.meta_data?.foundry;
    return foundry?.worldId === worldId && foundry?.actorId === actorId;
  });
  if (fallback) return { action: "update", character: fallback };
  return { action: "create" };
}

const SESSION = new Set(["hp_current", "hp_temp", "hero_points", "conditions", "effects", "spell_slots", "focus_points", "shield_hp", "broken"]);

/**
 * Persistent builder columns only. A collection is the full next column or it is omitted.
 * Confirm is off when every row is not-applied or a conflict.
 */
export function planBuilderUpdate(character, proposal) {
  const rows = [];
  const body = { id: character.id };
  if (character.updated_at) body.expected_updated_at = character.updated_at;
  if (proposal.name && proposal.name !== character.name) {
    body.name = proposal.name;
    rows.push({ field: "name", status: "write" });
  }
  if (proposal.level != null && proposal.level !== character.level) {
    body.level = proposal.level;
    rows.push({ field: "level", status: "write", note: "Class features are not rebuilt until the character is opened." });
  }
  for (const field of SESSION) {
    if (proposal[field] != null) rows.push({ field, status: "not applied" });
  }
  if (proposal.inventory) {
    const current = character.inventory ?? [];
    if (proposal.inventory.status === "conflict" || (proposal.inventory.column?.length === 0 && current.length > 0)) {
      rows.push({ field: "inventory", status: "conflict" });
    } else if (proposal.inventory.status === "unpaired") {
      rows.push({ field: "inventory", status: "not applied" });
    } else if (proposal.inventory.status === "paired" && JSON.stringify(proposal.inventory.column) !== JSON.stringify(current)) {
      body.inventory = proposal.inventory.column;
      rows.push({ field: "inventory", status: "write" });
    }
  }
  if (proposal.meta) {
    body.meta_data = { ...character.meta_data, foundry: { ...character.meta_data?.foundry, ...proposal.meta } };
    rows.push({ field: "meta_data", status: "write" });
  }
  const writes = rows.filter((row) => row.status === "write");
  const confirm = writes.length > 0 && rows.every((row) => row.status === "write" || row.status === "not applied");
  return { action: "update", body: confirm ? body : { id: character.id }, rows, confirm };
}

export function applyConflict(previous, serverRow) {
  return { stale: true, character: serverRow, previousId: previous.id };
}

/** Server stand-in: the same idempotency key returns the first row and does not insert again. */
export function serverCreateCharacter(store, key, body) {
  if (store.has(key)) return { inserted: false, character: store.get(key) };
  const character = { id: store.size + 1, ...body, meta_data: body.meta_data ?? {} };
  store.set(key, character);
  return { inserted: true, character };
}
