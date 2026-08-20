import { getPublicUser } from '@auth/user-manager';
import { fetchContentSources } from '@content/content-store';
import type { Character, ContentSource } from '@schemas/content';
import type { SetterOrUpdater } from '@utils/type-fixing';
import { useQuery } from '@tanstack/react-query';
import { uniq } from 'lodash-es';
import { createPortal } from 'react-dom';
import {
  Archive,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Compass,
  Ellipsis,
  Globe,
  Hammer,
  Hexagon,
  Layers,
  Map,
  Server,
  Settings,
  X,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { OLD_UI_ORIGIN } from '../phase-switch/PhaseViewSwitch';

type HomeTab = 'books' | 'homebrew' | 'variants' | 'options';

const HOME_TABS: { id: HomeTab; label: string; icon: ReactNode }[] = [
  { id: 'books', label: 'Books', icon: <BookOpen size={14} /> },
  { id: 'homebrew', label: 'Homebrew', icon: <Layers size={14} /> },
  { id: 'variants', label: 'Variant Rules', icon: <Hammer size={14} /> },
  { id: 'options', label: 'Options', icon: <Settings size={14} /> },
];

const BOOK_GROUPS: { key: string; label: string; icon: ReactNode }[] = [
  { key: 'pathfinder-core', label: 'Pathfinder Core', icon: <BookOpen size={16} /> },
  { key: 'starfinder-core', label: 'Starfinder Core', icon: <Server size={16} /> },
  { key: 'adventure-path', label: 'Adventure Paths', icon: <Map size={16} /> },
  { key: 'standalone-adventure', label: 'Standalone Adventures', icon: <Compass size={16} /> },
  { key: 'lost-omens', label: 'Lost Omens', icon: <Globe size={16} /> },
  { key: 'legacy', label: 'Core Backports', icon: <Archive size={16} /> },
  { key: 'playtest', label: 'Playtest', icon: <Hexagon size={16} /> },
  { key: 'misc', label: 'Miscellaneous', icon: <Ellipsis size={16} /> },
];

const VARIANT_TOGGLES: { key: keyof NonNullable<Character['variants']>; label: string; info: string; url?: string }[] = [
  {
    key: 'ancestry_paragon',
    label: 'Ancestry Paragon',
    url: 'https://2e.aonprd.com/Rules.aspx?ID=1336',
    info: 'Most characters have some elements that connect them to their ancestry but identify more strongly with their class or unique personality. Sometimes, though, a character is the embodiment of their ancestry to the point that it’s of equal importance to their class. For a game where an ancestral background is a major theme and such characters are the norm, your group might consider using the ancestry paragon variant.',
  },
  {
    key: 'automatic_bonus_progression',
    label: 'Automatic Bonus Progression',
    url: 'https://2e.aonprd.com/Rules.aspx?ID=2741',
    info: 'This variant removes the item bonus to rolls and DCs usually provided by magic items (with the exception of armor’s item bonus) and replaces it with a new kind of bonus — potency — to reflect a character’s innate ability. In this variant, magic items, if they exist at all, can provide unique special abilities rather than numerical increases.',
  },
  {
    key: 'dual_class',
    label: 'Dual Class',
    url: 'https://2e.aonprd.com/Rules.aspx?ID=1328',
    info: 'Sometimes, especially when you have a particularly small play group or want to play incredibly versatile characters, you might want to allow dual-class characters that have the full benefits of two different classes.',
  },
  {
    key: 'free_archetype',
    label: 'Free Archetype',
    url: 'https://2e.aonprd.com/Rules.aspx?ID=2751',
    info: 'Sometimes the story of your game calls for a group where everyone is a pirate or an apprentice at a magic school. The free archetype variant introduces a shared aspect to every character without taking away any of that character’s existing choices.',
  },
  {
    key: 'gradual_attribute_boosts',
    label: 'Gradual Ability Boosts',
    url: 'https://2e.aonprd.com/Rules.aspx?ID=1300',
    info: 'In this variant, a character gains attribute boosts more gradually as they level up, rather than receiving four attribute boosts at 5th, 10th, 15th, and 20th levels. Each character gains one attribute boost when they reach each of 2nd, 3rd, 4th, and 5th levels. These are collectively a single set of attribute boosts, so a character can’t boost the same attribute more than once per set. PCs also receive an attribute boost at 7th–10th, 12th–15th, and 17th–20th level.',
  },
  {
    key: 'proficiency_without_level',
    label: 'Proficiency Without Level',
    url: 'https://2e.aonprd.com/Rules.aspx?ID=2762',
    info: 'This variant removes a character’s level from their proficiency bonus, scaling it differently for a style of game that’s outside the norm. This is a significant change to the system, better suited to grit than heroic rise-from-humble-origins play.',
  },
  {
    key: 'stamina',
    label: 'Stamina',
    info: 'In some fantasy stories, the heroes avoid serious injury until the situation gets dire, getting by with a graze or a flesh wound and needing nothing more than a quick rest to get back on their feet. The stamina variant supports that style.',
  },
];

const OPTION_TOGGLES: { key: keyof NonNullable<Character['options']>; label: string; info: string }[] = [
  {
    key: 'alternate_ancestry_boosts',
    label: 'Alternate Ancestry Boosts',
    info: 'You can replace your ancestry’s listed attribute boosts and flaws entirely and instead select two free attribute boosts when creating your character.',
  },
  {
    key: 'auto_detect_prerequisites',
    label: 'Auto Detect Prerequisites',
    info: '[Beta] Automatically determine if a feat or feature has its prerequisites met. This may not always work correctly.',
  },
  {
    key: 'dice_roller',
    label: 'Dice Roller',
    info: 'Roll dice directly from the character sheet, using your character’s stats and abilities.',
  },
  {
    key: 'ignore_bulk_limit',
    label: 'Ignore Bulk Limit',
    info: 'Disables the negative effects of carrying too much bulk, such as adding the encumbered condition.',
  },
  {
    key: 'organized_play',
    label: 'Organized Play',
    info: 'Paizo Organized Play is a worldwide roleplaying organization where players can take the same character to games around the globe.',
  },
  {
    key: 'is_public',
    label: 'Public Character',
    info: 'Makes your character public and viewable by anyone with your sheet link.',
  },
  {
    key: 'voluntary_flaws',
    label: 'Voluntary Flaw',
    info: 'You can elect to take an additional attribute flaw when applying the attribute boosts and flaws from your ancestry.',
  },
  {
    key: 'custom_operations',
    label: 'Custom Operations',
    info: 'Enables an area to add custom operations to your character. These are executed before most other operations.',
  },
];

export function Phase1BuilderHomeFields({
  character,
  setCharacter,
}: {
  character: Character;
  setCharacter: SetterOrUpdater<Character | null>;
}) {
  const [tab, setTab] = useState<HomeTab>('books');
  const books = useQuery({
    queryKey: ['phase1-builder-books'],
    queryFn: async () => (await fetchContentSources('ALL-OFFICIAL-PUBLIC')).filter((book) => book.deprecated !== true),
  });
  const user = useQuery({
    queryKey: ['phase1-builder-user'],
    queryFn: () => getPublicUser(),
  });
  const enabled = character.content_sources?.enabled ?? [];

  function toggleBooks(ids: number[], next: boolean) {
    setCharacter((prev) => {
      if (!prev) return prev;
      const current = prev.content_sources?.enabled ?? [];
      return {
        ...prev,
        content_sources: {
          ...prev.content_sources,
          enabled: next ? uniq([...current, ...ids]) : current.filter((id) => !ids.includes(id)),
        },
      };
    });
  }

  return (
    <div className='border border-p1-border bg-p1-inset'>
      <div className='flex flex-wrap gap-1 border-b border-p1-border px-2 py-2'>
        {HOME_TABS.map((item) => (
          <button
            key={item.id}
            type='button'
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs ${tab === item.id ? 'bg-p1-hover text-p1-text' : 'text-p1-muted hover:bg-p1-hover hover:text-p1-text'}`}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
      <div className={tab === 'books' || tab === 'homebrew' ? 'max-h-[min(70vh,720px)] overflow-y-auto' : ''}>
        {tab === 'books' && (
          <BooksPanel
            books={books.data ?? []}
            loading={books.isLoading}
            enabled={enabled}
            onToggle={(id, next) => toggleBooks([id], next)}
            onEnableAll={(ids) => toggleBooks(ids, true)}
          />
        )}
        {tab === 'homebrew' && (
          <HomebrewPanel
            sources={user.data?.subscribed_content_sources ?? []}
            loading={user.isLoading}
            enabled={enabled}
            onToggle={(id, next) => toggleBooks([id], next)}
          />
        )}
        {tab === 'variants' && (
          <ToggleList
            items={VARIANT_TOGGLES.map((item) => ({
              key: item.key,
              label: item.label,
              info: item.info,
              url: item.url,
              enabled: Boolean(character.variants?.[item.key]),
              onChange: (next) =>
                setCharacter((prev) => (prev ? { ...prev, variants: { ...prev.variants, [item.key]: next } } : prev)),
            }))}
          />
        )}
        {tab === 'options' && (
          <ToggleList
            items={OPTION_TOGGLES.map((item) => ({
              key: item.key,
              label: item.label,
              info: item.info,
              enabled: Boolean(character.options?.[item.key]),
              onChange: (next) =>
                setCharacter((prev) => (prev ? { ...prev, options: { ...prev.options, [item.key]: next } } : prev)),
            }))}
          />
        )}
      </div>
    </div>
  );
}

export function Phase1BuilderSettings({
  character,
  setCharacter,
  onClose,
}: {
  character: Character;
  setCharacter: SetterOrUpdater<Character | null>;
  onClose: () => void;
}) {
  return createPortal(
    <div className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5' role='presentation' onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role='dialog' aria-modal='true' aria-labelledby='builder-settings-title' className='flex max-h-[min(86vh,720px)] w-full max-w-lg flex-col border border-p1-border bg-p1-surface'>
        <header className='flex items-center justify-between border-b border-p1-border px-4 py-3'>
          <h2 id='builder-settings-title' className='text-lg font-semibold'>Sources & variants</h2>
          <button type='button' className='icon-button' onClick={onClose} title='Close'>
            <X size={16} />
          </button>
        </header>
        <div className='min-h-0 flex-1 overflow-y-auto p-4'>
          <Phase1BuilderHomeFields character={character} setCharacter={setCharacter} />
        </div>
      </section>
    </div>,
    document.body
  );
}

function BooksPanel({
  books,
  loading,
  enabled,
  onToggle,
  onEnableAll,
}: {
  books: ContentSource[];
  loading: boolean;
  enabled: number[];
  onToggle: (id: number, next: boolean) => void;
  onEnableAll: (ids: number[]) => void;
}) {
  if (loading) return <p className='px-4 py-8 text-center text-sm italic text-p1-faint'>Loading books...</p>;
  return (
    <div className='py-1'>
      {BOOK_GROUPS.map((group, index) => {
        const groupBooks = books.filter((book) => book.group === group.key);
        if (groupBooks.length === 0) return null;
        return (
          <div key={group.key}>
            {index > 0 && <div className='mx-4 my-2 border-t border-p1-border' />}
            <BookGroup
              label={group.label}
              icon={group.icon}
              books={groupBooks}
              enabled={enabled}
              onToggle={onToggle}
              onEnableAll={() => onEnableAll(groupBooks.map((book) => book.id))}
            />
          </div>
        );
      })}
    </div>
  );
}

function HomebrewPanel({
  sources,
  loading,
  enabled,
  onToggle,
}: {
  sources: { source_id: number; source_name: string }[];
  loading: boolean;
  enabled: number[];
  onToggle: (id: number, next: boolean) => void;
}) {
  if (loading) return <p className='px-4 py-8 text-center text-sm italic text-p1-faint'>Loading homebrew...</p>;
  if (sources.length === 0) {
    return (
      <p className='px-4 py-8 text-center text-sm italic text-p1-faint'>
        No subscribed bundles found.{' '}
        <a className='text-p1-accent hover:underline' href={`${OLD_UI_ORIGIN}/homebrew`} target='_blank' rel='noreferrer'>
          Go add some!
        </a>
      </p>
    );
  }
  return (
    <ul className='py-1'>
      {sources.map((source) => (
        <li key={source.source_id}>
          <label className='flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-p1-hover'>
            <input type='checkbox' checked={enabled.includes(source.source_id)} onChange={(event) => onToggle(source.source_id, event.target.checked)} />
            <span className='text-sm'>{source.source_name}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function BookGroup({
  label,
  icon,
  books,
  enabled,
  onToggle,
  onEnableAll,
}: {
  label: string;
  icon: ReactNode;
  books: ContentSource[];
  enabled: number[];
  onToggle: (id: number, next: boolean) => void;
  onEnableAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const enabledCount = books.filter((book) => enabled.includes(book.id)).length;
  const sorted = useMemo(
    () =>
      [...books].sort((a, b) => {
        if (a.name.includes('(') && !b.name.includes('(')) return 1;
        if (b.name.includes('(') && !a.name.includes('(')) return -1;
        return a.name.localeCompare(b.name);
      }),
    [books]
  );

  return (
    <div>
      <button type='button' className='flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-p1-hover' onClick={() => setOpen((value) => !value)}>
        <span className='text-p1-muted'>{icon}</span>
        <span className='min-w-0 flex-1 font-medium'>{label}</span>
        <span className='text-xs text-p1-faint'>
          {enabledCount}/{books.length}
        </span>
        {open ? <ChevronDown size={14} className='text-p1-faint' /> : <ChevronRight size={14} className='text-p1-faint' />}
      </button>
      {open && (
        <div className='pb-2'>
          <div className='px-4 pb-2'>
            <button type='button' className='text-xs text-p1-accent hover:underline' onClick={(event) => { event.preventDefault(); event.stopPropagation(); onEnableAll(); }}>
              Enable all
            </button>
          </div>
          <ul className='grid grid-cols-1 gap-x-2 sm:grid-cols-2'>
            {sorted.map((book) => (
              <li key={book.id}>
                <label className='flex cursor-pointer items-center gap-2 px-8 py-1.5 text-sm hover:bg-p1-hover' onClick={(event) => event.stopPropagation()}>
                  <input type='checkbox' checked={enabled.includes(book.id)} onChange={(event) => onToggle(book.id, event.target.checked)} onClick={(event) => event.stopPropagation()} />
                  {book.name}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ToggleList({
  items,
}: {
  items: { key: string; label: string; info: string; url?: string; enabled: boolean; onChange: (next: boolean) => void }[];
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openItem = items.find((item) => item.key === openKey) ?? null;

  return (
    <>
      <ul className='py-1'>
        {items.map((item) => (
          <li key={item.key}>
            <div className='group relative flex items-start gap-3 px-4 py-2.5 hover:bg-p1-hover'>
              <label className='flex min-w-0 flex-1 cursor-pointer items-start gap-3'>
                <input className='mt-1' type='checkbox' checked={item.enabled} onChange={(event) => item.onChange(event.target.checked)} />
                <span className='text-sm'>{item.label}</span>
              </label>
              <button
                type='button'
                className='mt-0.5 shrink-0 text-p1-faint hover:text-p1-accent'
                title={item.info}
                aria-label={`About ${item.label}`}
                onClick={() => setOpenKey(item.key)}
              >
                <CircleHelp size={15} />
              </button>
              <div className='pointer-events-none absolute right-4 top-full z-30 hidden w-[min(22rem,calc(100%-2rem))] border border-p1-border bg-p1-surface p-3 text-xs leading-5 text-p1-muted shadow-lg group-hover:block'>
                {item.info}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {openItem && (
        <div className='fixed inset-0 z-[110] grid place-items-center bg-black/75 p-5' onMouseDown={(event) => { if (event.target === event.currentTarget) setOpenKey(null); }}>
          <section className='w-full max-w-lg border border-p1-border bg-p1-surface p-5'>
            <div className='flex items-start justify-between gap-3'>
              <h2 className='text-lg font-semibold'>{openItem.label}</h2>
              <button type='button' className='icon-button' title='Close' onClick={() => setOpenKey(null)}>
                <X size={16} />
              </button>
            </div>
            <p className='mt-3 whitespace-pre-wrap text-sm leading-6 text-p1-muted'>{openItem.info}</p>
            {openItem.url && (
              <a className='mt-4 inline-block text-sm text-p1-accent hover:underline' href={openItem.url} target='_blank' rel='noreferrer'>
                Open rules reference
              </a>
            )}
          </section>
        </div>
      )}
    </>
  );
}
