import { applyConditions } from '@conditions/condition-handler';
import { COMMON_CORE_ID } from '@constants/data';
import { fetchContentPackage, fetchContentSources, getDefaultSources } from '@content/content-store';
import { executeOperations } from '@operations/operations.main';
import type { Character, Combatant, ContentPackage, Creature } from '@schemas/content';
import { cloneDeep, uniq } from 'lodash-es';

export type Phase1EntityCombatant = Combatant & { data: Character | Creature };
export type PreparedPhase1Entity = {
  entity: Character | Creature;
  content: ContentPackage;
  storeId: string;
  kind: 'CHARACTER' | 'CREATURE';
};

export async function preparePhase1Entity(combatant: Phase1EntityCombatant): Promise<PreparedPhase1Entity> {
  if (combatant.type === 'CHARACTER') {
    const character = cloneDeep(combatant.data as Character);
    if (!character.user_id || !character.created_at) throw new Error('Full character details are unavailable.');
    const sources = uniq([COMMON_CORE_ID, ...(character.content_sources?.enabled ?? [])]);
    await fetchContentSources(sources);
    const content = await fetchContentPackage(sources, { fetchSources: true, fetchCreatures: false });
    await executeOperations({
      type: 'CHARACTER',
      data: { character, content, context: 'CHARACTER-SHEET' },
    }, { directExecution: true });
    applyConditions('CHARACTER', character.details?.conditions ?? []);
    return { entity: character, content, storeId: 'CHARACTER', kind: 'CHARACTER' };
  }

  const creature = cloneDeep(combatant.data as Creature);
  const storeId = `CREATURE_${combatant._id}`;
  const content = await fetchContentPackage(getDefaultSources('PAGE'), {
    fetchSources: false,
    fetchCreatures: false,
  });
  await executeOperations({
    type: 'CREATURE',
    data: { id: storeId, creature, content },
  }, { directExecution: true });
  applyConditions(storeId, creature.details?.conditions ?? []);
  return { entity: creature, content, storeId, kind: 'CREATURE' };
}
