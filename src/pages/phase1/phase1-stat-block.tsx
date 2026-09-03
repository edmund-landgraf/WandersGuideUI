import { compiledConditions } from '@conditions/condition-handler';
import { parseIconValue } from '@common/IconDisplay';
import { getWeaponStats, parseOtherDamage } from '@items/weapon-handler';
import { isItemRangedWeapon, isItemWeapon } from '@items/inv-utils';
import {
  AbilityBlock,
  AbilityBlockType,
  ContentType,
  Creature,
  InventoryItem,
  Item,
  LivingEntity,
  SenseWithRange,
  Trait,
} from '@schemas/content';
import { convertToSize } from '@upload/foundry-utils';
import { actionCostToRichTextInsert } from '@utils/actions';
import { findCreatureTraits } from '@utils/creature';
import { getEntityLevel } from '@utils/entity-utils';
import { getDcForLevel, rankNumber, sign } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { isCharacter, isCreature, isTruthy } from '@utils/type-fixing';
import { compactLabels } from '@variables/variable-utils';
import { flatten, groupBy } from 'lodash-es';
import { getJsonV4Content } from '@export/json/json-v4';
import { useContentLinks } from './phase1-content-links';
import { ProseMarkdown } from './phase1-markdown';

function withActionGlyphs(md: string) {
  return md
    .replace(/`action_symbol_1`/g, '◆')
    .replace(/`action_symbol_2`/g, '◆◆')
    .replace(/`action_symbol_3`/g, '◆◆◆')
    .replace(/`action_symbol_4`/g, '◇')
    .replace(/`action_symbol_5`/g, '↩');
}

function Line({ children }: { children: string }) {
  if (!children.trim()) return null;
  return <ProseMarkdown className='stat-block-line'>{withActionGlyphs(children)}</ProseMarkdown>;
}

function LabelLine({ label, children }: { label: string; children: string }) {
  return <Line>{`**${label}** ${children}`}</Line>;
}

