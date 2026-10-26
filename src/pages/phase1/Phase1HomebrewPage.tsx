import { CampaignSignIn } from '@auth/CampaignSignIn';
import { useAuthSession } from '@auth/useAuthSession';
import { getCachedPublicUser, getPublicUser } from '@auth/user-manager';
import { deleteContent, upsertContentSource } from '@content/content-creation';
import { fetchContentPackage, fetchContentSources, resetContentStore } from '@content/content-store';
import { updateSubscriptions } from '@content/homebrew';
import { importFromCustomPack } from '@homebrew/import/pathbuilder-custom-packs';
import { makeRequest } from '@requests/request-manager';
import type { AbilityBlock, ContentPackage, ContentSource, PublicUser } from '@schemas/content';
import { hasPatreonAccess } from '@utils/patreon';
import { pluralize, toLabel } from '@utils/strings';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { OLD_UI_ORIGIN } from '../phase-switch/PhaseViewSwitch';
import { useContentLinks } from './phase1-content-links';
import { Phase1PickerModal } from './phase1-picker-modal';
import { WorkspaceHeader } from './Phase1Workspace';

type Tab = 'browse' | 'subscriptions' | 'creations';

function searchBlob(source: ContentSource) {
  return `${source.name} ${source.contact_info ?? ''} ${source.description} ${source.url ?? ''}`.toLowerCase();
}

function emptyBundle(): ContentSource {
  return {
    id: -1,
    created_at: '',
    user_id: '',
    name: 'New Bundle',
    foundry_id: null,
    url: '',
    description: '',
    operations: [],
    contact_info: '',
    group: '',
    require_key: false,
    keys: null,
    is_published: false,
    artwork_url: '',
    deprecated: false,
    required_content_sources: [],
    meta_data: {},
  };
}

export function Phase1HomebrewPage() {
  const session = useAuthSession();
  if (session === undefined) return <div className='grid min-h-screen place-items-center bg-p1-page text-sm text-p1-muted'>Loading...</div>;
  if (!session) return <CampaignSignIn variant='phase1' />;
  return (
    <div className='min-h-screen bg-p1-page text-p1-text'>
      <WorkspaceHeader label='Homebrew' section='homebrew' />
      <HomebrewBody />
    </div>
  );
}

