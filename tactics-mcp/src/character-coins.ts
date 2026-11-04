import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { fail, loadRow, ownerGuard, saveRow, textResult } from "./character-catalog.js";
import type { CharacterRow } from "./character-client.js";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

export const DENOMINATIONS = ["cp", "sp", "gp", "pp"] as const;
export type Denomination = (typeof DENOMINATIONS)[number];
export type Coins = Record<Denomination, number>;

/** PF2e: 1 pp = 10 gp = 100 sp = 1000 cp. */
export const COPPER_VALUE: Record<Denomination, number> = { cp: 1, sp: 10, gp: 100, pp: 1000 };

const coinCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const coinObject = z
  .object({
    cp: coinCount.optional(),
    sp: coinCount.optional(),
    gp: coinCount.optional(),
    pp: coinCount.optional(),
  })
  .strict();

const amountSchema = z.union([coinObject, z.string().min(1)]);

export function emptyCoins(): Coins {
  return { cp: 0, sp: 0, gp: 0, pp: 0 };
}

export function copperValue(coins: Coins) {
  return DENOMINATIONS.reduce((sum, denom) => sum + coins[denom] * COPPER_VALUE[denom], 0);
}

export function normalizeCoins(amount: Coins): Coins {
  let left = copperValue(amount);
  const out = emptyCoins();
  for (const denom of ["pp", "gp", "sp", "cp"] as const) {
    out[denom] = Math.floor(left / COPPER_VALUE[denom]);
    left -= out[denom] * COPPER_VALUE[denom];
  }
  return out;
}

export function parseCoinAmount(input: string | Partial<Coins>): { ok: true; coins: Coins } | { ok: false; message: string } {
  const coins = emptyCoins();
  if (typeof input === "string") {
    const text = input.trim();
    const matches = [...text.matchAll(/(\d+)\s*(cp|sp|gp|pp)\b/gi)];
    if (matches.length === 0) return { ok: false, message: 'Amount must look like "5 gp" or "1000000 cp".' };
    let rest = text;
    for (const match of matches) rest = rest.replace(match[0], " ");
    if (/[^\s,]/.test(rest)) return { ok: false, message: "Amount has text that is not a coin denomination." };
    for (const match of matches) {
      const count = Number(match[1]);
      const denom = match[2].toLowerCase() as Denomination;
      if (!Number.isSafeInteger(count) || coins[denom] > Number.MAX_SAFE_INTEGER - count) {
        return { ok: false, message: "Amount is too large." };
      }
      coins[denom] += count;
    }
  } else {
    for (const denom of DENOMINATIONS) {
      const count = input[denom];
      if (count === undefined) continue;
      if (!Number.isSafeInteger(count) || count < 0) return { ok: false, message: "Coin counts must be non-negative integers." };
      coins[denom] = count;
    }
  }
  if (copperValue(coins) === 0) return { ok: false, message: "Amount must be greater than zero." };
  if (!Number.isSafeInteger(copperValue(coins))) return { ok: false, message: "Amount is too large." };
  return { ok: true, coins };
}

function breakOneHigher(purse: Coins, index: number) {
  for (let higher = index + 1; higher < DENOMINATIONS.length; higher += 1) {
    const denom = DENOMINATIONS[higher];
    if (purse[denom] <= 0) continue;
    purse[denom] -= 1;
    purse[DENOMINATIONS[higher - 1]] += 10;
    return true;
  }
  return false;
}

function consolidateOne(purse: Coins, index: number): boolean {
  if (index === 0) return false;
  const lower = DENOMINATIONS[index - 1];
  while (purse[lower] < 10) {
    if (!consolidateOne(purse, index - 1)) return false;
  }
  purse[lower] -= 10;
  purse[DENOMINATIONS[index]] += 1;
  return true;
}

export function takeCoins(purse: Coins, amount: Coins): { ok: true; coins: Coins } | { ok: false; code: "INSUFFICIENT_FUNDS" } {
  if (copperValue(purse) < copperValue(amount)) return { ok: false, code: "INSUFFICIENT_FUNDS" };
  const next = { ...purse };
  for (let index = 0; index < DENOMINATIONS.length; index += 1) {
    const denom = DENOMINATIONS[index];
    while (next[denom] < amount[denom]) {
      if (!breakOneHigher(next, index) && !consolidateOne(next, index)) return { ok: false, code: "INSUFFICIENT_FUNDS" };
    }
    next[denom] -= amount[denom];
  }
  return { ok: true, coins: next };
}

export function giveCoins(purse: Coins, amount: Coins, normalize: boolean): { ok: true; coins: Coins } | { ok: false; message: string } {
  const next = emptyCoins();
  for (const denom of DENOMINATIONS) {
    const sum = purse[denom] + amount[denom];
    if (!Number.isSafeInteger(sum)) return { ok: false, message: "The purse would overflow." };
    next[denom] = sum;
  }
  if (!Number.isSafeInteger(copperValue(next))) return { ok: false, message: "The purse would overflow." };
  return { ok: true, coins: normalize ? normalizeCoins(next) : next };
}