export function Phase1StatBlockView({ entity, data }: { entity: LivingEntity; data: Awaited<ReturnType<typeof getJsonV4Content>> }) {

  const linkContent = (text: string, type: ContentType | AbilityBlockType, record: { id?: number } | null | undefined) => {
    if (record && record.id && `${record.id}`.length < 10) {
      return `[${text}](link_${type}_${record.id})`;
    }
    return text;
  };

  const stringifySenses = (senses: { precise: SenseWithRange[]; imprecise: SenseWithRange[]; vague: SenseWithRange[] }) => {
    const format = (list: SenseWithRange[]) =>
      list
        .map((sense) =>
          `${linkContent(sense.senseName.toLowerCase(), 'sense', sense.sense)} ${sense.range.trim() ? `(${sense.range} ft.)` : ''}`.trim()
        )
        .join(', ');
    const parts: string[] = [];
    const precise = format(senses.precise);
    const imprecise = format(senses.imprecise);
    const vague = format(senses.vague);
    if (precise) parts.push(`precise: ${precise}`);
    if (imprecise) parts.push(`imprecise: ${imprecise}`);
    if (vague) parts.push(`vague: ${vague}`);
    return parts.join('; ');
  };

  const getArmorShieldDisplay = (armor: InventoryItem | null, shield: InventoryItem | null) => {
    if (!armor && !shield) return '';
    const str = [
      armor ? linkContent(armor.item.name.toLowerCase(), 'item', armor.item) : undefined,
      shield
        ? `${linkContent(shield.item.name.toLowerCase(), 'item', shield.item)}, ${sign(shield.item.meta_data?.ac_bonus ?? 0)}, hp: ${shield.item.meta_data?.hp ?? 0} / ${shield.item.meta_data?.hp_max ?? 0}`
        : undefined,
    ]
      .filter(isTruthy)
      .join('; ');
    return str ? `(${str})` : '';
  };

  const getResistWeaksDisplay = (rw: { resists: string[]; weaks: string[]; immunes: string[] }) => {
    const str = [
      rw.immunes.length > 0 ? `**Immunities** ${rw.immunes.join(', ').toLowerCase()}` : undefined,
      rw.resists.length > 0 ? `**Resistances** ${rw.resists.join(', ').toLowerCase()}` : undefined,
      rw.weaks.length > 0 ? `**Weaknesses** ${rw.weaks.join(', ').toLowerCase()}` : undefined,
    ]
      .filter(isTruthy)
      .join('; ');
    return str ? `; ${str}` : '';
  };

  const getAbilityDisplay = (ab: AbilityBlock) => {
    const traitsStr = (ab.traits ?? [])
      .map((id) => data.all_traits.find((t) => id === t.id))
      .filter(isTruthy)
      .map((t) => linkContent(t.name.toLowerCase(), 'trait', t))
      .join(', ')
      .trim();
    const parts = [
      ab.frequency ? `**Frequency** ${ab.frequency}` : undefined,
      ab.cost ? `**Cost** ${ab.cost}` : undefined,
      ab.trigger ? `**Trigger** ${ab.trigger}` : undefined,
      ab.requirements ? `**Requirements** ${ab.requirements}` : undefined,
    ].filter(isTruthy);
    const specialStr = ab.special ? `\n\n&nbsp;&nbsp; **Special** ${ab.special}` : '';
    return `**${ab.name}** ${actionCostToRichTextInsert(ab.actions ?? '')} ${traitsStr ? `(${traitsStr})` : ''} ${parts.join(' ')} ${parts.length > 0 ? '**Effect**' : ''}\n\n${ab.description}${specialStr}`;
  };

  const getWeaponDisplay = (weapon: { item: Item; stats: ReturnType<typeof getWeaponStats> }) => {
    const traits = (weapon.item.traits ?? [])
      .map((id) => data.all_traits.find((t) => id === t.id))
      .filter(isTruthy)
      .map((t) => linkContent(t.name.toLowerCase(), 'trait', t));
    if (isItemRangedWeapon(weapon.item)) {
      if (weapon.item.meta_data?.range) traits.push(`range increment ${weapon.item.meta_data.range} ft.`);
      if (weapon.item.meta_data?.reload) traits.push(`reload ${weapon.item.meta_data.reload.replace(/reload/i, '').trim()}`);
    }
    const traitsStr = traits.join(', ').trim();
    const damageBonus = weapon.stats.damage.bonus.total > 0 ? ` + ${weapon.stats.damage.bonus.total}` : '';
    return `**${isItemRangedWeapon(weapon.item) ? 'Ranged' : 'Melee'}** ${actionCostToRichTextInsert('ONE-ACTION')} ${linkContent(weapon.item.name.toLowerCase(), 'item', weapon.item)} ${sign(weapon.stats.attack_bonus.total[0])} / ${sign(weapon.stats.attack_bonus.total[1])} / ${sign(weapon.stats.attack_bonus.total[2])} ${traitsStr ? `(${traitsStr})` : ''}, **Damage** ${weapon.stats.damage.dice}${weapon.stats.damage.die}${damageBonus} ${weapon.stats.damage.damageType}${parseOtherDamage(weapon.stats.damage.other).join('')}${weapon.stats.damage.extra ? ` + ${weapon.stats.damage.extra}` : ''}`;
  };

  const getInnateSpellsDisplay = () => {
    const spellAttack = data.proficiencies['INNATE_SPELL_ATTACK'].total;
    const spellDc = parseInt(data.proficiencies['INNATE_SPELL_DC'].total);
    const spellsDict = groupBy(data.innate_spells, (s) => s.tradition);
    return Object.entries(spellsDict).map(([tradition, spells]) => {
      const spellsRankDict = groupBy(spells, (s) => s.rank);
      return `**${toLabel(tradition)} Innate Spells** DC ${spellDc}, attack ${sign(spellAttack)}; ${Object.entries(spellsRankDict)
        .sort(([ar], [br]) => parseInt(br) - parseInt(ar))
        .map(
          ([rank, rankSpells]) =>
            `**${rankNumber(parseInt(rank), `Cantrips (${rankNumber(Math.ceil(getEntityLevel(entity) / 2))})`)}** ${rankSpells
              .map((s) => {
                const spellLink = linkContent(s.spell.name.toLowerCase(), 'spell', s.spell);
                return s.casts_max > 1 ? `${spellLink} (${s.casts_current}/${s.casts_max})` : spellLink;
              })
              .join(', ')}`
        )
        .join('; ')}`;
    });
  };

  const getSpontaneousSpellsDisplay = () => {
    const spontSources = data.spell_sources.filter((s) => s.source.type.startsWith('SPONTANEOUS-'));
    const spellsDict = groupBy(spontSources, (s) => s.source.tradition);
    return Object.entries(spellsDict).map(([tradition, d]) => {
      const spellAttack = d[0].stats.spell_attack.total[0];
      const spellDc = d[0].stats.spell_dc.total;
      const sources = d.map((s) => s.source.name);
      const spells = data.spell_raw_data.list.filter((s) => sources.includes(s.source));
      const spellsRankDict = groupBy(spells, (s) => s.rank);
      return `**${toLabel(tradition)} Spontaneous Spells** DC ${spellDc}, attack ${sign(spellAttack)}; ${Object.entries(spellsRankDict)
        .sort(([ar], [br]) => parseInt(br) - parseInt(ar))
        .map(([rank, rankSpells]) => {
          const slots = data.spell_slots.filter((slot) => sources.includes(slot.source) && slot.rank === parseInt(rank));
          const remainingSlots = slots.filter((s) => s.exhausted !== true);
          const slotsStr =
            parseInt(rank) > 0
              ? ` (${slots.length === remainingSlots.length ? `${slots.length}` : `${remainingSlots.length}/${slots.length}`} ${slots.length > 1 ? 'slots' : 'slot'})`
              : '';
          return `**${rankNumber(parseInt(rank), `Cantrips (${rankNumber(Math.ceil(getEntityLevel(entity) / 2))})`)}**${slotsStr} ${rankSpells
            .map((s) => {
              const spellData = data.spells.all.find((_s) => _s.id === s.spell_id);
              return spellData ? linkContent(spellData.name.toLowerCase(), 'spell', spellData) : '';
            })
            .filter((s) => s !== '')
            .join(', ')}`;
        })
        .join('; ')}`;
    });
  };

  const getPreparedSpellsDisplay = () => {
    const preparedSources = data.spell_sources.filter((s) => s.source.type.startsWith('PREPARED-'));
    const spellsDict = groupBy(preparedSources, (s) => s.source.tradition);
    return Object.entries(spellsDict).map(([tradition, d]) => {
      const spellAttack = d[0].stats.spell_attack.total[0];
      const spellDc = d[0].stats.spell_dc.total;
      const sources = d.map((s) => s.source.name);
      const slots = data.spell_slots.filter((s) => sources.includes(s.source));
      const spellsRankDict = groupBy(slots, (s) => s.rank);
      return `**${toLabel(tradition)} Prepared Spells** DC ${spellDc}, attack ${sign(spellAttack)}; ${Object.entries(spellsRankDict)
        .sort(([ar], [br]) => parseInt(br) - parseInt(ar))
        .map(
          ([rank, spellsData]) =>
            `**${rankNumber(parseInt(rank), `Cantrips (${rankNumber(Math.ceil(getEntityLevel(entity) / 2))})`)}** ${spellsData
              .map((s) => {
                if (!s.spell) return '';
                const linkStr = linkContent(s.spell.name.toLowerCase(), 'spell', s.spell);
                return s.exhausted ? `~~${linkStr}~~` : linkStr;
              })
              .filter((s) => s !== '')
              .join(', ')}`
        )
        .join('; ')}`;
    });
  };

  const getFocusSpellsDisplay = () => {
    const spellsDict = groupBy(data.focus_spells, (s) => s.casting_source);
    return Object.entries(spellsDict).map(([source, spells]) => {
      const sourceData = data.spell_sources.find((s) => s.source.name === source);
      const spellAttack = sourceData?.stats.spell_attack.total[0] ?? 0;
      const spellDc = sourceData?.stats.spell_dc.total ?? 0;
      const spellsRankDict = groupBy(spells, (s) => s.rank);
      const maxPoints = spells.filter((s) => s.rank > 0).length;
      const currentPoints = entity.spells?.focus_point_current ?? maxPoints;
      return `**${toLabel(source)} Focus Spells** DC ${spellDc}, attack ${sign(spellAttack)}, ${`${maxPoints === currentPoints ? `${maxPoints}` : `${currentPoints}/${maxPoints}`} ${maxPoints > 1 ? 'focus points' : 'focus point'}`}; ${Object.entries(spellsRankDict)
        .sort(([ar], [br]) => parseInt(br) - parseInt(ar))
        .map(
          ([rank, rankSpells]) =>
            `**${rankNumber(parseInt(rank), `Cantrips (${rankNumber(Math.ceil(getEntityLevel(entity) / 2))})`)}** ${rankSpells
              .map((s) => linkContent(s.name.toLowerCase(), 'spell', s))
              .join(', ')}`
        )
        .join('; ')}`;
    });
  };

  const getRitualSpellsDisplay = () => {
    if (data.spells.rituals.length === 0) return null;
    const spellsRankDict = groupBy(data.spells.rituals, (s) => s.rank);
    return `**Rituals** — ${Object.entries(spellsRankDict)
      .sort(([ar], [br]) => parseInt(br) - parseInt(ar))
      .map(
        ([rank, spells]) =>
          `**${rankNumber(parseInt(rank))}** ${spells.map((s) => linkContent(s.name.toLowerCase(), 'spell', s)).join(', ')}`
      )
      .join('; ')}`;
  };

  const abilities = flatten(Object.values(data.feats_features));
  const attrLine = Object.keys(data.attributes)
    .map((l) => {
      const val = data.attributes[l].partial ? `_${sign(data.attributes[l].value)}_` : sign(data.attributes[l].value);
      return `**${compactLabels(toLabel(l))}** ${val}`;
    })
    .join(', ');

  const icon = parseIconValue(entity.details?.image_url ?? '');
  const imageUrl = icon.type === 'image' && icon.value ? icon.value : '';
  const isPreformattedDescription = isCreature(entity) && entity.details.description?.includes('**');
  const sizeLabel = toLabel(convertToSize(data.size));

  return (
    <article className='relative flex flex-col gap-1.5 pb-8 text-p1-text'>
      <header className='flex items-baseline justify-between gap-4 border-b border-p1-border pb-1'>
        <h1 className='text-2xl font-semibold'>{toLabel(entity.name)}</h1>
        <p className='shrink-0 text-sm text-p1-muted'>
          {isCharacter(entity) ? 'Character' : 'Creature'} {getEntityLevel(entity)}
        </p>
      </header>
      <div className={imageUrl ? 'pr-[132px]' : undefined}>
        <TraitRow
          traitIds={data.character_traits.map((trait) => trait.id)}
          traits={data.all_traits}
          rarity={isCreature(entity) ? entity.rarity : undefined}
          size={sizeLabel}
        />
      </div>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=''
          className='absolute right-0 top-12 h-[120px] w-[120px] object-contain'
        />
      ) : null}
      {isCreature(entity) && <RecallKnowledgeLine entity={entity} traits={data.all_traits} />}
      <LabelLine label='Perception'>{`${data.proficiencies['PERCEPTION'].total}; ${stringifySenses(data.senses)}`}</LabelLine>
      {data.languages.length > 0 && (
        <LabelLine label='Languages'>{data.languages.map((l) => toLabel(l)).join(', ')}</LabelLine>
      )}
      <LabelLine label='Skills'>
        {Object.keys(data.proficiencies)
          .filter((name) => name.startsWith('SKILL_') && name !== 'SKILL_LORE____')
          .map((l) => `${toLabel(l)} ${data.proficiencies[l].total}`)
          .join(', ')}
      </LabelLine>
      <Line>{attrLine}</Line>
      {data.inventory_flat.filter((i) => i.item.meta_data?.unselectable !== true).length > 0 && (
        <LabelLine label='Items'>
          {data.inventory_flat
            .filter((i) => i.item.meta_data?.unselectable !== true)
            .map((i) => {
              const nameStr = linkContent(i.item.name.toLowerCase(), 'item', i.item);
              return i.item.meta_data?.quantity && i.item.meta_data.quantity > 1
                ? `${nameStr} (${i.item.meta_data.quantity})`
                : nameStr;
            })
            .join(', ')}
        </LabelLine>
      )}
      <hr className='border-p1-border' />
      <Line>
        {`**AC** ${data.ac}; ${getArmorShieldDisplay(data.armor_item, data.shield_item)} **Fort.** ${data.proficiencies['SAVE_FORT'].total}, **Ref.** ${data.proficiencies['SAVE_REFLEX'].total}, **Will** ${data.proficiencies['SAVE_WILL'].total}`}
      </Line>
      <Line>
        {`**HP** ${entity.hp_current ?? data.max_hp} / ${data.max_hp}${entity.hp_temp ? ` (${entity.hp_temp} temp)` : ''}${getResistWeaksDisplay(data.resist_weaks)}`}
      </Line>
      {entity.details?.conditions && entity.details.conditions.length > 0 && (
        <LabelLine label='Conditions'>
          {compiledConditions(entity.details.conditions)
            .map((c) => (c.value ? `${c.name.toLowerCase()} ${c.value}` : c.name.toLowerCase()))
            .join(', ')}
        </LabelLine>
      )}
      {abilities.filter((ab) => ab.actions === 'FREE-ACTION' || ab.actions === 'REACTION').map((ab) => (
        <Line key={`reac-${ab.id}-${ab.name}`}>{getAbilityDisplay(ab)}</Line>
      ))}
      <hr className='border-p1-border' />
      {data.speeds.filter((s) => s.value.total !== 0).length > 0 && (
        <LabelLine label='Speed'>
          {data.speeds
            .filter((s) => s.value.value !== 0)
            .map((s) => (s.name === 'SPEED' ? `${s.value.total} ft` : `${s.name.replace('SPEED_', '').toLowerCase()} ${s.value.total} ft`))
            .join(', ')}
        </LabelLine>
      )}
      {(data.weapons ?? []).filter((w) => isItemWeapon(w.item)).map((w) => (
        <Line key={`w-${w.item.id}`}>{getWeaponDisplay(w)}</Line>
      ))}
      {getInnateSpellsDisplay().map((line, i) => (
        <Line key={`innate-${i}`}>{line}</Line>
      ))}
      {getPreparedSpellsDisplay().map((line, i) => (
        <Line key={`prep-${i}`}>{line}</Line>
      ))}
      {getSpontaneousSpellsDisplay().map((line, i) => (
        <Line key={`spon-${i}`}>{line}</Line>
      ))}
      {getFocusSpellsDisplay().map((line, i) => (
        <Line key={`focus-${i}`}>{line}</Line>
      ))}
      {getRitualSpellsDisplay() ? <Line>{getRitualSpellsDisplay()!}</Line> : null}
      {abilities
        .filter((ab) => ab.actions && ab.actions !== 'FREE-ACTION' && ab.actions !== 'REACTION')
        .map((ab) => (
          <Line key={`act-${ab.id}-${ab.name}`}>{getAbilityDisplay(ab)}</Line>
        ))}
      {abilities.filter((ab) => !ab.actions).length > 0 && <hr className='border-p1-border' />}
      {abilities.filter((ab) => !ab.actions).map((ab) => (
        <Line key={`pas-${ab.id}-${ab.name}`}>{getAbilityDisplay(ab)}</Line>
      ))}
      {isCreature(entity) && entity.details.description.trim() ? (
        <>
          <hr className='border-p1-border' />
          <div className={isPreformattedDescription ? undefined : 'italic text-p1-muted'}>
            <ProseMarkdown className='stat-block-line'>{entity.details.description}</ProseMarkdown>
          </div>
        </>
      ) : null}
    </article>
  );
}