function HomebrewBody() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('browse');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ContentSource | null>(null);
  const [editing, setEditing] = useState<ContentSource | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const userQuery = useQuery({
    queryKey: ['phase1-homebrew-self'],
    queryFn: () => getPublicUser(),
  });
  const user = userQuery.data ?? null;

  const browseQuery = useQuery({
    queryKey: ['phase1-homebrew-public'],
    queryFn: async () =>
      (await fetchContentSources('ALL-HOMEBREW-PUBLIC'))
        .filter((source) => source.user_id)
        .sort((a, b) => {
          if (a.require_key && !b.require_key) return 1;
          if (!a.require_key && b.require_key) return -1;
          return a.name.localeCompare(b.name);
        }),
  });

  const ownedQuery = useQuery({
    queryKey: ['phase1-homebrew-accessible', user?.user_id],
    enabled: Boolean(user),
    queryFn: async () => {
      resetContentStore(false, true);
      return fetchContentSources('ALL-HOMEBREW-ACCESSIBLE');
    },
  });

  const subscribed = useMemo(
    () =>
      (ownedQuery.data ?? []).filter(
        (source) => source.user_id && user?.subscribed_content_sources?.some((item) => item.source_id === source.id)
      ),
    [ownedQuery.data, user]
  );
  const creations = useMemo(
    () => (ownedQuery.data ?? []).filter((source) => source.user_id && source.user_id === user?.user_id),
    [ownedQuery.data, user]
  );

  const list = tab === 'browse' ? browseQuery.data ?? [] : tab === 'subscriptions' ? subscribed : creations;
  const filtered = list.filter((source) => searchBlob(source).includes(search.trim().toLowerCase()));
  const loading =
    userQuery.isFetching ||
    (tab === 'browse' ? browseQuery.isFetching : ownedQuery.isFetching || !user);

  function canOpenCreations() {
    return hasPatreonAccess(user ?? getCachedPublicUser(), 2);
  }

  function chooseTab(next: Tab) {
    if (next === 'creations' && !canOpenCreations()) {
      setNotice('My Creations is available to Wanderer-tier patrons.');
      return;
    }
    setNotice('');
    setTab(next);
    setSelected(null);
    setEditing(null);
  }

  async function refreshUser() {
    const next = await getPublicUser();
    queryClient.setQueryData(['phase1-homebrew-self'], next);
    await queryClient.invalidateQueries({ queryKey: ['phase1-homebrew-accessible'] });
    await queryClient.invalidateQueries({ queryKey: ['phase1-homebrew-public'] });
    return next;
  }

  async function subscribe(source: ContentSource, add: boolean) {
    if (!user) return;
    setBusy(true);
    setNotice('');
    try {
      const subscriptions = await updateSubscriptions(user, source, add);
      await makeRequest('update-user', { subscribed_content_sources: subscriptions ?? [] });
      await refreshUser();
    } finally {
      setBusy(false);
    }
  }

  async function createBundle() {
    if (!canOpenCreations()) {
      setNotice('My Creations is available to Wanderer-tier patrons.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const source = await upsertContentSource(emptyBundle());
      if (source && user) {
        const subscriptions = await updateSubscriptions(user, source, true);
        await makeRequest('update-user', { subscribed_content_sources: subscriptions ?? [] });
        await refreshUser();
        setTab('creations');
        setEditing(source);
      }
    } finally {
      setBusy(false);
    }
  }

  async function importPack(file: File | null) {
    if (!file) return;
    if (!canOpenCreations()) {
      setNotice('My Creations is available to Wanderer-tier patrons.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const source = await importFromCustomPack(file);
      if (source && user) {
        const subscriptions = await updateSubscriptions(user, source, true);
        await makeRequest('update-user', { subscribed_content_sources: subscriptions ?? [] });
        await refreshUser();
        setTab('creations');
        setEditing(source);
      } else {
        setNotice('Import failed. Check that the file is a Pathbuilder custom pack JSON.');
      }
    } catch {
      setNotice('Import failed. Check that the file is a Pathbuilder custom pack JSON.');
    } finally {
      setBusy(false);
    }
  }

  async function removeBundle(source: ContentSource) {
    if (!window.confirm(`Delete “${source.name}”? Characters using this bundle will lose its content.`)) return;
    setBusy(true);
    try {
      await deleteContent('content-source', source.id);
      setSelected(null);
      setEditing(null);
      await refreshUser();
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(source: ContentSource) {
    setBusy(true);
    setNotice('');
    try {
      const saved = await upsertContentSource(source);
      if (!saved) {
        setNotice('Could not save the bundle.');
        return;
      }
      setEditing(null);
      setSelected(saved);
      await refreshUser();
    } finally {
      setBusy(false);
    }
  }

  const inProgress = filtered.filter((source) => !source.is_published);
  const published = filtered.filter((source) => source.is_published);

  return (
    <main className='mx-auto w-full max-w-4xl px-4 py-6'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-stretch'>
        <input
          className='settings-input h-9 min-w-0 flex-1 py-0'
          placeholder='Search bundles'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className='p1-segment w-full shrink-0 sm:w-auto'>
          <TabButton active={tab === 'browse'} onClick={() => chooseTab('browse')}>
            Browse
          </TabButton>
          <TabButton active={tab === 'subscriptions'} onClick={() => chooseTab('subscriptions')}>
            Subscriptions
          </TabButton>
          <TabButton active={tab === 'creations'} onClick={() => chooseTab('creations')}>
            My Creations
          </TabButton>
        </div>
      </div>
      {notice && <p className='mt-2 text-sm text-p1-muted'>{notice}</p>}

      {tab === 'creations' && canOpenCreations() && (
        <div className='mt-4 flex flex-wrap gap-2'>
          <button type='button' className='toolbar-button toolbar-button-accent' disabled={busy} onClick={() => void createBundle()}>
            Create Bundle
          </button>
          <button type='button' className='toolbar-button' disabled={busy} onClick={() => importRef.current?.click()}>
            Import custom pack
          </button>
          <input ref={importRef} type='file' accept='application/JSON,.json' className='hidden' onChange={(event) => void importPack(event.target.files?.[0] ?? null)} />
        </div>
      )}

      {loading ? (
        <p className='mt-8 text-center text-sm italic text-p1-muted'>Loading bundles...</p>
      ) : tab === 'creations' ? (
        <div className='mt-6 space-y-6'>
          <BundleGroup title='In Progress' sources={inProgress} empty='No bundles in progress.' user={user} busy={busy} onOpen={setSelected} onEdit={setEditing} onDelete={(source) => void removeBundle(source)} />
          <BundleGroup title='Published' sources={published} empty='No published bundles.' user={user} busy={busy} onOpen={setSelected} onEdit={setEditing} onDelete={(source) => void removeBundle(source)} />
        </div>
      ) : filtered.length === 0 ? (
        <p className='mt-8 text-center text-sm italic text-p1-muted'>
          {tab === 'subscriptions' ? (
            <>
              No subscribed bundles found.{' '}
              <button type='button' className='text-p1-accent hover:underline' onClick={() => chooseTab('browse')}>
                Go add some
              </button>
              .
            </>
          ) : (
            'No homebrew bundles found.'
          )}
        </p>
      ) : (
        <ul className='mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {filtered.map((source) => (
            <li key={source.id}>
              <BundleCard
                source={source}
                user={user}
                busy={busy}
                onOpen={() => setSelected(source)}
                onUnsubscribe={tab === 'subscriptions' ? () => {
                  if (!window.confirm(`Unsubscribe from “${source.name}”? Characters using this bundle will lose its content.`)) return;
                  void subscribe(source, false);
                } : undefined}
              />
            </li>
          ))}
        </ul>
      )}

      {selected && !editing && (
        <BundleModal
          source={selected}
          user={user}
          busy={busy}
          onClose={() => setSelected(null)}
          onSubscribe={(add) => void subscribe(selected, add)}
          onEdit={selected.user_id === user?.user_id ? () => setEditing(selected) : undefined}
        />
      )}
      {editing && <EditPanel source={editing} busy={busy} onClose={() => setEditing(null)} onSave={(next) => void saveEdit(next)} />}
    </main>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type='button' className={active ? 'is-active' : undefined} onClick={onClick}>
      {children}
    </button>
  );
}

