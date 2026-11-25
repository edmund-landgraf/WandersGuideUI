import type { Encounter } from '@schemas/content';

export function encounterRevision(row: Pick<Encounter,'meta_data'>): number {
  const revision = row.meta_data?.encounter_revision;
  if (revision === undefined) return 0;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
    throw new Error('Encounter revision is invalid. Reload before saving.');
  return revision;
}
export type EncounterSavePatch = Partial<Pick<Encounter,'name'|'icon'|'color'|'campaign_id'|'combatants'|'meta_data'>>;
export function encounterSaveBody(row: Encounter, patch?: EncounterSavePatch) {
  return { encounter_id:row.id, encounter_revision:encounterRevision(row),
    patch:patch ?? {name:row.name,icon:row.icon,color:row.color,combatants:row.combatants,meta_data:row.meta_data} };
}
export function verifyEncounterSave(row: Encounter, response: unknown): Encounter {
  const saved = response as Encounter | null;
  if (!saved || saved.id !== row.id || encounterRevision(saved) !== encounterRevision(row)+1)
    throw new Error('Encounter save could not be confirmed. Reload before retrying.');
  return saved;
}
