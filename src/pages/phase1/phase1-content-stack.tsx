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
        className={`flex max-h-[min(82vh,820px)] w-full flex-col border border-white/15 bg-[#11171a] shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}
      >
        <header className='flex items-start gap-4 border-b border-white/10 px-5 py-4'>
          <div className='min-w-0 flex-1'>
            {content.isLoading && <h2 id='content-stack-title' className='text-xl font-semibold leading-tight text-[#89949a]'>Loading...</h2>}
            {content.isError && <h2 id='content-stack-title' className='text-xl font-semibold leading-tight'>Couldn't open this link</h2>}
            {loaded && (
              <>
                <div className='flex items-center gap-2'>
                  {loaded.actions != null && <ActionSymbol cost={loaded.actions} size='1.75rem' />}
                  <h2 id='content-stack-title' className='text-xl font-semibold leading-tight'>
                    {loaded.title}
                  </h2>
                  {loaded.subtitle && <span className='shrink-0 text-sm text-[#89949a]'>{loaded.subtitle}</span>}
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
            <p className='text-sm text-[#efaaa3]'>{content.error instanceof Error ? content.error.message : 'This record could not be loaded.'}</p>
          )}
          {loaded && (
            <>
              {loaded.facts.some((fact) => fact.value) && (
                <div className='mb-4 space-y-1 border-b border-white/10 pb-4 text-sm leading-6'>
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
    if (!condition) return null;
    return {
      title: condition.name,
      tags: ['Condition'],
      facts: [],
      description: condition.description,
    };
  }

  const id = Number(entry.id);
  if (!Number.isFinite(id)) return null;

  const contentType = convertToContentType(entry.type);
  const record = await fetchContentById<Record<string, unknown>>(contentType, id);
  if (!record) return null;

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
        <div className='mt-4 border-t border-white/10 pt-4'>
          <strong className='mr-2 text-[#e2e6e8]'>Special</strong>
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
        <div key={index} className='mt-4 border-t border-white/10 pt-4'>
          <strong className='mr-2 text-[#e2e6e8]'>Heightened ({heightened.amount})</strong>
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
      <strong className='mr-2 text-[#e2e6e8]'>{label}</strong>
      <span className='text-[#aeb7bc]'>{value}</span>
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className='border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase text-[#98a2a7]'>{children}</span>;
}
