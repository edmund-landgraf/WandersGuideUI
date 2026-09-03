import { ActionSymbol } from '@common/Actions';
import { parseIconValue } from '@common/IconDisplay';
import { compiledConditions } from '@conditions/condition-handler';
import { getJsonV4Content } from '@export/json/json-v4';
import { isItemRangedWeapon, isItemWeapon } from '@items/inv-utils';
import { parseOtherDamage } from '@items/weapon-handler';
import type { AbilityBlock, AbilityBlockType, ContentType, LivingEntity } from '@schemas/content';
import { convertToSize } from '@upload/foundry-utils';
import { getEntityLevel } from '@utils/entity-utils';
import { rankNumber, sign } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { isCharacter, isCreature, isTruthy } from '@utils/type-fixing';
import { compactLabels } from '@variables/variable-utils';
import { flatten, groupBy } from 'lodash-es';
import { useMemo, useState } from 'react';
import { Eyebrow } from './phase1-entity-panels';
import { useContentLinks } from './phase1-content-links';
import { recallKnowledgeText, TraitRow } from './phase1-stat-block';

type StatBlockContent = Awaited<ReturnType<typeof getJsonV4Content>>;
type NamedSpell = { name: string; href?: string; extra?: string; strike?: boolean };

function hrefFor(type: ContentType | AbilityBlockType, id?: number) {
  if (!id || `${id}`.length >= 10) return undefined;
  return `link_${type}_${id}`;
}