export function TraitRow({
  traitIds,
  traits,
  rarity,
  size,
}: {
  traitIds: number[];
  traits: Array<{ id: number; name: string }>;
  rarity?: string;
  size: string;
}) {
  const { open } = useContentLinks();
  const chips = [
    rarity && rarity !== 'COMMON' ? { label: toLabel(rarity), href: undefined as string | undefined } : null,
    size ? { label: size, href: undefined } : null,
    ...traitIds.map((id) => {
      const trait = traits.find((t) => t.id === id);
      return trait ? { label: trait.name, href: `link_trait_${trait.id}` } : null;
    }),
  ].filter(isTruthy);

  if (chips.length === 0) return null;
  return (
    <div className='flex flex-wrap gap-1'>
      {chips.map((chip, i) =>
        chip.href ? (
          <button
            key={`${chip.label}-${i}`}
            type='button'
            className='pf2e-content-link border border-p1-border bg-p1-inset px-1.5 py-0.5 text-[10px] font-semibold uppercase'
            onClick={() => open(chip.href!)}
          >
            {chip.label}
          </button>
        ) : (
          <span key={`${chip.label}-${i}`} className='border border-p1-border bg-p1-inset px-1.5 py-0.5 text-[10px] font-semibold uppercase text-p1-muted'>
            {chip.label}
          </span>
        )
      )}
    </div>
  );
}

