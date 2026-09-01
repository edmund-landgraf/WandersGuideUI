import { getPublicUser } from '@auth/user-manager';
import { fetchContentSources, findRequiredContentSources } from '@content/content-store';
import type { Campaign, Character, ContentSource } from '@schemas/content';
import { isValidImage } from '@utils/images';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Compass,
  Ellipsis,
  ExternalLink,
  Globe,
  Hexagon,
  KeyRound,
  Map,
  RefreshCw,
  Server,
  Settings,
} from 'lucide-react';
import { cloneDeep, isEqual, uniq } from 'lodash-es';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { OLD_UI_ORIGIN } from '../phase-switch/PhaseViewSwitch';
import { Phase1OperationsModal } from './phase1-operations-modal';

type SettingsTab = 'books' | 'homebrew' | 'variants' | 'options';

type BookGroupDef = { key: string; label: string; icon: ReactNode };

const BOOK_GROUPS: BookGroupDef[] = [
  { key: 'pathfinder-core', label: 'Pathfinder Core', icon: <BookOpen size={16} /> },
  { key: 'starfinder-core', label: 'Starfinder Core', icon: <Server size={16} /> },
  { key: 'adventure-path', label: 'Adventure Paths', icon: <Map size={16} /> },
  { key: 'standalone-adventure', label: 'Standalone Adventures', icon: <Compass size={16} /> },
  { key: 'lost-omens', label: 'Lost Omens', icon: <Globe size={16} /> },
  { key: 'legacy', label: 'Core Backports', icon: <Archive size={16} /> },
  { key: 'playtest', label: 'Playtest', icon: <Hexagon size={16} /> },
  { key: 'misc', label: 'Miscellaneous', icon: <Ellipsis size={16} /> },
];

const VARIANT_RULES = [
  {
    key: 'ancestry_paragon' as const,
    label: 'Ancestry Paragon',
    info: 'Characters embody their ancestry as strongly as their class.',
    url: 'https://2e.aonprd.com/Rules.aspx?ID=1336',
  },
  {
    key: 'automatic_bonus_progression' as const,
    label: 'Automatic Bonus Progression',
    info: 'Replaces item bonuses with potency bonuses from character level.',
    url: 'https://2e.aonprd.com/Rules.aspx?ID=2741',
  },
  {
    key: 'dual_class' as const,
    label: 'Dual Class',
    info: 'Characters gain the full benefits of two different classes.',
    url: 'https://2e.aonprd.com/Rules.aspx?ID=1328',
  },
  {
    key: 'free_archetype' as const,
    label: 'Free Archetype',
    info: 'Every character receives a shared archetype without losing existing choices.',
    url: 'https://2e.aonprd.com/Rules.aspx?ID=2751',
  },
  {
    key: 'gradual_attribute_boosts' as const,
    label: 'Gradual Attribute Boosts',
    info: 'Attribute boosts are spread across levels instead of at 5/10/15/20.',
    url: 'https://2e.aonprd.com/Rules.aspx?ID=1300',
  },
  {
    key: 'proficiency_without_level' as const,
    label: 'Proficiency without Level',
    info: 'Removes level from proficiency bonus for grittier games.',
    url: 'https://2e.aonprd.com/Rules.aspx?ID=2762',
  },
];

const CHARACTER_OPTIONS = [
  { key: 'alternate_ancestry_boosts' as const, label: 'Alternate Ancestry Boosts', info: 'Replace ancestry boosts and flaws with two free boosts.' },
  { key: 'auto_detect_prerequisites' as const, label: 'Auto Detect Prerequisites', info: 'Beta: automatically check feat prerequisites.' },
  { key: 'dice_roller' as const, label: 'Dice Roller', info: 'Shows a dice roller on the character sheet (Phase 1 and original).' },
  { key: 'ignore_bulk_limit' as const, label: 'Ignore Bulk Limit', info: 'Disables encumbered effects from carrying too much bulk.' },
  { key: 'organized_play' as const, label: 'Organized Play', info: 'Paizo Organized Play campaign mode.' },
  { key: 'is_public' as const, label: 'Public Character', info: 'Characters are viewable by anyone with their sheet link.' },
  { key: 'voluntary_flaws' as const, label: 'Voluntary Flaw', info: 'Allow an additional attribute flaw when applying ancestry boosts.' },
  { key: 'custom_operations' as const, label: 'Custom Operations', info: 'Enable custom operations executed before most other operations.' },
];