function BundleGroup({
  title,
  sources,
  empty,
  user,
  busy,
  onOpen,
  onEdit,
  onDelete,
}: {
  title: string;
  sources: ContentSource[];
  empty: string;
  user: PublicUser | null;
  busy: boolean;
  onOpen: (source: ContentSource) => void;
  onEdit: (source: ContentSource) => void;
  onDelete: (source: ContentSource) => void;
}) {
  return (
    <section>
      <h2 className='mb-2 text-sm font-semibold uppercase tracking-wide text-p1-muted'>{title}</h2>
      {sources.length === 0 ? (
        <p className='rounded-lg border border-p1-border bg-p1-surface px-3 py-6 text-center text-sm italic text-p1-muted'>{empty}</p>
      ) : (
        <ul className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {sources.map((source) => (
            <li key={source.id}>
              <BundleCard source={source} user={user} busy={busy} onOpen={() => onOpen(source)} onEdit={() => onEdit(source)} onDelete={() => onDelete(source)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BundleCard({
  source,
  user,
  busy,
  onOpen,
  onEdit,
  onDelete,
  onUnsubscribe,
}: {
  source: ContentSource;
  user: PublicUser | null;
  busy: boolean;
  onOpen: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onUnsubscribe?: () => void;
}) {
  const subscribed = Boolean(user?.subscribed_content_sources?.some((item) => item.source_id === source.id));
  return (
    <article className='flex h-full flex-col rounded-lg border border-p1-border bg-p1-surface p-3'>
      <button type='button' className='min-w-0 flex-1 text-left' onClick={onOpen}>
        <h3 className='font-medium'>{source.name}</h3>
        <p className='mt-1 line-clamp-3 text-xs text-p1-muted'>{source.description || 'No description.'}</p>
        <p className='mt-2 text-[11px] text-p1-faint'>
          {bundleCounts(source) || (source.require_key ? 'Locked' : 'Open')}
          {source.contact_info ? ` · ${source.contact_info}` : ''}
          {subscribed ? ' · Subscribed' : ''}
        </p>
      </button>
      {(onEdit || onDelete || onUnsubscribe) && (
        <div className='mt-3 flex gap-2'>
          {onEdit && (
            <button type='button' className='toolbar-button flex-1 justify-center' disabled={busy} onClick={onEdit}>
              Edit
            </button>
          )}
          {onUnsubscribe && (
            <button type='button' className='toolbar-button' disabled={busy} onClick={onUnsubscribe}>
              Unsubscribe
            </button>
          )}
          {onDelete && (
            <button type='button' className='toolbar-button text-red-800 hover:border-red-800 hover:bg-red-800 hover:text-white' disabled={busy} onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      )}
    </article>
  );
}

type BundleEntry = { key: string; name: string; kind: string; href: string };

function bundleCounts(source: ContentSource) {
  const counts = Object.entries(source.meta_data?.counts ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, value]) => `${pluralize(toLabel(key))} ${value}`);
  return counts.join(' · ');
}

function bundleEntries(content: ContentPackage): BundleEntry[] {
  const rows: BundleEntry[] = [];
  const add = (kind: string, type: string, records: { id: number; name: string }[]) => {
    for (const record of records) {
      rows.push({ key: `${type}-${record.id}`, name: record.name, kind, href: `link_${type}_${record.id}` });
    }
  };
  const blocks = (type: AbilityBlock['type']) => content.abilityBlocks.filter((block) => block.type === type);
  add('Action', 'action', blocks('action'));
  add('Feat', 'feat', blocks('feat'));
  add('Class Feature', 'class-feature', blocks('class-feature'));
  add('Heritage', 'heritage', blocks('heritage'));
  add('Physical Feature', 'physical-feature', blocks('physical-feature'));
  add('Sense', 'sense', blocks('sense'));
  add('Mode', 'mode', blocks('mode'));
  add('Ancestry', 'ancestry', content.ancestries);
  add('Background', 'background', content.backgrounds);
  add('Class', 'class', content.classes);
  add('Class Archetype', 'class-archetype', content.classArchetypes);
  add('Archetype', 'archetype', content.archetypes);
  add('Versatile Heritage', 'versatile-heritage', content.versatileHeritages);
  add('Creature', 'creature', content.creatures);
  add('Item', 'item', content.items);
  add('Language', 'language', content.languages);
  add('Spell', 'spell', content.spells);
  add('Trait', 'trait', content.traits);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function BundleModal({
  source,
  user,
  busy,
  onClose,
  onSubscribe,
  onEdit,
}: {
  source: ContentSource;
  user: PublicUser | null;
  busy: boolean;
  onClose: () => void;
  onSubscribe: (add: boolean) => void;
  onEdit?: () => void;
}) {
  const { open } = useContentLinks();
  const subscribed = Boolean(user?.subscribed_content_sources?.some((item) => item.source_id === source.id));
  const packageQuery = useQuery({
    queryKey: ['phase1-homebrew-package', source.id],
    queryFn: () => fetchContentPackage([source.id], { fetchCreatures: true }),
  });
  const entries = useMemo(() => (packageQuery.data ? bundleEntries(packageQuery.data) : []), [packageQuery.data]);

  return (
    <Phase1PickerModal
      title={source.name}
      titleId='homebrew-bundle-title'
      searchPlaceholder='Search this bundle'
      items={entries}
      getName={(entry) => entry.name}
      getKey={(entry) => entry.key}
      matchesSearch={(entry, needle) => `${entry.name} ${entry.kind}`.toLowerCase().includes(needle)}
      loading={packageQuery.isLoading}
      error={packageQuery.isError ? 'Could not load this bundle.' : null}
      empty='This bundle has no content yet.'
      onClose={onClose}
      maxWidthClass='max-w-lg'
      maxHeightClass='max-h-[min(82vh,720px)]'
      toolbar={
        <div className='mt-2 space-y-1 text-xs text-p1-muted'>
          {source.description && <p className='line-clamp-3 whitespace-pre-wrap'>{source.description}</p>}
          {source.contact_info && <p>{source.contact_info}</p>}
          {source.required_content_sources && source.required_content_sources.length > 0 && (
            <p>Requires sources: {source.required_content_sources.join(', ')}</p>
          )}
        </div>
      }
      footer={
        <div className='flex flex-wrap gap-2 border-t border-p1-border px-4 py-3'>
          {source.user_id && (
            <button type='button' className={subscribed ? 'toolbar-button' : 'toolbar-button toolbar-button-accent'} disabled={busy} onClick={() => onSubscribe(!subscribed)}>
              {subscribed ? 'Unsubscribe' : 'Subscribe'}
            </button>
          )}
          {onEdit && (
            <button type='button' className='toolbar-button' onClick={onEdit}>
              Edit bundle
            </button>
          )}
          {source.url && (
            <a className='toolbar-button' href={source.url} target='_blank' rel='noreferrer'>
              Source
            </a>
          )}
          <a className='toolbar-button' href={`${OLD_UI_ORIGIN}/homebrew`} target='_blank' rel='noreferrer'>
            Open content editor
          </a>
        </div>
      }
      renderItem={(entry) => (
        <button
          type='button'
          className='flex w-full items-center gap-3 border-b border-p1-border px-3 py-2 text-left hover:bg-p1-hover'
          onClick={() => open(entry.href)}
        >
          <span className='min-w-0 flex-1 truncate text-sm'>{entry.name}</span>
          <span className='shrink-0 text-[10px] uppercase text-p1-faint'>{entry.kind}</span>
        </button>
      )}
    />
  );
}

const BUNDLE_SECTIONS: { id: string; label: string; kind: string }[] = [
  { id: 'action', label: 'Actions', kind: 'Action' },
  { id: 'feat', label: 'Feats', kind: 'Feat' },
  { id: 'item', label: 'Items', kind: 'Item' },
  { id: 'spell', label: 'Spells', kind: 'Spell' },
  { id: 'trait', label: 'Traits', kind: 'Trait' },
  { id: 'language', label: 'Languages', kind: 'Language' },
  { id: 'creature', label: 'Creatures', kind: 'Creature' },
  { id: 'ancestry', label: 'Ancestries', kind: 'Ancestry' },
  { id: 'heritage', label: 'Heritages', kind: 'Heritage' },
  { id: 'sense', label: 'Senses', kind: 'Sense' },
  { id: 'physical-feature', label: 'Physical Features', kind: 'Physical Feature' },
  { id: 'background', label: 'Backgrounds', kind: 'Background' },
  { id: 'class', label: 'Classes', kind: 'Class' },
  { id: 'class-feature', label: 'Class Features', kind: 'Class Feature' },
  { id: 'archetype', label: 'Archetypes', kind: 'Archetype' },
  { id: 'versatile-heritage', label: 'Versatile Heritages', kind: 'Versatile Heritage' },
  { id: 'class-archetype', label: 'Class Archetypes', kind: 'Class Archetype' },
  { id: 'mode', label: 'Modes', kind: 'Mode' },
];

function EditPanel({
  source,
  busy,
  onClose,
  onSave,
}: {
  source: ContentSource;
  busy: boolean;
  onClose: () => void;
  onSave: (source: ContentSource) => void;
}) {
  const { open } = useContentLinks();
  const [draft, setDraft] = useState(source);
  const [section, setSection] = useState('item');
  const [query, setQuery] = useState('');
  const packageQuery = useQuery({
    queryKey: ['phase1-homebrew-package', source.id],
    queryFn: () => fetchContentPackage([source.id], { fetchCreatures: true }),
  });
  const entries = useMemo(() => (packageQuery.data ? bundleEntries(packageQuery.data) : []), [packageQuery.data]);
  const current = BUNDLE_SECTIONS.find((item) => item.id === section) ?? BUNDLE_SECTIONS[2];
  const visible = entries.filter(
    (entry) => entry.kind === current.kind && `${entry.name} ${entry.kind}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  const grouped = BUNDLE_SECTIONS.map((item) => ({
    ...item,
    entries: entries.filter((entry) => entry.kind === item.kind),
  })).filter((item) => item.entries.length > 0);

  return (
    <div className='fixed inset-0 z-30 bg-black/60 p-3 sm:p-5' onClick={onClose}>
      <form
        className='flex h-full flex-col border border-p1-border bg-p1-page shadow-2xl'
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <header className='flex items-center gap-3 border-b border-p1-border px-4 py-3'>
          <h2 className='min-w-0 flex-1 text-lg font-semibold'>Update Bundle</h2>
          <button type='button' className='text-sm text-p1-muted hover:text-p1-text' onClick={onClose}>
            Close
          </button>
        </header>
        <div className='grid min-h-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)_300px]'>
          <div className='space-y-3 overflow-y-auto border-b border-p1-border p-4 lg:border-b-0 lg:border-r'>
            <label className='block text-sm'>
              Name
              <input className='settings-input mt-1' required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className='block text-sm'>
              Contact info
              <input className='settings-input mt-1' value={draft.contact_info ?? ''} onChange={(event) => setDraft({ ...draft, contact_info: event.target.value })} />
            </label>
            <label className='block text-sm'>
              Source URL
              <input className='settings-input mt-1' value={draft.url ?? ''} onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
            </label>
            <label className='block text-sm'>
              Image URL
              <input className='settings-input mt-1' value={draft.artwork_url ?? ''} onChange={(event) => setDraft({ ...draft, artwork_url: event.target.value })} />
            </label>
            <label className='block text-sm'>
              Description
              <textarea className='settings-input mt-1' rows={6} required value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </label>
            <label className='flex items-center justify-between gap-2 text-sm'>
              Require key
              <input type='checkbox' checked={draft.require_key} onChange={(event) => setDraft({ ...draft, require_key: event.target.checked })} />
            </label>
            <label className='flex items-center justify-between gap-2 text-sm'>
              Published
              <input type='checkbox' checked={draft.is_published} onChange={(event) => setDraft({ ...draft, is_published: event.target.checked })} />
            </label>
            <div className='flex flex-wrap gap-2'>
              <button type='button' className='toolbar-button' onClick={onClose}>
                Cancel
              </button>
              <button type='submit' className='toolbar-button toolbar-button-accent' disabled={busy}>
                Save
              </button>
            </div>
          </div>
          <div className='grid min-h-0 grid-cols-[180px_minmax(0,1fr)] border-b border-p1-border lg:border-b-0 lg:border-r'>
            <div className='overflow-y-auto border-r border-p1-border py-2'>
              {BUNDLE_SECTIONS.map((item) => {
                const count = entries.filter((entry) => entry.kind === item.kind).length;
                return (
                  <button
                    key={item.id}
                    type='button'
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-p1-hover ${section === item.id ? 'bg-p1-hover text-p1-text' : 'text-p1-muted'}`}
                    onClick={() => {
                      setSection(item.id);
                      setQuery('');
                    }}
                  >
                    <span className='truncate'>{item.label}</span>
                    {count > 0 && <span className='text-[10px] text-p1-accent'>{count}</span>}
                  </button>
                );
              })}
            </div>
            <div className='flex min-h-0 flex-col'>
              <div className='border-b border-p1-border p-3'>
                <input
                  className='settings-input h-9 py-0'
                  placeholder={`Search ${current.label.toLowerCase()}`}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className='min-h-0 flex-1 overflow-y-auto'>
                {packageQuery.isLoading && <p className='px-4 py-8 text-center text-sm italic text-p1-muted'>Loading...</p>}
                {!packageQuery.isLoading && visible.length === 0 && (
                  <p className='px-4 py-8 text-center text-sm italic text-p1-muted'>No records found!</p>
                )}
                {visible.map((entry) => (
                  <button
                    key={entry.key}
                    type='button'
                    className='flex w-full items-center border-b border-p1-border px-3 py-2 text-left text-sm hover:bg-p1-hover'
                    onClick={() => open(entry.href)}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <aside className='min-h-0 overflow-y-auto p-4'>
            <h3 className='text-base font-semibold'>{draft.name || 'Untitled bundle'}</h3>
            <p className='mt-2 whitespace-pre-wrap text-sm text-p1-muted'>{draft.description || 'No description.'}</p>
            <div className='mt-4 space-y-3'>
              {grouped.map((group) => (
                <section key={group.id}>
                  <h4 className='text-xs font-semibold uppercase tracking-wide text-p1-muted'>
                    {group.label} <span className='text-p1-faint'>{group.entries.length}</span>
                  </h4>
                  <ul className='mt-1 border border-p1-border'>
                    {group.entries.map((entry) => (
                      <li key={entry.key}>
                        <button type='button' className='w-full px-2 py-1.5 text-left text-sm hover:bg-p1-hover' onClick={() => open(entry.href)}>
                          {entry.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </aside>
        </div>
      </form>
    </div>
  );
}
