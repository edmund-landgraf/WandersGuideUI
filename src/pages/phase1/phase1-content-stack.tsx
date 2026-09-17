import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { ArrowLeft, X } from 'lucide-react';
import { ActionSymbol } from '@common/Actions';
import { fetchContentById, getCachedContent } from '@content/content-store';
import { convertToContentType, isAbilityBlockType } from '@content/content-utils';
import { getConditionByName } from '@conditions/condition-handler';
import { priceToString } from '@items/currency-handler';
import { determineItemMetaType, labelizeBulk } from '@items/inv-utils';
import type { AbilityBlock, Item, Language, Spell, Trait } from '@schemas/content';
import { abilityNameAndCost } from '@utils/actions';
import { useContentLinks, type ContentLinkRef } from './phase1-content-links';
import { ProseMarkdown } from './phase1-markdown';

export function CloseStackOnNavigate() {
  const { pathname } = useLocation();
  const { close } = useContentLinks();
  useEffect(() => {
    close();
  }, [pathname, close]);
  return null;
}

export function ContentStackModal() {
  const { stack, back, close } = useContentLinks();
  const current = stack[stack.length - 1];
  if (!current) return null;
  const parentOpen = Boolean(document.querySelector('[data-entity-modal]'));
  return <CatalogModal entry={current} canGoBack={stack.length > 1 || parentOpen} onBack={back} onClose={close} />;
}