const KNOWLEDGE_SKILL_MAP: Record<string, string> = {
  aberration: 'Occultism',
  animal: 'Nature',
  astral: 'Occultism',
  beast: 'Arcana or Nature',
  celestial: 'Religion',
  construct: 'Arcana or Crafting',
  dragon: 'Arcana',
  dream: 'Occultism',
  elemental: 'Arcana or Nature',
  ethereal: 'Occultism',
  fey: 'Nature',
  fiend: 'Religion',
  fungus: 'Nature',
  'fungus (creature)': 'Nature',
  humanoid: 'Society',
  monitor: 'Religion',
  ooze: 'Occultism',
  plant: 'Nature',
  'plant (creature)': 'Nature',
  shade: 'Religion',
  spirit: 'Occultism',
  time: 'Occultism',
  undead: 'Religion',
};

export function recallKnowledgeText(entity: Creature, traits: Trait[]) {
  const matched = findCreatureTraits(entity)
    .map((id) => traits.find((t) => t.id === id))
    .filter(isTruthy);
  const knowledgeTrait = matched.find((t) => KNOWLEDGE_SKILL_MAP[t.name.toLowerCase()]);
  const knowledgeSkill = knowledgeTrait ? KNOWLEDGE_SKILL_MAP[knowledgeTrait.name.toLowerCase()] : null;
  if (!knowledgeSkill || !knowledgeTrait) return null;
  const extra = entity.rarity !== 'COMMON' ? `, ${entity.rarity.toLowerCase()}` : '';
  return `(${knowledgeTrait.name.toLowerCase()}${extra}) ${knowledgeSkill} DC ${getDcForLevel(getEntityLevel(entity), entity.rarity)}`;
}

function RecallKnowledgeLine({ entity, traits }: { entity: Creature; traits: Trait[] }) {
  const text = recallKnowledgeText(entity, traits);
  return text ? <LabelLine label='Recall Knowledge'>{text}</LabelLine> : null;
}
