import type { TacticsSnapshot } from './tactics-types';

export const EXPORT_URL_KEY = 'wgui-tactics-export-url';

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
