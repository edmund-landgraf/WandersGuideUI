import type { Encounter } from '../../schemas/content';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function positiveId(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}
function verifyIds(ids: unknown[], count: unknown): ids is number[] {
  return Number.isSafeInteger(count) && count === ids.length &&
    ids.every((id,i) => positiveId(id) > 0 && (i === 0 || Number(id) > Number(ids[i-1])));
}

export function parseCopyEncounterManifest(value: unknown, campaignId: number): Encounter[] {
  const doc = record(value);
  if (!doc || doc.campaignId !== campaignId || !Array.isArray(doc.encounters) ||
      doc.encounters.some(row => {
        const r = record(row);
        return !r || r.campaign_id !== campaignId || typeof r.name !== 'string';
      }) || !verifyIds(doc.encounters.map(row => row.id),doc.encounterCount)) {
    throw new Error('Could not verify the complete campaign copy encounter list. Retry after updating the copy service.');
  }
  return doc.encounters as Encounter[];
}

export function parseCopyPreparation(value: unknown, campaignId: number): { assets: string[]; encounterIds: number[] } {
  const doc = record(value);
  if (!doc || doc.campaignId !== campaignId || !Array.isArray(doc.assets) ||
      doc.assets.some(ref => typeof ref !== 'string' || !ref.trim()) ||
      !Array.isArray(doc.encounterIds) || !verifyIds(doc.encounterIds,doc.encounterCount)) {
    throw new Error('Could not verify the complete campaign copy manifest. No campaign was created; retry after updating the copy service.');
  }
  return { assets: doc.assets as string[], encounterIds: doc.encounterIds };
}

export function validCopyReceipt(value: unknown, expectedCount?: number): boolean {
  const doc = record(value);
  return !!doc && positiveId(record(doc.created)?.id) > 0 &&
    Array.isArray(doc.encounterNames) && doc.encounterNames.every(name => typeof name === 'string') &&
    Number.isSafeInteger(doc.encounterCount) && doc.encounterCount === doc.encounterNames.length &&
    (expectedCount === undefined || doc.encounterCount === expectedCount);
}
