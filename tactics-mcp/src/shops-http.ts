import type { IncomingMessage, ServerResponse } from "node:http";
import { searchFoundryShopItems, foundryShopLookupStatus } from "./foundry-shop-lookup.js";

import {
  addShopItem,
  createShop,
  createShopFolder,
  deleteShop,
  getPublishedShop,
  getShop,
  listShops,
  publishShop,
  removeShopItem,
  searchShopCatalog,
  setShopStock,
  unpublishShop,
  updateShop,
  updateShopItem,
  type ShopResult,
  type ShopSource,
} from "./shops.js";

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, mcp-protocol-version",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  });
  res.end(payload);
}

function statusOf(code: string) {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "NOT_FOUND") return 404;
  if (code === "VALIDATION_ERROR") return 400;
  return 500;
}

function reply(res: ServerResponse, result: ShopResult<unknown>, success = 200) {
  if (!result.ok) {
    send(res, statusOf(result.code), { error: result.message, code: result.code });
    return;
  }
  send(res, success, result.data);
}

function need(scopes: string[], scope: "read" | "write", res: ServerResponse) {
  if (scopes.includes(scope)) return true;
  send(res, 401, { error: `MCP token missing scope ${scope}.`, code: "AUTH_REQUIRED" });
  return false;
}

export function isShopApiPath(path: string) {
  return path === "/api/shops" || path.startsWith("/api/shops/");
}

export async function handleShopApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  userId: string,
  scopes: string[],
  body: Record<string, unknown> | undefined,
) {
  const parts = path.split("/").filter(Boolean);
  const method = req.method ?? "GET";
  const query = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;

  if (method === "GET" && path === "/api/shops") {
    if (!need(scopes, "read", res)) return;
    reply(res, await listShops(userId));
    return;
  }
  if (method === "GET" && path === "/api/shops/catalog") {
    if (!need(scopes, "read", res)) return;
    const source = query.get("source");
    const catalogSource = source === "wanderers-guide" || source === "pf2e" || source === "foundry" ? source : "both";
    reply(res, await searchShopCatalog(userId, query.get("q") ?? "", catalogSource));
    return;
  }
  if (method === "GET" && path === "/api/shops/foundry-lookup") {
    if (!need(scopes, "read", res)) return;
    const formulas = query.get("formulas") === "true";
    reply(res, { ok: true, data: { ...foundryShopLookupStatus(), ...searchFoundryShopItems(query.get("q") ?? "", Number(query.get("limit") ?? 50), formulas) } });
    return;
  }
  if (method === "GET" && parts[0] === "api" && parts[1] === "shops" && parts[2] === "public" && parts[3]) {
    if (!need(scopes, "read", res)) return;
    reply(res, await getPublishedShop(userId, parts[3]));
    return;
  }
  if (method === "POST" && path === "/api/shops") {
    if (!need(scopes, "write", res)) return;
    const name = typeof body?.name === "string" ? body.name : "";
    reply(res, await createShop(userId, { ...body, name } as Parameters<typeof createShop>[1]), 201);
    return;
  }
  if (method === "POST" && path === "/api/shops/folders") {
    if (!need(scopes, "write", res)) return;
    reply(res, await createShopFolder(userId, typeof body?.name === "string" ? body.name : ""), 201);
    return;
  }
  if (parts[0] !== "api" || parts[1] !== "shops" || !parts[2]) {
    send(res, 404, { error: "Not found" });
    return;
  }
  const shopId = parts[2];
  if (method === "GET" && parts.length === 3) {
    if (!need(scopes, "read", res)) return;
    reply(res, await getShop(userId, shopId));
    return;
  }
  if (method === "PATCH" && parts.length === 3) {
    if (!need(scopes, "write", res)) return;
    const parentId = body && Object.prototype.hasOwnProperty.call(body, "parentId")
      ? (body.parentId as string | null)
      : body && Object.prototype.hasOwnProperty.call(body, "parent")
        ? (body.parent as string | null)
        : undefined;
    reply(res, await updateShop(userId, shopId, { ...(body ?? {}), parentId }));
    return;
  }
  if (method === "DELETE" && parts.length === 3) {
    if (!need(scopes, "write", res)) return;
    reply(res, await deleteShop(userId, shopId));
    return;
  }
  if (method === "POST" && parts[3] === "stock") {
    if (!need(scopes, "write", res)) return;
    reply(res, await setShopStock(userId, shopId, body ?? {}));
    return;
  }
  if (method === "POST" && parts[3] === "items") {
    if (!need(scopes, "write", res)) return;
    reply(res, await addShopItem(userId, shopId, {
      source: body?.source as ShopSource,
      itemId: Number(body?.itemId ?? body?.id),
      quantity: body?.quantity as number | undefined,
      price: body?.price as string | undefined,
      formula: body?.formula as boolean | undefined,
      items: Array.isArray(body?.items) ? body.items as Parameters<typeof addShopItem>[2]["items"] : undefined,
    }), 201);
    return;
  }
  if (parts[3] === "items" && parts[4]) {
    const key = decodeURIComponent(parts.slice(4).join("/"));
    if (method === "PATCH") {
      if (!need(scopes, "write", res)) return;
      reply(res, await updateShopItem(userId, shopId, key, { quantity: body?.quantity as number | undefined, price: body?.price as string | undefined }));
      return;
    }
    if (method === "DELETE") {
      if (!need(scopes, "write", res)) return;
      reply(res, await removeShopItem(userId, shopId, key));
      return;
    }
  }
  if (parts[3] === "publish" && method === "POST") {
    if (!need(scopes, "write", res)) return;
    reply(res, await publishShop(userId, shopId));
    return;
  }
  if (parts[3] === "publish" && method === "DELETE") {
    if (!need(scopes, "write", res)) return;
    reply(res, await unpublishShop(userId, shopId));
    return;
  }
  send(res, 404, { error: "Not found" });
}