export function SettingsSurface({
  campaign,
  players,
  onUpdateCampaign,
  onResetJoinKey,
  onKickPlayer,
  onDeleteCampaign,
  saving,
  error,
}: {
  campaign: Campaign;
  players: Character[];
  onUpdateCampaign: (next: Campaign) => void;
  onResetJoinKey: () => Promise<unknown>;
  onKickPlayer: (characterId: number) => Promise<unknown>;
  onDeleteCampaign: () => Promise<unknown>;
  saving?: boolean;
  error?: Error | null;
}) {
  const [tab, setTab] = useState<SettingsTab>('books');
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description ?? '');
  const [imageUrl, setImageUrl] = useState(campaign.meta_data?.image_url ?? '');
  const [imageValid, setImageValid] = useState(true);
  const [joinKeyVisible, setJoinKeyVisible] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [resettingKey, setResettingKey] = useState(false);
  const [kickMenuOpen, setKickMenuOpen] = useState(false);
  const [pendingKick, setPendingKick] = useState<Character | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [dependencyPrompt, setDependencyPrompt] = useState<{ sources: ContentSource[]; onEnable: () => void; onSkip: () => void } | null>(null);
  const [openedOperations, setOpenedOperations] = useState(false);

  useEffect(() => {
    setName(campaign.name);
    setDescription(campaign.description ?? '');
    setImageUrl(campaign.meta_data?.image_url ?? '');
  }, [campaign.id]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (name === campaign.name && description === (campaign.description ?? '') && imageUrl === (campaign.meta_data?.image_url ?? '')) return;
      onUpdateCampaign({
        ...campaign,
        name,
        description: description || null,
        meta_data: { ...campaign.meta_data, image_url: imageUrl || undefined },
      });
    }, 200);
    return () => window.clearTimeout(timeout);
    // Debounce text fields only; campaign snapshot is read at save time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, imageUrl]);

  useEffect(() => {
    if (copyState !== 'copied') return;
    const timeout = window.setTimeout(() => setCopyState('idle'), 2500);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const booksQuery = useQuery({
    queryKey: ['phase1-settings-books', campaign.id],
    queryFn: async () => (await fetchContentSources('ALL-OFFICIAL-PUBLIC')).filter((book) => book.deprecated !== true),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const userQuery = useQuery({
    queryKey: ['phase1-settings-user'],
    queryFn: () => getPublicUser(),
    staleTime: 60_000,
  });

  const enabledBookIds = campaign.recommended_content_sources?.enabled ?? [];
  const hasBookEnabled = (bookId: number) => enabledBookIds.includes(bookId);

  function patchCampaign(patch: Partial<Campaign>) {
    onUpdateCampaign({ ...campaign, ...patch });
  }

  function patchVariants(key: keyof NonNullable<Campaign['recommended_variants']>, enabled: boolean) {
    patchCampaign({ recommended_variants: { ...campaign.recommended_variants, [key]: enabled } });
  }

  function patchOptions(key: keyof NonNullable<Campaign['recommended_options']>, enabled: boolean) {
    patchCampaign({ recommended_options: { ...campaign.recommended_options, [key]: enabled } });
  }

  function setBooksEnabled(inputIds: number[], enabled: boolean) {
    const nextEnabled = enabled
      ? uniq([...enabledBookIds, ...inputIds])
      : enabledBookIds.filter((id) => !inputIds.includes(id));
    patchCampaign({ recommended_content_sources: { ...campaign.recommended_content_sources, enabled: nextEnabled } });
  }

  async function toggleBooks(inputIds: number[], enabled: boolean) {
    if (enabled) {
      const required = await findRequiredContentSources(uniq([...enabledBookIds, ...inputIds]));
      if (required.newSources.length > 0) {
        setDependencyPrompt({
          sources: required.newSources,
          onEnable: () => {
            setBooksEnabled([...inputIds, ...required.sourceIds], true);
            setDependencyPrompt(null);
          },
          onSkip: () => {
            setBooksEnabled(inputIds, true);
            setDependencyPrompt(null);
          },
        });
        return;
      }
    }
    setBooksEnabled(inputIds, enabled);
  }

  async function revealAndCopyJoinKey() {
    if (!campaign.join_key) return;
    setJoinKeyVisible(true);
    setCopyState((await copyToClipboard(campaign.join_key)) ? 'copied' : 'failed');
  }

  async function handleResetJoinKey() {
    setResettingKey(true);
    try {
      await onResetJoinKey();
      setJoinKeyVisible(true);
    } finally {
      setResettingKey(false);
    }
  }

  async function validateImageUrl(value: string) {
    const valid = value.trim() ? await isValidImage(value) : true;
    setImageValid(valid);
  }

  const partyStatus = campaign.meta_data?.settings?.show_party_member_status ?? 'STATUS';

  return (
    <>
      <div className='sticky top-0 z-10 border-b border-p1-border bg-p1-surface/95 px-5 py-4 backdrop-blur'>
        <SettingsEyebrow>Campaign settings</SettingsEyebrow>
        <h2 className='mt-1 truncate text-xl font-semibold'>Player defaults and game config</h2>
        <p className='mt-1 truncate text-xs text-p1-faint'>
          Recommended books, variants, and options for characters joining this campaign.
        </p>
        {error && <p className='mt-2 text-xs text-p1-danger-soft'>Save failed: {error.message}</p>}
        {saving && <p className='mt-2 text-xs text-p1-faint'>Saving...</p>}
      </div>
      <div className='p-5'>
        <div className='grid gap-5 xl:grid-cols-[minmax(0,1.85fr)_minmax(280px,1fr)]'>
          <section className='min-w-0 border border-p1-border bg-p1-inset'>
            <h3 className='border-b border-p1-border px-4 py-3 text-sm font-semibold'>Player Default Settings</h3>
            <div className='flex flex-wrap gap-1 border-b border-p1-border px-2 py-2'>
              {(
                [
                  ['books', 'Books'],
                  ['homebrew', 'Homebrew'],
                  ['variants', 'Variant Rules'],
                  ['options', 'Options'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type='button'
                  className={`px-3 py-1.5 text-xs ${tab === value ? 'bg-p1-hover text-p1-text' : 'text-p1-muted hover:bg-p1-hover hover:text-p1-text'}`}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className='max-h-[min(70vh,720px)] overflow-y-auto'>
              {tab === 'books' && (
                <BooksPanel
                  books={booksQuery.data ?? []}
                  loading={booksQuery.isLoading}
                  hasBookEnabled={hasBookEnabled}
                  onToggle={(id, enabled) => toggleBooks([id], enabled)}
                  onEnableAll={(ids) => toggleBooks(ids, true)}
                />
              )}
              {tab === 'homebrew' && (
                <HomebrewPanel
                  sources={userQuery.data?.subscribed_content_sources ?? []}
                  loading={userQuery.isLoading}
                  hasBookEnabled={hasBookEnabled}
                  onToggle={(id, enabled) => toggleBooks([id], enabled)}
                />
              )}
              {tab === 'variants' && (
                <ToggleList
                  items={VARIANT_RULES.map((item) => ({
                    ...item,
                    enabled: Boolean(campaign.recommended_variants?.[item.key]),
                    onChange: (enabled) => patchVariants(item.key, enabled),
                  }))}
                />
              )}
              {tab === 'options' && (
                <div>
                  <ToggleList
                    items={CHARACTER_OPTIONS.map((item) => ({
                      ...item,
                      enabled: Boolean(campaign.recommended_options?.[item.key]),
                      onChange: (enabled) => patchOptions(item.key, enabled),
                    }))}
                  />
                  {campaign.recommended_options?.custom_operations && (
                    <div className='border-t border-p1-border px-4 py-3'>
                      <button type='button' className='toolbar-button' onClick={() => setOpenedOperations(true)}>
                        Open Operations{' '}
                        {campaign.custom_operations && campaign.custom_operations.length > 0
                          ? `(${campaign.custom_operations.length})`
                          : ''}
                      </button>
                      <Phase1OperationsModal
                        title='Custom Operations'
                        opened={openedOperations}
                        onClose={() => setOpenedOperations(false)}
                        operations={cloneDeep(campaign.custom_operations ?? [])}
                        onChange={(operations) => {
                          if (isEqual(campaign.custom_operations, operations)) return;
                          patchCampaign({ custom_operations: operations });
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className='min-w-0 border border-p1-border bg-p1-inset'>
            <h3 className='border-b border-p1-border px-4 py-3 text-sm font-semibold'>Game Config</h3>
            <div className='space-y-4 p-4'>
              <Field label='Name'>
                <input className='settings-input' value={name} onChange={(event) => setName(event.target.value)} placeholder='My Campaign' />
              </Field>
              <Field label='Description'>
                <textarea
                  className='settings-input min-h-24 resize-y'
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder='A brief description of the campaign...'
                />
              </Field>
              <Field label='Show Party Member Status'>
                <select
                  className='settings-input'
                  value={partyStatus}
                  onChange={(event) =>
                    patchCampaign({
                      meta_data: {
                        ...campaign.meta_data,
                        settings: {
                          ...campaign.meta_data?.settings,
                          show_party_member_status: event.target.value as 'OFF' | 'STATUS' | 'DETAILED',
                        },
                      },
                    })
                  }
                >
                  <option value='OFF'>Disabled</option>
                  <option value='STATUS'>Status Only</option>
                  <option value='DETAILED'>Detailed</option>
                </select>
              </Field>
              <Field label='Image URL' error={imageValid ? undefined : 'Invalid URL'}>
                <input
                  className='settings-input'
                  value={imageUrl}
                  onChange={(event) => setImageUrl(event.target.value)}
                  onBlur={(event) => validateImageUrl(event.target.value)}
                />
              </Field>
              <Field label='Join Key'>
                <div className='flex flex-wrap gap-2'>
                  <button type='button' className='toolbar-button' disabled={!campaign.join_key} onClick={revealAndCopyJoinKey}>
                    {copyState === 'copied' ? <Check size={15} /> : joinKeyVisible ? <ClipboardCopy size={15} /> : <KeyRound size={15} />}
                    <span className={joinKeyVisible ? 'font-mono' : ''}>{joinKeyVisible ? campaign.join_key : 'Reveal join key'}</span>
                    {copyState === 'copied' && <span className='text-emerald-300'>Copied</span>}
                    {copyState === 'failed' && <span className='text-red-300'>Copy failed</span>}
                  </button>
                  <button type='button' className='toolbar-button' disabled={resettingKey} onClick={handleResetJoinKey}>
                    <RefreshCw size={15} className={resettingKey ? 'animate-spin' : ''} />
                    Reset key
                  </button>
                </div>
              </Field>
              <div className='space-y-2 border-t border-p1-border pt-4'>
                <div className='relative'>
                  <button
                    type='button'
                    className='toolbar-button w-full justify-center border-p1-danger/40 text-p1-danger-soft'
                    disabled={players.length === 0}
                    onClick={() => setKickMenuOpen((open) => !open)}
                  >
                    Kick Player
                  </button>
                  {kickMenuOpen && players.length > 0 && (
                    <div className='absolute left-0 right-0 z-20 mt-1 border border-p1-border bg-p1-surface py-1 shadow-2xl'>
                      {players.map((player) => (
                        <button
                          key={player.id}
                          type='button'
                          className='block w-full px-3 py-2 text-left text-sm text-p1-text hover:bg-p1-hover'
                          onClick={() => {
                            setKickMenuOpen(false);
                            setPendingKick(player);
                          }}
                        >
                          {player.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type='button'
                  className='toolbar-button w-full justify-center border-p1-danger/40 text-p1-danger-soft'
                  onClick={() => setPendingDelete(true)}
                >
                  Delete Campaign
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {dependencyPrompt && (
        <ConfirmDialog
          title='Enable Dependencies'
          message={
            <>
              <p className='mb-3'>It&apos;s recommended to enable the following as well. Certain features may not work as intended without them.</p>
              <ul className='list-disc space-y-1 pl-5'>
                {dependencyPrompt.sources.map((source) => (
                  <li key={source.id}>{source.name}</li>
                ))}
              </ul>
            </>
          }
          confirmLabel='Enable'
          cancelLabel='Continue without'
          onCancel={dependencyPrompt.onSkip}
          onConfirm={dependencyPrompt.onEnable}
        />
      )}
      {pendingKick && (
        <ConfirmDialog
          title={`Kick "${pendingKick.name}"`}
          message='Are you sure you want to remove this player from the campaign?'
          confirmLabel='Remove player'
          onCancel={() => setPendingKick(null)}
          onConfirm={async () => {
            await onKickPlayer(pendingKick.id);
            setPendingKick(null);
          }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title='Delete Campaign'
          message='Are you sure you want to delete this campaign? This cannot be undone.'
          confirmLabel='Delete campaign'
          onCancel={() => setPendingDelete(false)}
          onConfirm={async () => {
            setPendingDelete(false);
            await onDeleteCampaign();
          }}
        />
      )}
    </>
  );
}

function BooksPanel({
  books,
  loading,
  hasBookEnabled,
  onToggle,
  onEnableAll,
}: {
  books: ContentSource[];
  loading: boolean;
  hasBookEnabled: (id: number) => boolean | undefined;
  onToggle: (id: number, enabled: boolean) => void;
  onEnableAll: (ids: number[]) => void;
}) {
  if (loading) return <EmptySettingsState>Loading books...</EmptySettingsState>;
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
              hasBookEnabled={hasBookEnabled}
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
  hasBookEnabled,
  onToggle,
}: {
  sources: { source_id: number; source_name: string }[];
  loading: boolean;
  hasBookEnabled: (id: number) => boolean | undefined;
  onToggle: (id: number, enabled: boolean) => void;
}) {
  if (loading) return <EmptySettingsState>Loading homebrew...</EmptySettingsState>;
  if (sources.length === 0) {
    return (
      <EmptySettingsState>
        No subscribed bundles found.{' '}
        <a className='text-p1-accent hover:underline' href={`${OLD_UI_ORIGIN}/homebrew`} target='_blank' rel='noreferrer'>
          Go add some!
        </a>
      </EmptySettingsState>
    );
  }
  return (
    <div className='py-1'>
      {sources.map((source) => (
        <ToggleRow
          key={source.source_id}
          label={source.source_name}
          enabled={Boolean(hasBookEnabled(source.source_id))}
          onChange={(enabled) => onToggle(source.source_id, enabled)}
        />
      ))}
    </div>
  );
}

function BookGroup({
  label,
  icon,
  books,
  hasBookEnabled,
  onToggle,
  onEnableAll,
}: {
  label: string;
  icon: ReactNode;
  books: ContentSource[];
  hasBookEnabled: (id: number) => boolean | undefined;
  onToggle: (id: number, enabled: boolean) => void;
  onEnableAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const enabledCount = books.filter((book) => hasBookEnabled(book.id)).length;
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
            <button type='button' className='text-xs text-p1-accent hover:underline' onClick={onEnableAll}>
              Enable all
            </button>
          </div>
          {sorted.map((book) => (
            <ToggleRow
              key={book.id}
              label={book.name}
              href={book.url ?? undefined}
              enabled={Boolean(hasBookEnabled(book.id))}
              onChange={(enabled) => onToggle(book.id, enabled)}
              indent
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ToggleList({
  items,
}: {
  items: { label: string; info: string; url?: string; enabled: boolean; onChange: (enabled: boolean) => void }[];
}) {
  return (
    <div className='py-1'>
      {items.map((item) => (
        <ToggleRow key={item.label} label={item.label} info={item.info} href={item.url} enabled={item.enabled} onChange={item.onChange} />
      ))}
    </div>
  );
}

function ToggleRow({
  label,
  info,
  href,
  enabled,
  onChange,
  indent,
}: {
  label: string;
  info?: string;
  href?: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  indent?: boolean;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-p1-hover ${indent ? 'pl-8' : ''}`}>
      <input type='checkbox' className='mt-1' checked={enabled} onChange={(event) => onChange(event.target.checked)} />
      <span className='min-w-0 flex-1'>
        <span className='flex items-center gap-2'>
          <span className='text-sm'>{label}</span>
          {href && (
            <a href={href} target='_blank' rel='noreferrer' className='text-p1-faint hover:text-p1-accent' onClick={(event) => event.stopPropagation()}>
              <ExternalLink size={12} />
            </a>
          )}
        </span>
        {info && <span className='mt-0.5 block text-xs leading-5 text-p1-faint'>{info}</span>}
      </span>
    </label>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className='block'>
      <span className='mb-1.5 block text-xs font-semibold uppercase tracking-wide text-p1-muted'>{label}</span>
      {children}
      {error && <span className='mt-1 block text-xs text-p1-danger-soft'>{error}</span>}
    </label>
  );
}

function EmptySettingsState({ children }: { children: ReactNode }) {
  return <p className='px-4 py-8 text-center text-sm italic text-p1-faint'>{children}</p>;
}

function SettingsEyebrow({ children }: { children: ReactNode }) {
  return <div className='text-[10px] font-semibold uppercase text-p1-accent'>{children}</div>;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmDanger = true,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDanger?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  return createPortal(
    <div
      className='fixed inset-0 z-[120] grid place-items-center bg-black/75 p-5 backdrop-blur-[2px]'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section role='dialog' aria-modal='true' aria-labelledby='confirm-title' className='w-full max-w-sm border border-p1-border bg-p1-surface p-5 shadow-2xl'>
        <h2 id='confirm-title' className='text-lg font-semibold'>
          {title}
        </h2>
        <div className='mt-2 text-sm leading-6 text-p1-muted'>{message}</div>
        <div className='mt-5 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type='button'
            className={`toolbar-button ${confirmDanger ? 'border-p1-danger/50 text-p1-danger-soft' : ''}`}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    return copied;
  }
}
