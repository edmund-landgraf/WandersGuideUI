import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Calculator, ChevronDown, History, ListChecks, X } from 'lucide-react';
import { isContentStackOpen, useContentLinks } from './phase1-content-links';
import { ProseMarkdown } from './phase1-markdown';
import type { Phase1EntityCombatant } from './phase1-entity';
import type { Character, ContentPackage, Creature } from '@schemas/content';
import {
  loadStatFromStore,
  loadStatTarget,
  statCalculationPreview,
  type Phase1ActiveGroup,
  type Phase1AttributeTable,
  type Phase1Breakdown,
  type Phase1StatDetail,
  type Phase1StatItem,
  type Phase1StatKey,
  type Phase1StatTarget,
} from './phase1-stat-details';
import type { Phase1SkillTimelineItem } from './phase1-skills';
import { toLabel } from '@utils/strings';

export type { Phase1StatKey, Phase1StatTarget };
export { statCalculationPreview };

export function StatDetailModal({
  combatant,
  storeId,
  entity,
  content,
  stat,
  onClose,
}: {
  combatant?: Phase1EntityCombatant;
  storeId?: string;
  entity?: Character | Creature;
  content?: ContentPackage;
  stat: Phase1StatTarget;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const details = useQuery({
    queryKey: [
      'phase1-stat-target',
      storeId ?? 'isolated-store',
      combatant?.type,
      combatant?._id,
      JSON.stringify(stat),
      JSON.stringify(combatant?.data.details?.conditions ?? []),
      JSON.stringify(combatant?.data.inventory ?? entity?.inventory ?? null),
    ],
    queryFn: () => {
      if (storeId && entity && content) return Promise.resolve(loadStatFromStore(storeId, stat, entity, content));
      if (combatant) return loadStatTarget(combatant, stat);
      throw new Error('Missing character details for this statistic.');
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isContentStackOpen()) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const detail = details.data;

  return createPortal(
    <div
      data-entity-modal
      className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-labelledby='stat-detail-title'
        className='flex h-[min(82vh,720px)] w-full max-w-4xl flex-col border border-p1-border bg-p1-surface shadow-2xl'
      >
        <header className='flex items-start gap-4 border-b border-p1-border px-5 py-4'>
          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <h2 id='stat-detail-title' className='text-xl font-semibold'>
                {detail?.title ?? fallbackTitle(stat)}
              </h2>
              {detail?.badge && (
                <span className='border border-p1-border bg-p1-hover px-2.5 py-0.5 text-xs font-medium text-p1-text'>
                  {detail.badge}
                </span>
              )}
            </div>
          </div>
          <button ref={closeRef} type='button' className='icon-button shrink-0' onClick={onClose} title='Close'>
            <X size={18} />
          </button>
        </header>
        {details.isLoading && <p className='px-5 py-4 text-sm text-p1-muted'>Loading details...</p>}
        {details.isError && <p className='px-5 py-4 text-sm text-p1-danger-soft'>{details.error instanceof Error ? details.error.message : 'Could not load these details.'}</p>}
        {detail && <StatDetailBody detail={detail} />}
      </section>
    </div>,
    document.body
  );
}

type StatModalTab = 'description' | 'breakdown' | 'timeline' | 'details';
const STAT_MODAL_TABS: Array<{ id: StatModalTab; label: string; icon: ReactNode }> = [
  { id: 'description', label: 'Description', icon: <BookOpen size={15} /> },
  { id: 'breakdown', label: 'Breakdown', icon: <Calculator size={15} /> },
  { id: 'timeline', label: 'Timeline', icon: <History size={15} /> },
  { id: 'details', label: 'Details', icon: <ListChecks size={15} /> },
];

function StatDetailBody({ detail }: { detail: Phase1StatDetail }) {
  const breakdowns = detail.sections.filter((section) => section.breakdown);
  const timelines = detail.sections.filter((section) => section.timeline?.length);
  const extraSections = detail.sections.filter((section) => section.groups || section.items || (section.description && section.id !== 'description' && !section.breakdown && !section.timeline));
  const hasDetails = Boolean(detail.table || detail.groups?.length || extraSections.length);
  const description = detail.sections.find((section) => section.id === 'description')?.description ?? detail.description;
  const defaultTab: StatModalTab = breakdowns.length ? 'breakdown' : timelines.length ? 'timeline' : hasDetails ? 'details' : 'description';
  const [tab, setTab] = useState<StatModalTab>(defaultTab);

  return (
    <>
      <div className='grid grid-cols-4 border-b border-p1-border bg-p1-inset' role='tablist' aria-label='Statistic details'>
        {STAT_MODAL_TABS.map((item) => (
          <button
            key={item.id}
            type='button'
            role='tab'
            aria-selected={tab === item.id}
            className={`flex h-11 items-center justify-center gap-2 border-b-2 px-3 text-xs ${tab === item.id ? 'border-p1-accent bg-p1-hover text-p1-accent-soft' : 'border-transparent text-p1-muted hover:text-p1-text'}`}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto p-5'>
        {tab === 'description' && (
          description ? <div className='mx-auto max-w-3xl'><ProseMarkdown>{description}</ProseMarkdown></div> : <p className='text-center text-sm italic text-p1-muted'>No description found.</p>
        )}
        {tab === 'breakdown' && (
          breakdowns.length
            ? <div className='mx-auto max-w-3xl space-y-6'>{breakdowns.map((section) => <BreakdownView key={section.id} breakdown={section.breakdown!} />)}</div>
            : <p className='text-center text-sm italic text-p1-muted'>No recorded breakdown for this value.</p>
        )}
        {tab === 'timeline' && (
          timelines.length
            ? <div className='mx-auto max-w-2xl space-y-6'>{timelines.map((section) => (
              <div key={section.id}>
                {timelines.length > 1 && <h3 className='mb-3 text-sm font-semibold text-p1-text'>{section.label}</h3>}
                <TimelineView timeline={section.timeline!} />
              </div>
            ))}</div>
            : <p className='text-center text-sm italic text-p1-muted'>No recorded history found for this value.</p>
        )}
        {tab === 'details' && (
          hasDetails
            ? <div className='space-y-3'>
                {detail.table && <AttributeTable table={detail.table} />}
                {detail.groups?.map((group) => <ActiveGroupCard key={group.id} group={group} />)}
                {extraSections.map((section) => (
                  <section key={section.id} className='border border-p1-border bg-p1-inset p-3'>
                    <h3 className='mb-2 text-sm font-semibold text-p1-text'>{section.label}{section.value ? <span className='ml-2 font-medium text-p1-muted'>{section.value}</span> : null}</h3>
                    {section.groups?.map((group) => <ActiveGroupCard key={group.id} group={group} />)}
                    {section.items && <ItemList items={section.items} empty={`No ${section.label.toLowerCase()} found.`} />}
                    {section.description && <ProseMarkdown className='text-[13px] leading-6'>{section.description}</ProseMarkdown>}
                  </section>
                ))}
              </div>
            : <p className='text-center text-sm italic text-p1-muted'>No extra details for this value.</p>
        )}
      </div>
    </>
  );
}

const HOVER_CARD_CLASS = 'pointer-events-none invisible absolute z-40 hidden border border-p1-border bg-p1-surface p-3 opacity-0 shadow-xl transition-opacity delay-300 group-hover:visible group-hover:opacity-100 md:block';

export function StatHoverCard({
  breakdown,
  timeline,
  placement = 'end',
}: {
  breakdown?: Phase1Breakdown;
  timeline?: Phase1SkillTimelineItem[];
  placement?: 'end' | 'below';
}) {
  const events = (timeline ?? []).slice(0, 6);
  if (!breakdown && !events.length) return null;
  return (
    <span className={`${HOVER_CARD_CLASS} ${placement === 'below' ? 'left-1/2 top-full mt-1 w-72 -translate-x-1/2' : 'left-full top-0 ml-2 w-72'}`}>
      {breakdown && (
        <span className='mb-2 flex flex-wrap items-center gap-1 text-[11px]'>
          {breakdown.infix ? (
            breakdown.infix.map((part, index) =>
              part.kind === 'text' ? (
                <span key={index} className='text-p1-text'>{part.text}</span>
              ) : (
                <span key={index} className='border border-p1-border bg-p1-hover px-1.5 py-0.5 font-mono text-p1-text' title={breakdown.terms[part.index]?.label}>
                  {breakdown.terms[part.index]?.value}
                </span>
              )
            )
          ) : (
            <>
              <strong className='mr-1 text-p1-text'>{breakdown.finalLabel} =</strong>
              {breakdown.prefix && <span className='text-p1-muted'>{breakdown.prefix}</span>}
              {breakdown.terms.map((term, index) => (
                <span key={`${term.label}-${index}`} className='inline-flex items-center gap-1'>
                  {index > 0 && <span className='text-p1-faint'>{term.value >= 0 ? '+' : '-'}</span>}
                  <span className='border border-p1-border bg-p1-hover px-1.5 py-0.5 font-mono text-p1-text' title={term.label}>{Math.abs(term.value)}</span>
                </span>
              ))}
            </>
          )}
        </span>
      )}
      {events.length > 0 && (
        <ol className='space-y-1.5'>
          {events.map((item, index) => (
            <li key={`${item.timestamp}-${index}`}>
              <strong className='block text-[11px] text-p1-text'>{item.title}</strong>
              <span className='block text-[10px] italic text-p1-muted'>{item.description}</span>
            </li>
          ))}
        </ol>
      )}
    </span>
  );
}

function AttributeTable({ table }: { table: Phase1AttributeTable }) {
  return (
    <div className='overflow-x-auto border border-p1-border'>
      <table className='w-full min-w-[28rem] border-collapse text-center text-xs'>
        <thead>
          <tr className='border-b border-p1-border bg-p1-inset'>
            {table.columns.map((column) => (
              <th key={column} className='px-2 py-2 font-semibold text-p1-text'>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.source} className='border-b border-p1-border' title={`From ${row.source}`}>
              {row.values.map((value, index) => (
                <td key={`${row.source}-${index}`} className='px-2 py-1.5 text-p1-text'>
                  {value === 'partial' ? '–' : value == null ? '' : signed(value)}
                </td>
              ))}
            </tr>
          ))}
          {table.rows.length === 0 && (
            <tr>
              <td colSpan={table.columns.length} className='px-2 py-4 italic text-p1-muted'>No recorded attribute boosts.</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className='border-t border-p1-border bg-p1-inset'>
            {table.totals.map((total, index) => (
              <td key={table.columns[index]} className='px-2 py-2 font-semibold text-p1-text'>
                = <span className={total.partial ? 'underline decoration-p1-accent underline-offset-2' : undefined}>{signed(total.value)}</span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ActiveGroupCard({ group }: { group: Phase1ActiveGroup }) {
  return (
    <div className='border border-p1-border bg-p1-surface p-2'>
      <h3 className='px-1 pb-2 text-sm font-semibold text-p1-text'>{group.label}</h3>
      <div className='space-y-1'>
        {group.description && (
          <NestedCard label='Description'>
            <ProseMarkdown className='text-[13px] leading-6'>{group.description}</ProseMarkdown>
          </NestedCard>
        )}
        <NestedCard label='Active' badge={group.items.length} defaultOpen>
          <ItemList items={group.items} empty={group.emptyText} />
        </NestedCard>
      </div>
    </div>
  );
}

function NestedCard({ icon, label, badge, defaultOpen = false, children }: { icon?: ReactNode; label: string; badge?: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className='border border-p1-border bg-p1-surface'>
      <button
        type='button'
        aria-expanded={open}
        className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-p1-hover'
        onClick={() => setOpen((value) => !value)}
      >
        {icon ? <span className='text-p1-muted'>{icon}</span> : null}
        <span className='min-w-0 flex-1 font-medium text-p1-text'>{label}</span>
        {badge != null && (
          <span className='grid h-5 min-w-5 place-items-center rounded-full border border-p1-border px-1.5 text-[10px] font-semibold text-p1-text'>
            {badge}
          </span>
        )}
        <ChevronDown size={14} className={`text-p1-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className='border-t border-p1-border px-3 py-3'>{children}</div>}
    </section>
  );
}

function BreakdownView({ breakdown }: { breakdown: Phase1Breakdown }) {
  return (
    <div>
      <div className='mb-3 flex flex-wrap items-center gap-2 text-sm'>
        {breakdown.infix ? (
          breakdown.infix.map((part, index) =>
            part.kind === 'text' ? (
              <span key={index} className='text-p1-text'>{part.text}</span>
            ) : (
              <TermBox key={index} term={breakdown.terms[part.index]} />
            )
          )
        ) : (
          <>
            <strong className='mr-1 text-p1-text'>{breakdown.finalLabel} =</strong>
            {breakdown.prefix && <span className='text-p1-text'>{breakdown.prefix}</span>}
            {breakdown.terms.map((term, index) => (
              <span key={`${term.label}-${index}`} className='inline-flex items-center gap-2'>
                {index > 0 && <span className='text-p1-faint'>{term.value >= 0 ? '+' : '-'}</span>}
                <TermBox term={term} absolute={index > 0} />
              </span>
            ))}
          </>
        )}
      </div>
      <div className='grid grid-cols-1 gap-2'>
        {breakdown.terms.map((term, index) => (
          <section key={`${term.label}-detail-${index}`} className='border border-p1-border bg-p1-inset p-3'>
            <div className='flex items-center gap-3'>
              <strong className='text-sm text-p1-text'>{term.label}</strong>
              <span className='ml-auto font-mono text-sm text-p1-accent-soft'>{signed(term.value)}</span>
            </div>
            <p className='mt-2 text-xs leading-5 text-p1-muted'>{term.detail}</p>
            {term.sources?.map((source, sourceIndex) => (
              <p key={sourceIndex} className='mt-1 text-[11px] text-p1-faint'>
                {signed(source.amount)} from {source.source}
              </p>
            ))}
          </section>
        ))}
      </div>
      {breakdown.conditionals.length > 0 && (
        <section className='mt-3 border border-p1-accent/30 bg-p1-accent/[0.07] p-3'>
          <h3 className='text-xs font-semibold uppercase text-p1-accent-soft'>Situational modifiers</h3>
          {breakdown.conditionals.map((item, index) => (
            <p key={index} className='mt-2 text-xs leading-5 text-p1-text'>
              {item.text} <span className='text-p1-faint'>from {item.source}</span>
            </p>
          ))}
        </section>
      )}
    </div>
  );
}

function TermBox({ term, absolute = false }: { term: Phase1Breakdown['terms'][number] | undefined; absolute?: boolean }) {
  if (!term) return null;
  const value = absolute ? Math.abs(term.value) : term.value;
  return (
    <span className='border border-p1-border bg-p1-hover px-2 py-0.5 font-mono text-p1-text' title={term.label}>
      {value}
    </span>
  );
}

function TimelineView({ timeline }: { timeline: Phase1SkillTimelineItem[] }) {
  if (!timeline.length) return <p className='text-sm italic text-p1-muted'>No recorded history found for this value.</p>;
  return (
    <ol>
      {timeline.map((item, index) => (
        <li key={`${item.timestamp}-${index}`} className='grid grid-cols-[28px_minmax(0,1fr)]'>
          <span className='relative flex justify-center'>
            <span className={`z-10 mt-1.5 h-3 w-3 border ${item.type === 'ADJUSTMENT' ? 'border-p1-accent bg-p1-accent' : 'border-p1-pc bg-p1-pc'}`} />
            {index < timeline.length - 1 && <span className='absolute bottom-0 top-4 w-px bg-p1-hover' />}
          </span>
          <div className='pb-5'>
            <strong className='text-sm text-p1-text'>{item.title}</strong>
            <p className='mt-1 text-xs italic text-p1-muted'>{item.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ItemList({ items, empty }: { items: Phase1StatItem[]; empty: string }) {
  const { open } = useContentLinks();
  if (!items.length) return <p className='text-sm italic text-p1-muted'>{empty}</p>;
  return (
    <ul className='list-disc space-y-1 pl-5'>
      {items.map((item, index) => (
        <li key={`${item.name}-${index}`} className='text-sm'>
          {item.href ? (
            <button type='button' className='text-p1-pc underline decoration-p1-pc/70 underline-offset-2 hover:text-p1-pc' onClick={() => open(item.href!)}>
              {item.name}
            </button>
          ) : (
            <span className='text-p1-pc'>{item.name}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function fallbackTitle(stat: Phase1StatTarget) {
  if (typeof stat === 'object') return toLabel(stat.variableName);
  if (stat === 'hp') return 'Hit Points';
  if (stat === 'resist') return 'Resistances & Weaknesses';
  if (stat === 'ac') return 'Armor Class';
  if (stat === 'classDc') return 'Class DC';
  return stat.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function signed(value: number) {
  return value >= 0 ? `+${value}` : String(value);
}