function readPurse(row: CharacterRow): { ok: true; inventory: Record<string, unknown>; coins: Coins } | { ok: false; message: string } {
  const inventory = row.inventory && typeof row.inventory === "object" && !Array.isArray(row.inventory)
    ? { ...(row.inventory as Record<string, unknown>) }
    : {};
  const raw = inventory.coins;
  const coins = emptyCoins();
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "inventory.coins is not an object." };
    const record = raw as Record<string, unknown>;
    for (const denom of DENOMINATIONS) {
      const count = record[denom];
      if (count === undefined || count === null) continue;
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
        return { ok: false, message: `inventory.coins.${denom} is not a non-negative integer.` };
      }
      coins[denom] = count;
    }
  }
  return { ok: true, inventory, coins };
}

function pursePayload(before: Coins, after: Coins, amount: Coins, normalized: boolean) {
  return {
    before,
    after,
    amount,
    normalized,
    copperBefore: copperValue(before),
    copperAfter: copperValue(after),
  };
}

export function registerCharacterCoins(server: McpServer, userId: () => string) {
  server.registerTool(
    "convert_coins",
    {
      title: "Convert PF2e coins",
      description:
        'Normalizes a coin amount at PF2e rates (1 pp = 10 gp = 100 sp = 1000 cp). Read-only: it does not load or change a character. amount is {cp, sp, gp, pp} (any subset) or a string such as "1000000 cp" or "5 gp, 3 sp". 1000000 cp becomes 1000 pp; 1234 cp becomes 1 pp, 2 gp, 3 sp, 4 cp.',
      annotations: readOnly,
      inputSchema: { amount: amountSchema },
    },
    async (args) => {
      const parsed = parseCoinAmount(args.amount);
      if (!parsed.ok) return textResult(parsed.message, { code: "VALIDATION_ERROR", retryable: false }, true);
      const coins = normalizeCoins(parsed.coins);
      return textResult(`${coins.pp} pp, ${coins.gp} gp, ${coins.sp} sp, ${coins.cp} cp`, {
        coins,
        input: parsed.coins,
        copper: copperValue(parsed.coins),
      });
    },
  );

  server.registerTool(
    "give_money",
    {
      title: "Give coins",
      description:
        'Adds coins to inventory.coins ({cp, sp, gp, pp}) on a character the caller owns, via find-character and update-character. amount is {cp, sp, gp, pp} or a string such as "1000000 cp" or "5 gp, 3 sp". By default each denomination is added as given. normalize:true rebalances the purse afterward (1000000 cp becomes 1000 pp). Returns the purse before and after.',
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        amount: amountSchema,
        normalize: z.boolean().optional(),
      },
    },
    async (args) => {
      const parsed = parseCoinAmount(args.amount);
      if (!parsed.ok) return textResult(parsed.message, { code: "VALIDATION_ERROR", retryable: false }, true);
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const forbidden = ownerGuard(loaded.data, userId());
      if (forbidden) return fail(forbidden);
      const purse = readPurse(loaded.data);
      if (!purse.ok) return textResult(purse.message, { code: "VALIDATION_ERROR", retryable: false }, true);
      const normalize = Boolean(args.normalize);
      const given = giveCoins(purse.coins, parsed.coins, normalize);
      if (!given.ok) return textResult(given.message, { code: "VALIDATION_ERROR", retryable: false }, true);
      const saved = await saveRow(userId(), loaded.data, { inventory: { ...purse.inventory, coins: given.coins } });
      if (!saved.ok) return fail(saved);
      return textResult("Coins added", { characterId: args.characterId, ...pursePayload(purse.coins, given.coins, parsed.coins, normalize) });
    },
  );

  server.registerTool(
    "take_money",
    {
      title: "Take coins",
      description:
        'Removes coins from inventory.coins on a character the caller owns. amount is {cp, sp, gp, pp} or a string such as "5 gp, 3 sp". A short denomination is paid by breaking higher coins (1 pp = 10 gp = 100 sp = 1000 cp); lower coins are spent only when no higher coin can be broken. Refuses with INSUFFICIENT_FUNDS when the purse\'s total value is too small, and never stores a negative count. Returns the purse before and after.',
      annotations: writes,
      inputSchema: {
        characterId: z.number().int(),
        amount: amountSchema,
      },
    },
    async (args) => {
      const parsed = parseCoinAmount(args.amount);
      if (!parsed.ok) return textResult(parsed.message, { code: "VALIDATION_ERROR", retryable: false }, true);
      const loaded = await loadRow(userId(), args.characterId);
      if (!loaded.ok) return fail(loaded);
      const forbidden = ownerGuard(loaded.data, userId());
      if (forbidden) return fail(forbidden);
      const purse = readPurse(loaded.data);
      if (!purse.ok) return textResult(purse.message, { code: "VALIDATION_ERROR", retryable: false }, true);
      const taken = takeCoins(purse.coins, parsed.coins);
      if (!taken.ok) {
        return textResult("Not enough coins.", {
          code: "INSUFFICIENT_FUNDS",
          retryable: false,
          characterId: args.characterId,
          before: purse.coins,
          amount: parsed.coins,
          copperBefore: copperValue(purse.coins),
          copperNeeded: copperValue(parsed.coins),
        }, true);
      }
      const saved = await saveRow(userId(), loaded.data, { inventory: { ...purse.inventory, coins: taken.coins } });
      if (!saved.ok) return fail(saved);
      return textResult("Coins removed", { characterId: args.characterId, ...pursePayload(purse.coins, taken.coins, parsed.coins, false) });
    },
  );
}
