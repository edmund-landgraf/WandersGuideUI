import assert from "node:assert/strict";
import { test } from "node:test";
import { creatureLookupWarning, preferLatestCreatures } from "../src/homebrew-catalog.js";

const row = (id: number, name: string, book: string, deprecated = false) => ({
  id, name, deprecated, meta_data: { source: { book } },
});

test("exact name matches rank Monster Core 2 above legacy even with interleaved results", () => {
  const legacy = row(10975, "Ember Fox", "Bestiary 2");
  const latest = row(1, "Ember Fox", "Monster Core 2");
  const other = row(20, "Ember Fox Familiar", "Monster Core 2");
  const original = [other, legacy, latest];
  const ranked = preferLatestCreatures(original, new Map(), "ember fox");
  assert.deepEqual(ranked, [latest, legacy, other]);
  assert.deepEqual(original, [other, legacy, latest]);
  assert.equal(creatureLookupWarning(ranked, new Map(), "Ember Fox"), undefined);
});

test("legacy-only, deprecated-only and missing exact matches are disclosed", () => {
  const legacy = row(10975, "Ember Fox", "Bestiary 2");
  const deprecated = row(99, "Ember Fox", "Monster Core 2", true);
  const ranked = preferLatestCreatures([deprecated, legacy], new Map(), "Ember Fox");
  assert.equal(ranked[0], legacy);
  assert.match(creatureLookupWarning(ranked, new Map(), "Ember Fox") ?? "", /Legacy catalog fallback/);
  assert.match(creatureLookupWarning([deprecated], new Map(), "Ember Fox") ?? "", /No active exact-name/);
  assert.match(creatureLookupWarning([legacy], new Map(), "Electric Eel") ?? "", /No active exact-name/);
});