function CatalogModal({
  entry,
  canGoBack,
  onBack,
  onClose,
}: {
  entry: ContentLinkRef;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const content = useQuery({
    queryKey: ['phase1-content-link', entry.type, entry.id],
    queryFn: () => loadCatalogContent(entry),
  });

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      if (canGoBack) onBack();
      else onClose();
    };
    document.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
    };
  }, [canGoBack, onBack, onClose]);

  const loaded = content.data;
  const wide = (loaded?.description.length ?? 0) > 900;

  return createPortal(
    <div
      data-content-stack-modal
      className='fixed inset-0 z-[110] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-labelledby='content-stack-title'
        className={`flex max-h-[min(82vh,820px)] w-full flex-col border border-p1-border bg-p1-surface shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}
      >
        <header className='flex items-start gap-4 border-b border-p1-border px-5 py-4'>
          <div className='min-w-0 flex-1'>
            {content.isLoading && <h2 id='content-stack-title' className='text-xl font-semibold leading-tight text-p1-muted'>Loading...</h2>}
            {content.isError && <h2 id='content-stack-title' className='text-xl font-semibold leading-tight'>Couldn't open this link</h2>}
            {loaded && (
              <>
                <div className='flex items-center gap-2'>
                  {loaded.actions != null && <ActionSymbol cost={loaded.actions} size='1.75rem' />}
                  <h2 id='content-stack-title' className='text-xl font-semibold leading-tight'>
                    {loaded.title}
                  </h2>
                  {loaded.subtitle && <span className='shrink-0 text-sm text-p1-muted'>{loaded.subtitle}</span>}
                </div>
                {loaded.tags.length > 0 && (
                  <div className='mt-2 flex flex-wrap gap-1.5'>
                    {loaded.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </div>
                )}
              </>
            )}
            {!content.isLoading && !content.isError && !loaded && (
              <h2 id='content-stack-title' className='text-xl font-semibold leading-tight'>Content not found</h2>
            )}
          </div>
          {canGoBack ? (
            <button ref={closeRef} className='icon-button shrink-0' onClick={onBack} title='Back'>
              <ArrowLeft size={18} />
            </button>
          ) : (
            <button ref={closeRef} className='icon-button shrink-0' onClick={onClose} title='Close'>
              <X size={18} />
            </button>
          )}
        </header>
        <div className='min-h-0 overflow-y-auto px-5 py-4'>
          {content.isError && (
            <p className='text-sm text-p1-danger-soft'>{content.error instanceof Error ? content.error.message : 'This record could not be loaded.'}</p>
          )}
          {loaded && (
            <>
              {loaded.facts.some((fact) => fact.value) && (
                <div className='mb-4 space-y-1 border-b border-p1-border pb-4 text-sm leading-6'>
                  {loaded.facts.map((fact) => (
                    <Fact key={fact.label} label={fact.label} value={fact.value} />
                  ))}
                </div>
              )}
              <ProseMarkdown>{loaded.description || 'No description given.'}</ProseMarkdown>
              {loaded.extra}
            </>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

type CatalogView = {
  title: string;
  subtitle?: string;
  tags: string[];
  actions?: AbilityBlock['actions'] | Spell['cast'] | null;
  facts: { label: string; value?: string | null }[];
  description: string;
  extra?: ReactNode;
};

async function loadCatalogContent(entry: ContentLinkRef): Promise<CatalogView | null> {
  if (entry.type === 'condition') {
    const condition = getConditionByName(entry.id);
    if (!condition) return inlineView(entry) ?? null;
    return {
      title: condition.name,
      tags: ['Condition'],
      facts: [],
      description: condition.description,
    };
  }

  const id = Number(entry.id);
  if (!Number.isFinite(id)) {
    return variableView(entry.id) ?? inlineView(entry);
  }

  const contentType = convertToContentType(entry.type);
  const record =
    cachedRecord(contentType, id) ?? (await fetchContentById<Record<string, unknown>>(contentType, id));
  if (!record) return variableView(entry.id) ?? inlineView(entry);

  const traitNames = await traitNamesFor(record.traits);

  if (contentType === 'ability-block' || isAbilityBlockType(entry.type)) {
    const ability = record as unknown as AbilityBlock;
    const { name, cost } = abilityNameAndCost(ability.name, ability.actions);
    return {
      title: name,
      tags: [ability.rarity, ability.type, ...traitNames].filter(Boolean),
      actions: cost,
      facts: [
        { label: 'Prerequisites', value: ability.prerequisites?.join(', ') },
        { label: 'Frequency', value: ability.frequency },
        { label: 'Trigger', value: ability.trigger },
        { label: 'Cost', value: ability.cost },
        { label: 'Requirements', value: ability.requirements },
        { label: 'Access', value: ability.access },
      ],
      description: ability.description,
      extra: ability.special ? (
        <div className='mt-4 border-t border-p1-border pt-4'>
          <strong className='mr-2 text-p1-text'>Special</strong>
          <ProseMarkdown>{ability.special}</ProseMarkdown>
        </div>
      ) : undefined,
    };
  }

  if (contentType === 'item') {
    const item = record as unknown as Item;
    return {
      title: item.name,
      subtitle: determineItemMetaType(item, true),
      tags: [item.rarity, item.group.replaceAll('_', ' '), ...traitNames].filter(Boolean),
      facts: [
        { label: 'Level', value: String(item.level) },
        { label: 'Bulk', value: labelizeBulk(item.bulk ?? undefined, true) },
        { label: 'Price', value: formatPrice(item) },
        { label: 'Hands', value: item.hands?.trim() || null },
        { label: 'Usage', value: item.usage?.trim() || null },
        { label: 'Damage', value: formatDamage(item) },
        { label: 'Range', value: item.meta_data?.range != null && `${item.meta_data.range}`.trim() !== '' ? `${item.meta_data.range} ft.` : null },
        { label: 'AC Bonus', value: item.meta_data?.ac_bonus != null ? String(item.meta_data.ac_bonus) : null },
      ],
      description: item.description,
    };
  }

  if (contentType === 'spell') {
    const spell = record as unknown as Spell;
    const cantrip = traitNames.some((name) => name.toLowerCase() === 'cantrip');
    return {
      title: spell.name,
      tags: [cantrip ? 'Cantrip' : `Rank ${spell.rank}`, spell.rarity, ...traitNames].filter(Boolean),
      actions: spell.cast,
      facts: [
        { label: 'Traditions', value: spell.traditions.join(', ') },
        { label: 'Defense', value: spell.defense },
        { label: 'Cost', value: spell.cost },
        { label: 'Trigger', value: spell.trigger },
        { label: 'Requirements', value: spell.requirements },
        { label: 'Range', value: spell.range },
        { label: 'Area', value: spell.area },
        { label: 'Targets', value: spell.targets },
        { label: 'Duration', value: spell.duration },
      ],
      description: spell.description,
      extra: spell.heightened?.text?.map((heightened, index) => (
        <div key={index} className='mt-4 border-t border-p1-border pt-4'>
          <strong className='mr-2 text-p1-text'>Heightened ({heightened.amount})</strong>
          <ProseMarkdown>{heightened.text}</ProseMarkdown>
        </div>
      )),
    };
  }

  if (contentType === 'trait') {
    const trait = record as unknown as Trait;
    return { title: trait.name, tags: ['Trait'], facts: [], description: trait.description };
  }

  if (contentType === 'language') {
    const language = record as unknown as Language;
    return {
      title: language.name,
      tags: [language.rarity, 'Language'].filter(Boolean),
      facts: [
        { label: 'Speakers', value: language.speakers },
        { label: 'Script', value: language.script },
      ],
      description: language.description,
    };
  }

  const name = typeof record.name === 'string' ? record.name : 'Unknown';
  const rarity = typeof record.rarity === 'string' ? record.rarity : null;
  const description = typeof record.description === 'string' ? record.description : '';
  return {
    title: name,
    tags: [rarity, entry.type.replaceAll('-', ' ')].filter((tag): tag is string => Boolean(tag)),
    facts: [],
    description,
  };
}

function cachedRecord(type: ReturnType<typeof convertToContentType>, id: number): Record<string, unknown> | null {
  const match = getCachedContent<Record<string, unknown> & { id: number }>(type).find((record) => record.id === id);
  return match ?? null;
}

function inlineView(entry: ContentLinkRef): CatalogView | null {
  if (!entry.title && !entry.description) return null;
  return {
    title: entry.title || 'Details',
    tags: [],
    facts: [],
    description: entry.description || 'No description given.',
  };
}

function variableView(id: string): CatalogView | null {
  const name = id.trim();
  if (!name) return null;
  const attribute = attributeDescription(name);
  if (attribute) {
    return { title: attribute.title, tags: ['Attribute'], facts: [], description: attribute.description };
  }
  if (
    /^(SKILL_|SAVE_|WEAPON_|ARMOR_|SPELL_|LORE_|PERCEPTION|CLASS_DC|SPEED)/i.test(name)
  ) {
    const title = name
      .replace(/^(SKILL_|SAVE_|WEAPON_|ARMOR_|SPELL_)/i, '')
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    return {
      title,
      tags: [variableKind(name)],
      facts: [],
      description: `${title} is a character statistic, not a catalog entry. Choose it here to apply this builder option.`,
    };
  }
  return null;
}

function variableKind(name: string) {
  if (name.startsWith('SKILL_') || name.startsWith('LORE_')) return 'Skill';
  if (name.startsWith('SAVE_')) return 'Saving Throw';
  if (name.startsWith('WEAPON_')) return 'Weapon';
  if (name.startsWith('ARMOR_')) return 'Armor';
  if (name.startsWith('SPELL_')) return 'Spell Tradition';
  if (name === 'PERCEPTION') return 'Perception';
  return 'Statistic';
}

function attributeDescription(name: string): { title: string; description: string } | null {
  const descriptions: Record<string, string> = {
    ATTRIBUTE_STR:
      'Strength measures your character’s physical power. Strength is important if your character plans to engage in hand-to-hand combat. Your Strength modifier gets added to melee damage rolls and determines how much your character can carry.',
    ATTRIBUTE_DEX:
      'Dexterity measures your character’s agility, balance, and reflexes. Dexterity is important if your character plans to make attacks with ranged weapons or use stealth to surprise foes. Your Dexterity modifier is also added to your character’s AC and Reflex saving throws.',
    ATTRIBUTE_CON:
      'Constitution measures your character’s health and stamina. Constitution is important for all characters, especially those who fight in close range. Your Constitution modifier is added to your Hit Points and Fortitude saving throws.',
    ATTRIBUTE_INT:
      'Intelligence measures how well your character can learn and reason. A high Intelligence allows your character to analyze situations and understand patterns, and it means they can become trained in additional skills and might be able to master additional languages.',
    ATTRIBUTE_WIS:
      'Wisdom measures your character’s common sense, awareness, and intuition. High Wisdom helps your character detect hidden things and resist mental effects. Your Wisdom modifier is added to your Perception and Will saving throws.',
    ATTRIBUTE_CHA:
      'Charisma measures your character’s personal magnetism and strength of personality. A high Charisma modifier helps you build relationships and influence the thoughts and moods of others with social skills.',
  };
  const description = descriptions[name];
  if (!description) return null;
  const title = name.replace(/^ATTRIBUTE_/, '');
  const labels: Record<string, string> = {
    STR: 'Strength',
    DEX: 'Dexterity',
    CON: 'Constitution',
    INT: 'Intelligence',
    WIS: 'Wisdom',
    CHA: 'Charisma',
  };
  return { title: labels[title] ?? title, description };
}

async function traitNamesFor(traits: unknown): Promise<string[]> {
  if (!Array.isArray(traits) || traits.length === 0) return [];
  const ids = traits.filter((id): id is number => typeof id === 'number');
  const cached = new Map(getCachedContent<Trait>('trait').map((trait) => [trait.id, trait]));
  const records = await Promise.all(
    ids.map(async (id) => cached.get(id) ?? (await fetchContentById<Trait>('trait', id)))
  );
  return records.filter((trait): trait is Trait => Boolean(trait)).map((trait) => trait.name);
}

function formatPrice(item: Item) {
  if (!item.price) return null;
  const label = priceToString({
    cp: Number(item.price.cp) || undefined,
    sp: Number(item.price.sp) || undefined,
    gp: Number(item.price.gp) || undefined,
    pp: Number(item.price.pp) || undefined,
  });
  return label === '—' ? null : label;
}

function formatDamage(item: Item) {
  const damage = item.meta_data?.damage;
  if (!damage) return null;
  const dice = damage.dice != null && damage.die ? `${damage.dice}${damage.die}` : damage.die ?? null;
  const type = damage.damageType?.replace(/_/g, ' ') ?? null;
  const extra = damage.extra?.trim() || null;
  const parts = [dice, type, extra].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <strong className='mr-2 text-p1-text'>{label}</strong>
      <span className='text-p1-muted'>{value}</span>
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className='border border-p1-border bg-p1-hover px-2 py-0.5 text-[10px] uppercase text-p1-muted'>{children}</span>;
}
