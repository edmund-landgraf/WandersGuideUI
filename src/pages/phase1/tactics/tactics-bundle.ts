import type { Character, Combatant, Condition, Creature, Encounter, LivingEntity } from '@schemas/content';
import { phase1Request, loadPhase1CampaignEncounters, loadPhase1CampaignPlayers, numericId } from '../phase1-api';
import { loadEntityAbilities } from '../phase1-abilities';
import { calculateEntityStatus } from '../phase1-stats';
import { skillCatalogFromContent } from '../phase1-skills';
import { preparePhase1Entity, type Phase1EntityCombatant } from '../phase1-entity';
import { parseAbility } from './tactics-parse';
import type { TacticsAbility, TacticsCombatant } from './tactics-types';

function isHazard(combatant: Combatant) {
  return combatant.type === 'HAZARD';
}

function livingEnemy(combatant: { ally?: boolean | null; data?: { hp_current?: number | null } | null }) {
  if (combatant.ally === true) return false;
  const hp = combatant.data?.hp_current;
  if (hp == null) return true;
  return hp > 0;
}

function conditionParts(conditions: Condition[] | null | undefined) {
  return (conditions ?? []).map((condition) => ({
    name: condition.name,
    value: condition.value ?? undefined,
  }));
}

function resolveData(combatant: Combatant, players: Character[]): LivingEntity | undefined {
  if (combatant.type === 'CHARACTER') {
    const id = numericId(combatant.character);
    return players.find((player) => numericId(player.id) === id) ?? (combatant.data as LivingEntity | undefined);
  }
  return (combatant.creature as Creature | undefined) ?? (combatant.data as LivingEntity | undefined);
}

function initiativeOf(encounter: Encounter, id: string) {
  const combatant = encounter.combatants?.list?.find((item) => item._id === id);
  return combatant?.initiative ?? -999;
}

export async function loadTacticsBundle(campaignId: number, encounterId: number, userId: string) {
  const encounters = campaignId > 0
    ? await loadPhase1CampaignEncounters(campaignId)
    : await phase1Request<Encounter[]>('find-encounter', { user_id: userId });
  const encounter = (encounters ?? []).find((item) => item.id === encounterId);
  if (!encounter) throw new Error('Encounter not found.');
  const players = campaignId > 0 ? await loadPhase1CampaignPlayers(campaignId, userId) : await phase1Request<Character[]>('find-character', { user_id: userId });
  const combatants: TacticsCombatant[] = [];
  let catalog: TacticsAbility[] = [];
  for (const combatant of encounter.combatants?.list ?? []) {
    if (isHazard(combatant)) continue;
    const data = resolveData(combatant, players ?? []);
    if (!data) continue;
    const prepared = { ...combatant, data } as Phase1EntityCombatant;
    const [status, abilities, content] = await Promise.all([
      calculateEntityStatus(prepared),
      loadEntityAbilities(prepared),
      catalog.length ? Promise.resolve(null) : preparePhase1Entity(prepared).then((loaded) => loaded.content),
    ]);
    if (content && !catalog.length) {
      catalog = skillCatalogFromContent(content)
        .filter((ability) => !ability.traitNames.some((trait) => trait === 'Exploration' || trait === 'Downtime'))
        .map((ability) =>
          parseAbility({
            id: ability.id,
            name: ability.name,
            actions: ability.actions,
            traits: ability.traitNames,
            frequency: ability.frequency,
            description: ability.description,
          }),
        );
    }
    const hp = data.hp_current ?? status.maxHp;
    combatants.push({
      id: combatant._id,
      name: data.name,
      side: combatant.ally === true || combatant.type === 'CHARACTER' ? 'ally' : 'enemy',
      level: data.level,
      hpCurrent: hp,
      hpMax: status.maxHp || hp,
      ac: status.ac,
      conditions: conditionParts(data.details?.conditions),
      perception: status.perception,
      fortitude: status.fortitude,
      reflex: status.reflex,
      will: status.will,
      speedFeet: status.speed,
      description:
        data.details && 'description' in data.details && typeof data.details.description === 'string'
          ? data.details.description
          : undefined,
      abilities: abilities.map((ability) =>
        parseAbility({
          id: ability.id,
          name: ability.name,
          actions: ability.actions,
          traits: ability.traitNames,
          frequency: ability.frequency,
          description: ability.description,
        })
      ),
    });
  }
  const enemies = combatants.filter((combatant) => livingEnemy({ ally: combatant.side === 'ally', data: { hp_current: combatant.hpCurrent } }));
  enemies.sort((a, b) => initiativeOf(encounter, b.id) - initiativeOf(encounter, a.id));
  return { round: Math.max(1, encounter.meta_data?.initiative_log?.length ?? 1), combatants, enemies, catalog };
}
