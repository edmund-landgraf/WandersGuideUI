import type { TacticsSnapshot } from './tactics-types';

export const EXPORT_URL_KEY = 'wgui-tactics-export-url';
export const MCP_URL_KEY = 'wgui-tactics-mcp-url';
export const MCP_TOKEN_KEY = 'wgui-tactics-mcp-token';
export const DEFAULT_MCP_COMBAT_URL = 'http://127.0.0.1:3104/combat';

export function readExportUrl(): string | null {
  try {
    const url = localStorage.getItem(EXPORT_URL_KEY)?.trim();
    return url || null;
  } catch {
    return null;
  }
}

export async function postSnapshot(snapshot: TacticsSnapshot): Promise<void> {
  const url = readExportUrl();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
  } catch {
    // Buttons still show when the export post fails.
  }
}

export async function postChoice(body: {
  snapshotId: string;
  combatantId: string;
  choiceText: string;
  source: 'menu' | 'custom-design' | 'already-did';
}): Promise<void> {
  const url = readExportUrl();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Selection still stands when the export post fails.
  }
}

export function readMcpCombatTarget(): { url: string; token: string } | null {
  try {
    const token = localStorage.getItem(MCP_TOKEN_KEY)?.trim();
    if (!token) return null;
    const url = localStorage.getItem(MCP_URL_KEY)?.trim() || DEFAULT_MCP_COMBAT_URL;
    return { url, token };
  } catch {
    return null;
  }
}

export async function postCombatSnapshot(snapshot: TacticsSnapshot): Promise<void> {
  const target = readMcpCombatTarget();
  if (!target) return;
  try {
    await fetch(target.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${target.token}`,
      },
      body: JSON.stringify(snapshot),
    });
  } catch {
    // The encounter stays usable when the tactics MCP is down.
  }
}