function Card({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  if (!children) return null;
  return (
    <section className='border border-p1-border bg-p1-surface'>
      <header className='flex items-center justify-between gap-2 border-b border-p1-border px-2 py-1'>
        <Eyebrow>{title}</Eyebrow>
        {extra}
      </header>
      <div className='space-y-1 px-2 py-1.5 pl-3.5 text-xs leading-5 text-p1-text'>{children}</div>
    </section>
  );
}

function VList({ children }: { children: React.ReactNode }) {
  return <ul className='m-0 list-none space-y-0 p-0'>{children}</ul>;
}

function VItem({ children }: { children: React.ReactNode }) {
  return <li className='border-b border-p1-border/50 py-0.5 last:border-0'>{children}</li>;
}

function LinkChip({ href, children, strike }: { href?: string; children: React.ReactNode; strike?: boolean }) {
  const { open } = useContentLinks();
  const className = `max-w-full truncate text-left ${strike ? 'line-through text-p1-muted' : ''} ${href ? 'pf2e-content-link' : ''}`;
  if (!href) return <span className={className}>{children}</span>;
  return (
    <button type='button' className={className} onClick={() => open(href)}>
      {children}
    </button>
  );
}

function colCount(n: number, max = 3) {
  if (n <= 1) return 1;
  if (n === 2 || max === 2) return Math.min(2, n);
  return Math.min(3, n);
}

export function Phase1StatBlockCards({ entity, data }: { entity: LivingEntity; data: StatBlockContent }) {
  const [allSkills, setAllSkills] = useState(false);
  const abilities = flatten(Object.values(data.feats_features)) as AbilityBlock[];
  const reactions = abilities.filter((ab) => ab.actions === 'FREE-ACTION' || ab.actions === 'REACTION');
  const actions = abilities.filter((ab) => ab.actions && ab.actions !== 'FREE-ACTION' && ab.actions !== 'REACTION');
  const passives = abilities.filter((ab) => !ab.actions);
  const icon = parseIconValue(entity.details?.image_url ?? '');
  const imageUrl = icon.type === 'image' && icon.value ? icon.value : '';
  const sizeLabel = toLabel(convertToSize(data.size));
  const speeds = data.speeds.filter((s) => s.value.total !== 0 && s.value.value !== 0);
  const speedText = speeds
    .map((s) => (s.name === 'SPEED' ? `${s.value.total} ft` : `${s.name.replace('SPEED_', '').toLowerCase()} ${s.value.total} ft`))
    .join(', ');
  const rk = isCreature(entity) ? recallKnowledgeText(entity, data.all_traits) : null;
  const conditions = compiledConditions(entity.details?.conditions ?? []);
  const rw = data.resist_weaks;
  const skills = useMemo(() => {
    return Object.keys(data.proficiencies)
      .filter((name) => name.startsWith('SKILL_') && name !== 'SKILL_LORE____')
      .map((name) => ({
        name,
        label: toLabel(name),
        total: data.proficiencies[name].total,
        trained: Number(data.proficiencies[name].parts?.profValue ?? 0) > 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data.proficiencies]);
  const shownSkills = allSkills ? skills : skills.filter((s) => s.trained);
  const items = data.inventory_flat
    .filter((i) => i.item.meta_data?.unselectable !== true)
    .slice()
    .sort((a, b) => Number(b.is_equipped) - Number(a.is_equipped) || a.item.name.localeCompare(b.item.name));

  const weapons = (data.weapons ?? []).filter((w) => isItemWeapon(w.item));

  return (
    <div className='stat-block-experimental min-w-[1100px] space-y-2 pb-8 text-p1-text'>
      <header className='flex items-start gap-3 border border-p1-border bg-p1-surface'>
        <div className='min-w-0 flex-1 px-3 py-2'>
          <div className='flex flex-wrap items-baseline justify-between gap-2'>
            <h1 className='text-xl font-semibold'>{toLabel(entity.name)}</h1>
            <p className='text-xs text-p1-muted'>
              {isCharacter(entity) ? 'Character' : 'Creature'} {getEntityLevel(entity)}
            </p>
          </div>
          <div className='mt-1 flex flex-wrap items-center gap-1 pl-0.5'>
            <TraitRow
              traitIds={data.character_traits.map((trait) => trait.id)}
              traits={data.all_traits}
              rarity={isCreature(entity) ? entity.rarity : undefined}
              size={sizeLabel}
            />
            {data.languages.map((lang) => (
              <span key={lang} className='border border-p1-border bg-p1-inset px-1.5 py-0.5 text-[10px] uppercase text-p1-muted'>
                {toLabel(lang)}
              </span>
            ))}
          </div>
          {rk ? <p className='mt-1 pl-0.5 text-[11px] text-p1-muted'>Recall Knowledge {rk}</p> : null}
          <div className='mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-0.5 text-xs'>
            <span>
              <span className='text-p1-muted'>HP</span> {entity.hp_current ?? data.max_hp}/{data.max_hp}
              {entity.hp_temp ? ` (${entity.hp_temp} temp)` : ''}
            </span>
            <span>
              <span className='text-p1-muted'>AC</span> {data.ac}
            </span>
            <span>
              <span className='text-p1-muted'>Fort</span> {data.proficiencies['SAVE_FORT'].total}
            </span>
            <span>
              <span className='text-p1-muted'>Ref</span> {data.proficiencies['SAVE_REFLEX'].total}
            </span>
            <span>
              <span className='text-p1-muted'>Will</span> {data.proficiencies['SAVE_WILL'].total}
            </span>
            {speedText ? (
              <span>
                <span className='text-p1-muted'>Speed</span> {speedText}
              </span>
            ) : null}
            <span>
              <span className='text-p1-muted'>Perception</span> {data.proficiencies['PERCEPTION'].total}
              {stringifySenses(data)}
            </span>
          </div>
        </div>
        {imageUrl ? <img src={imageUrl} alt='' className='m-2 h-16 w-16 shrink-0 object-contain' /> : null}
      </header>

      <div className='grid grid-cols-3 items-start gap-2'>
        <Card title='Strikes'>
          <VList>
            {weapons.length === 0 ? (
              <VItem>
                <span className='text-p1-muted'>No equipped weapons.</span>
              </VItem>
            ) : (
              weapons.map((weapon) => {
                const damageBonus = weapon.stats.damage.bonus.total > 0 ? ` + ${weapon.stats.damage.bonus.total}` : '';
                return (
                  <VItem key={weapon.item.id}>
                    <div className='flex flex-wrap items-baseline gap-x-1.5'>
                      <ActionSymbol cost='ONE-ACTION' size={12} />
                      <span className='text-p1-muted'>{isItemRangedWeapon(weapon.item) ? 'Ranged' : 'Melee'}</span>
                      <LinkChip href={hrefFor('item', weapon.item.id)}>{weapon.item.name}</LinkChip>
                      <span className='font-mono'>
                        {sign(weapon.stats.attack_bonus.total[0])}/{sign(weapon.stats.attack_bonus.total[1])}/
                        {sign(weapon.stats.attack_bonus.total[2])}
                      </span>
                      <span>
                        {weapon.stats.damage.dice}
                        {weapon.stats.damage.die}
                        {damageBonus} {weapon.stats.damage.damageType}
                        {parseOtherDamage(weapon.stats.damage.other).join('')}
                        {weapon.stats.damage.extra ? ` + ${weapon.stats.damage.extra}` : ''}
                      </span>
                    </div>
                  </VItem>
                );
              })
            )}
          </VList>
        </Card>
        <Card title='Actions'>
          <VList>
            {reactions.length === 0 && actions.length === 0 && conditions.length === 0 && !rw.immunes.length && !rw.resists.length && !rw.weaks.length ? (
              <VItem>
                <span className='text-p1-muted'>None listed.</span>
              </VItem>
            ) : null}
            {reactions.map((ab) => (
              <VItem key={`r-${ab.id}-${ab.name}`}>
                <AbilityRow ability={ab} />
              </VItem>
            ))}
            {actions.map((ab) => (
              <VItem key={`a-${ab.id}-${ab.name}`}>
                <AbilityRow ability={ab} />
              </VItem>
            ))}
            {conditions.map((c) => (
              <VItem key={c.name}>
                <span className='text-p1-muted'>Condition</span> {c.value ? `${c.name.toLowerCase()} ${c.value}` : c.name.toLowerCase()}
              </VItem>
            ))}
            {rw.immunes.length > 0 ? (
              <VItem>
                <span className='text-p1-muted'>Immunities</span> {rw.immunes.join(', ').toLowerCase()}
              </VItem>
            ) : null}
            {rw.resists.length > 0 ? (
              <VItem>
                <span className='text-p1-muted'>Resistances</span> {rw.resists.join(', ').toLowerCase()}
              </VItem>
            ) : null}
            {rw.weaks.length > 0 ? (
              <VItem>
                <span className='text-p1-muted'>Weaknesses</span> {rw.weaks.join(', ').toLowerCase()}
              </VItem>
            ) : null}
          </VList>
        </Card>
        {items.length > 0 ? (
          <Card title='Items'>
            <div className={`grid gap-x-3 ${items.length > 5 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {items.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex justify-between gap-2 border-b border-p1-border/50 py-0.5 ${entry.is_equipped ? 'text-p1-text' : 'text-p1-muted'}`}
                >
                  <LinkChip href={hrefFor('item', entry.item.id)}>
                    {entry.item.name}
                    {entry.item.meta_data?.quantity && entry.item.meta_data.quantity > 1 ? ` (${entry.item.meta_data.quantity})` : ''}
                  </LinkChip>
                  {entry.is_equipped ? <span className='shrink-0 text-[10px] uppercase text-p1-faint'>eq</span> : null}
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <div />
        )}
      </div>

      <div className='grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] items-start gap-2'>
        <Card title='Attributes'>
          <div className='grid grid-cols-6 gap-1 text-center'>
            {Object.keys(data.attributes).map((key) => (
              <div key={key} className='border border-p1-border bg-p1-inset px-1 py-1'>
                <div className='text-[9px] uppercase text-p1-muted'>{compactLabels(toLabel(key))}</div>
                <div className={`font-mono ${data.attributes[key].partial ? 'italic' : ''}`}>{sign(data.attributes[key].value)}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card
          title='Skills'
          extra={
            <button
              type='button'
              className='text-[10px] uppercase text-p1-muted hover:text-p1-accent-soft'
              onClick={() => setAllSkills((value) => !value)}
            >
              {allSkills ? 'Trained only' : 'Show all'}
            </button>
          }
        >
          <div className='grid grid-cols-2 gap-x-4'>
            {shownSkills.map((skill) => (
              <div key={skill.name} className='flex justify-between gap-2 border-b border-p1-border/50 py-0.5'>
                <span className='truncate'>{skill.label}</span>
                <span className='font-mono text-p1-accent-soft'>{skill.total}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <SpellCards entity={entity} data={data} />

      {passives.length > 0 ? (
        <Card title='Features'>
          <div className={`grid gap-x-4 ${passives.length > 8 ? 'grid-cols-3' : passives.length > 4 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {passives.map((ab) => (
              <div key={`${ab.id}-${ab.name}`} className='border-b border-p1-border/50 py-0.5'>
                <LinkChip href={hrefFor((ab.type as AbilityBlockType) ?? 'feat', ab.id)}>{ab.name}</LinkChip>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {isCreature(entity) && entity.details.description.trim() ? (
        <Card title='Description'>
          <p className='whitespace-pre-wrap text-p1-muted'>{entity.details.description}</p>
        </Card>
      ) : null}
    </div>
  );
}

function AbilityRow({ ability }: { ability: AbilityBlock }) {
  const href = hrefFor((ability.type as AbilityBlockType) ?? 'feat', ability.id);
  return (
    <div className='flex items-start gap-1.5'>
      <span className='mt-0.5 shrink-0'>
        <ActionSymbol cost={ability.actions} size={12} />
      </span>
      <div className='min-w-0'>
        <LinkChip href={href}>{ability.name}</LinkChip>
        {ability.trigger ? <p className='pl-0.5 text-[11px] text-p1-muted'>Trigger {ability.trigger}</p> : null}
      </div>
    </div>
  );
}

function stringifySenses(data: StatBlockContent) {
  const format = (list: { senseName: string; range: string; sense?: { id?: number } }[]) =>
    list
      .map((sense) => `${sense.senseName.toLowerCase()}${sense.range.trim() ? ` (${sense.range} ft.)` : ''}`)
      .join(', ');
  const parts: string[] = [];
  const precise = format(data.senses.precise);
  const imprecise = format(data.senses.imprecise);
  const vague = format(data.senses.vague);
  if (precise) parts.push(`precise ${precise}`);
  if (imprecise) parts.push(`imprecise ${imprecise}`);
  if (vague) parts.push(`vague ${vague}`);
  return parts.length ? `; ${parts.join('; ')}` : '';
}

function SpellCards({ entity, data }: { entity: LivingEntity; data: StatBlockContent }) {
  const prepared = data.spell_sources.filter((s) => s.source.type.startsWith('PREPARED-'));
  const spontaneous = data.spell_sources.filter((s) => s.source.type.startsWith('SPONTANEOUS-'));
  const hasMagic =
    prepared.length > 0 ||
    spontaneous.length > 0 ||
    data.innate_spells.length > 0 ||
    data.focus_spells.length > 0 ||
    data.spells.rituals.length > 0;
  if (!hasMagic) return null;
  const level = getEntityLevel(entity);

  return (
    <div className='space-y-2'>
      {prepared.length > 0
        ? Object.entries(groupBy(prepared, (s) => s.source.tradition)).map(([tradition, sources]) => (
            <CasterCard
              key={`prep-${tradition}`}
              title={`${toLabel(tradition)} prepared`}
              attack={sources[0].stats.spell_attack.total[0]}
              dc={sources[0].stats.spell_dc.total}
              slots={data.spell_slots.filter((slot) => sources.some((s) => s.source.name === slot.source))}
              namesByRank={groupBy(
                data.spell_slots.filter((slot) => slot.spell && sources.some((s) => s.source.name === slot.source)),
                (slot) => slot.rank
              )}
              prepared
              level={level}
            />
          ))
        : null}
      {spontaneous.length > 0
        ? Object.entries(groupBy(spontaneous, (s) => s.source.tradition)).map(([tradition, sources]) => {
            const sourceNames = sources.map((s) => s.source.name);
            const spells = data.spell_raw_data.list.filter((s) => sourceNames.includes(s.source));
            return (
              <CasterCard
                key={`spon-${tradition}`}
                title={`${toLabel(tradition)} spontaneous`}
                attack={sources[0].stats.spell_attack.total[0]}
                dc={sources[0].stats.spell_dc.total}
                slots={data.spell_slots.filter((slot) => sourceNames.includes(slot.source))}
                namesByRank={groupBy(spells, (s) => s.rank)}
                spellLookup={(id) => data.spells.all.find((spell) => spell.id === id)}
                level={level}
              />
            );
          })
        : null}
      {data.innate_spells.length > 0
        ? Object.entries(groupBy(data.innate_spells, (s) => s.tradition)).map(([tradition, spells]) => (
            <RankBoard
              key={`innate-${tradition}`}
              title={`${toLabel(tradition)} innate`}
              meta={`DC ${parseInt(data.proficiencies['INNATE_SPELL_DC'].total)}, attack ${sign(data.proficiencies['INNATE_SPELL_ATTACK'].total)}`}
              groups={Object.entries(groupBy(spells, (s) => s.rank))
                .sort(([a], [b]) => Number(b) - Number(a))
                .map(([rank, rankSpells]) => ({
                  rank: Number(rank),
                  names: rankSpells.map((s) => ({
                    name: s.spell.name,
                    href: hrefFor('spell', s.spell.id),
                    extra: s.casts_max > 1 ? `${s.casts_current}/${s.casts_max}` : undefined,
                  })),
                }))}
              level={level}
            />
          ))
        : null}
      {data.focus_spells.length > 0
        ? Object.entries(groupBy(data.focus_spells, (s) => s.casting_source)).map(([source, spells]) => {
            const sourceData = data.spell_sources.find((s) => s.source.name === source);
            const maxPoints = spells.filter((s) => s.rank > 0).length;
            const currentPoints = entity.spells?.focus_point_current ?? maxPoints;
            return (
              <RankBoard
                key={`focus-${source}`}
                title={`${toLabel(source)} focus`}
                meta={`DC ${sourceData?.stats.spell_dc.total ?? 0}, attack ${sign(sourceData?.stats.spell_attack.total[0] ?? 0)}, ${currentPoints === maxPoints ? maxPoints : `${currentPoints}/${maxPoints}`} FP`}
                groups={Object.entries(groupBy(spells, (s) => s.rank))
                  .sort(([a], [b]) => Number(b) - Number(a))
                  .map(([rank, rankSpells]) => ({
                    rank: Number(rank),
                    names: rankSpells.map((s) => ({ name: s.name, href: hrefFor('spell', s.id) })),
                  }))}
                level={level}
              />
            );
          })
        : null}
      {data.spells.rituals.length > 0 ? (
        <RankBoard
          title='Rituals'
          groups={Object.entries(groupBy(data.spells.rituals, (s) => s.rank))
            .sort(([a], [b]) => Number(b) - Number(a))
            .map(([rank, spells]) => ({
              rank: Number(rank),
              names: spells.map((s) => ({ name: s.name, href: hrefFor('spell', s.id) })),
            }))}
          level={level}
        />
      ) : null}
    </div>
  );
}

function CasterCard({
  title,
  attack,
  dc,
  slots,
  namesByRank,
  prepared,
  spellLookup,
  level,
}: {
  title: string;
  attack: number;
  dc: number;
  slots: Array<{ rank: number; exhausted?: boolean; spell?: { id: number; name: string } | null }>;
  namesByRank: Record<string, any[]>;
  prepared?: boolean;
  spellLookup?: (id: number) => { id: number; name: string } | undefined;
  level: number;
}) {
  const ranks = [...new Set(Object.keys(namesByRank).map(Number))].sort((a, b) => b - a);
  const slotStrip = [...new Set(slots.map((s) => s.rank))]
    .sort((a, b) => a - b)
    .map((rank) => {
      const atRank = slots.filter((s) => s.rank === rank);
      const remaining = atRank.filter((s) => s.exhausted !== true).length;
      const label = rank === 0 ? 'Can' : rankNumber(rank);
      const count = remaining === atRank.length ? `${atRank.length}` : `${remaining}/${atRank.length}`;
      return `${label} ${count}`;
    })
    .join(' · ');

  const groups = ranks.map((rank) => {
    const names = (namesByRank[String(rank)] ?? [])
      .map((entry) => {
        if (prepared) {
          const spell = entry.spell;
          if (!spell) return null;
          return { name: spell.name, href: hrefFor('spell', spell.id), strike: Boolean(entry.exhausted) } satisfies NamedSpell;
        }
        const spell = spellLookup?.(entry.spell_id);
        if (!spell) return null;
        return { name: spell.name, href: hrefFor('spell', spell.id) } satisfies NamedSpell;
      })
      .filter(isTruthy);
    return { rank, names };
  });

  return <RankBoard title={title} meta={`DC ${dc}, attack ${sign(attack)}${slotStrip ? ` · ${slotStrip}` : ''}`} groups={groups} level={level} />;
}

function RankBoard({
  title,
  meta,
  groups,
  level,
}: {
  title: string;
  meta?: string;
  groups: Array<{ rank: number; names: NamedSpell[] }>;
  level: number;
}) {
  const filled = groups.filter((group) => group.names.length > 0);
  if (filled.length === 0 && !meta) return null;
  const cols = colCount(filled.length);
  return (
    <Card title={title}>
      {meta ? <p className='text-[11px] text-p1-muted'>{meta}</p> : null}
      <div className={`grid items-start gap-x-4 gap-y-2`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {filled.map((group) => (
          <div key={group.rank} className='min-w-0'>
            <div className='mb-0.5 border-b border-p1-border pb-0.5 text-[10px] font-semibold uppercase text-p1-muted'>
              {rankNumber(group.rank, `Cantrips (${rankNumber(Math.ceil(level / 2))})`)}
            </div>
            <VList>
              {group.names.map((item, index) => (
                <VItem key={`${item.name}-${index}`}>
                  <LinkChip href={item.href} strike={item.strike}>
                    {item.name}
                    {item.extra ? ` (${item.extra})` : ''}
                  </LinkChip>
                </VItem>
              ))}
            </VList>
          </div>
        ))}
      </div>
    </Card>
  );
}
