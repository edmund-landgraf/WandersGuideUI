import { invokeFunction } from "./character-client.js";

const token = process.env.WG_ACCESS_TOKEN?.trim();
if (!token) {
  console.error("WG_ACCESS_TOKEN is not set. Skipping the live character smoke.");
  process.exit(0);
}

const stamp = Date.now();
const name = `mcp-smoke-${stamp}`;
const created = await invokeFunction("smoke", "create-character", {
  name,
  level: 1,
  meta_data: { reset_hp: true },
  details: {},
});
if (!created.ok) throw new Error(created.message);
const row = created.data as { id?: number; updated_at?: string; name?: string };
if (typeof row.id !== "number") throw new Error("create-character did not return an id.");

const found = await invokeFunction("smoke", "find-character", { id: row.id });
if (!found.ok) throw new Error(found.message);
const loaded = found.data as { name?: string; updated_at?: string };
if (loaded.name !== name) throw new Error(`find-character returned ${String(loaded.name)}`);

const renamed = `${name}-renamed`;
const updated = await invokeFunction("smoke", "update-character", {
  id: row.id,
  name: renamed,
  ...(loaded.updated_at ? { expected_updated_at: loaded.updated_at } : {}),
});
if (!updated.ok) throw new Error(updated.message);

const again = await invokeFunction("smoke", "find-character", { id: row.id });
if (!again.ok) throw new Error(again.message);
const after = again.data as { name?: string };
if (after.name !== renamed) throw new Error(`update did not stick: ${String(after.name)}`);

const deleted = await invokeFunction("smoke", "delete-content", { id: row.id, type: "character" });
if (!deleted.ok) throw new Error(deleted.message);
console.error(`character smoke created, renamed, and deleted ${row.id}`);
