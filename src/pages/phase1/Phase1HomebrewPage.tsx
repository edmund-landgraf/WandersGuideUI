import { CampaignSignIn } from '@auth/CampaignSignIn';
import { useAuthSession } from '@auth/useAuthSession';
import { getCachedPublicUser, getPublicUser } from '@auth/user-manager';
import { deleteContent, upsertContentSource } from '@content/content-creation';
import { fetchContentPackage, fetchContentSources, resetContentStore } from '@content/content-store';
import { defineDefaultSourcesForSource, updateSubscriptions } from '@content/homebrew';
import { importFromCustomPack } from '@homebrew/import/pathbuilder-custom-packs';
import { makeRequest } from '@requests/request-manager';
import type { AbilityBlockType, ContentSource, ContentType, PublicUser } from '@schemas/content';
import { hasPatreonAccess } from '@utils/patreon';
import { pluralize, toLabel } from '@utils/strings';
import { getRingIcon } from '@utils/images';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { OLD_UI_ORIGIN } from '../phase-switch/PhaseViewSwitch';
import { useContentLinks } from './phase1-content-links';
import { BUNDLE_SECTIONS, BundleEditorColumn, bundleEntries } from './phase1-homebrew-records';
import { Phase1MissingContent } from './phase1-missing-content';
import { Phase1OperationsModal } from './phase1-operations-modal';
import { Phase1PickerModal } from './phase1-picker-modal';
import { WorkspaceHeader } from './Phase1Workspace';

const PAGE_SIZE = 12;

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
  const [locked, setLocked] = useState<ContentSource | null>(null);
  const [unlockedIds, setUnlockedIds] = useState<number[]>([]);
  const [page, setPage] = useState(0);
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
  const filtered = list
    .filter((source) => searchBlob(source).includes(search.trim().toLowerCase()))
    .sort((a, b) => Number(a.require_key) - Number(b.require_key) || a.name.localeCompare(b.name));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
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
    setPage(0);
    setSelected(null);
    setEditing(null);
  }

  function openBundle(source: ContentSource) {
    const subscribedNow = Boolean(user?.subscribed_content_sources?.some((item) => item.source_id === source.id));
    if (source.require_key && !subscribedNow && !unlockedIds.includes(source.id)) {
      setLocked(source);
      return;
    }
    setSelected(source);
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
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
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
          <BundleGroup title='In Progress' sources={inProgress} empty='No bundles in progress.' user={user} busy={busy} onOpen={openBundle} onEdit={setEditing} onDelete={(source) => void removeBundle(source)} />
          <BundleGroup title='Published' sources={published} empty='No published bundles.' user={user} busy={busy} onOpen={openBundle} onEdit={setEditing} onDelete={(source) => void removeBundle(source)} />
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
          {paged.map((source) => (
            <li key={source.id}>
              <BundleCard
                source={source}
                user={user}
                busy={busy}
                onOpen={() => openBundle(source)}
                onUnsubscribe={tab === 'subscriptions' ? () => {
                  if (!window.confirm(`Unsubscribe from “${source.name}”? Characters using this bundle will lose its content.`)) return;
                  void subscribe(source, false);
                } : undefined}
              />
            </li>
          ))}
        </ul>
      )}
      {tab !== 'creations' && pageCount > 1 && (
        <div className='mt-4 flex justify-center gap-2'>
          <button type='button' className='toolbar-button' disabled={page === 0} onClick={() => setPage((current) => current - 1)}>
            Previous
          </button>
          <span className='self-center text-xs text-p1-muted'>
            {page + 1} / {pageCount}
          </span>
          <button type='button' className='toolbar-button' disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>
            Next
          </button>
        </div>
      )}
      {locked && (
        <UnlockPrompt
          source={locked}
          onCancel={() => setLocked(null)}
          onUnlock={() => {
            setUnlockedIds((current) => [...current, locked.id]);
            setSelected(locked);
            setLocked(null);
          }}
        />
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
  const stats = useQuery({
    queryKey: ['phase1-source-stats', source.id],
    queryFn: () => makeRequest<{ count?: number }>('get-content-source-stats', { content_source_id: source.id }),
  });
  return (
    <article className='flex h-full flex-col rounded-lg border border-p1-border bg-p1-surface p-3'>
      <button type='button' className='flex min-w-0 flex-1 gap-3 text-left' onClick={onOpen}>
        <BundleIcon source={source} />
        <span className='min-w-0 flex-1'>
        <span className='flex items-start justify-between gap-2'>
          <h3 className='font-medium'>{source.name}</h3>
          <span className='text-right text-[10px] uppercase text-p1-faint'>
            Subscribers
            <span className='block text-xs normal-case text-p1-muted'>{stats.data?.count ?? '…'}</span>
          </span>
        </span>
        <p className='mt-1 line-clamp-3 text-xs text-p1-muted'>{source.description || 'No description.'}</p>
        <p className='mt-2 text-[11px] text-p1-faint'>
          {bundleCounts(source) || (source.require_key ? 'Locked' : 'Open')}
          {source.contact_info ? ` · ${source.contact_info}` : ''}
          {subscribed ? ' · Subscribed' : ''}
        </p>
        </span>
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

function bundleCounts(source: ContentSource) {
  const counts = Object.entries(source.meta_data?.counts ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, value]) => `${pluralize(toLabel(key))} ${value}`);
  return counts.join(' · ');
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
  const [missing, setMissing] = useState<ContentType | AbilityBlockType | ''>('');

  return (
    <>
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
          {!source.user_id && (
            <label className='block pt-1'>
              Missing something?
              <select
                className='settings-input mt-1'
                value={missing}
                onChange={(event) => setMissing(event.target.value as ContentType | AbilityBlockType)}
              >
                <option value=''>Choose a content type</option>
                {BUNDLE_SECTIONS.map((section) => (
                  <option key={section.id} value={section.abilityBlockType ?? section.contentType}>
                    {section.label}
                  </option>
                ))}
              </select>
            </label>
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
          <span className='min-w-0 flex-1 truncate text-sm'>
            {entry.name}
            {entry.level != null && <span className='ml-2 text-[10px] uppercase text-p1-faint'>Lvl {entry.level}</span>}
          </span>
          <span className='shrink-0 text-[10px] uppercase text-p1-faint'>{entry.rarity ? `${entry.rarity} · ` : ''}{entry.kind}</span>
        </button>
      )}
    />
    {missing && (
      <Phase1MissingContent type={missing} id={-1} contentSourceId={source.id} onClose={() => setMissing('')} />
    )}
    </>
  );
}

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
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [publishPrompt, setPublishPrompt] = useState(false);
  const packageQuery = useQuery({
    queryKey: ['phase1-homebrew-package', source.id],
    queryFn: () => fetchContentPackage([source.id], { fetchCreatures: true }),
  });
  const entries = useMemo(() => (packageQuery.data ? bundleEntries(packageQuery.data) : []), [packageQuery.data]);
  const grouped = BUNDLE_SECTIONS.map((item) => ({
    ...item,
    entries: entries.filter((entry) => entry.kind === item.kind),
  })).filter((item) => item.entries.length > 0);
  useEffect(() => {
    void defineDefaultSourcesForSource('INFO', source);
  }, [source]);

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
              <textarea
                required
                className='settings-input mt-1 min-h-40'
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </label>
            <button type='button' className='toolbar-button' onClick={() => setOperationsOpen(true)}>
              Operations{draft.operations?.length ? ` (${draft.operations.length})` : ''}
            </button>
            <label className='flex items-center justify-between gap-2 text-sm'>
              Require key
              <input type='checkbox' checked={draft.require_key} onChange={(event) => setDraft({ ...draft, require_key: event.target.checked })} />
            </label>
            {draft.require_key && (
              <label className='block text-sm'>
                Access key
                <span className='mt-1 flex gap-2'>
                  <input
                    className='settings-input'
                    value={draft.keys?.access_key ?? ''}
                    onChange={(event) => setDraft({ ...draft, keys: { access_key: event.target.value } })}
                  />
                  <button
                    type='button'
                    className='toolbar-button shrink-0'
                    onClick={() => setDraft({ ...draft, keys: { access_key: crypto.randomUUID().slice(0, 18) } })}
                  >
                    Generate
                  </button>
                </span>
              </label>
            )}
            <label className='flex items-center justify-between gap-2 text-sm'>
              Published
              <input
                type='checkbox'
                checked={draft.is_published}
                onChange={(event) => {
                  if (event.target.checked) setPublishPrompt(true);
                  else setDraft({ ...draft, is_published: false });
                }}
              />
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
          {packageQuery.isLoading ? (
            <p className='grid place-items-center text-sm italic text-p1-muted'>Loading...</p>
          ) : (
            <BundleEditorColumn sourceId={source.id} entries={entries} />
          )}
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
      <Phase1OperationsModal
        title='Content Source Operations'
        opened={operationsOpen}
        operations={draft.operations ?? []}
        onChange={(operations) => setDraft({ ...draft, operations })}
        onClose={() => setOperationsOpen(false)}
      />
      {publishPrompt && (
        <div className='fixed inset-0 z-[80] grid place-items-center bg-black/70 p-5' role='presentation'>
          <section role='dialog' aria-modal='true' className='max-w-lg border border-p1-border bg-p1-surface p-4 text-sm'>
            <h3 className='text-lg font-semibold'>Publish Bundle</h3>
            <p className='mt-2 text-p1-muted'>By publishing, you agree that this content:</p>
            <ul className='mt-2 list-disc space-y-1 pl-5 text-p1-muted'>
              <li>is published under the ORC license and complies with Paizo's Community Use Policy;</li>
              <li>does not contain a third party’s intellectual property without permission;</li>
              <li>keeps a high standard of quality and is not low-effort content;</li>
              <li>does not contain material the general public would classify as adult, offensive, or inappropriate for minors.</li>
            </ul>
            <p className='mt-2 text-p1-muted'>Failure to comply may result in the content being removed.</p>
            <div className='mt-4 flex justify-end gap-2'>
              <button type='button' className='toolbar-button' onClick={() => setPublishPrompt(false)}>
                Cancel
              </button>
              <button
                type='button'
                className='toolbar-button toolbar-button-accent'
                onClick={() => {
                  setDraft({ ...draft, is_published: true });
                  setPublishPrompt(false);
                }}
              >
                Publish
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function BundleIcon({ source }: { source: ContentSource }) {
  const [icon, setIcon] = useState<string>();
  useEffect(() => {
    if (source.artwork_url) return;
    void getRingIcon(`${source.name}-${source.contact_info}-${source.id}`).then(setIcon);
  }, [source.artwork_url, source.name, source.contact_info, source.id]);
  const src = source.artwork_url || (icon ? `data:image/svg+xml;utf8,${encodeURIComponent(icon)}` : undefined);
  return src ? <img src={src} alt='' className='h-12 w-12 shrink-0 rounded-full bg-p1-inset object-cover' /> : <span className='h-12 w-12 shrink-0 rounded-full bg-p1-inset' />;
}

function UnlockPrompt({ source, onUnlock, onCancel }: { source: ContentSource; onUnlock: () => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  function submit() {
    if (value.trim() && value.trim() === source.keys?.access_key?.trim()) onUnlock();
    else setError('That key does not match the one from the author.');
  }
  return (
    <div className='fixed inset-0 z-40 grid place-items-center bg-black/70 p-5' role='presentation'>
      <form
        className='w-full max-w-md border border-p1-border bg-p1-surface p-4'
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 className='text-lg font-semibold'>Locked Bundle</h2>
        <p className='mt-2 text-sm text-p1-muted'>Enter the access key provided by the author of {source.name}.</p>
        <input className='settings-input mt-3' value={value} onChange={(event) => setValue(event.target.value)} placeholder='Access key' />
        {error && <p className='mt-2 text-sm text-p1-danger-soft'>{error}</p>}
        <div className='mt-4 flex justify-end gap-2'>
          <button type='button' className='toolbar-button' onClick={onCancel}>
            Cancel
          </button>
          <button type='submit' className='toolbar-button toolbar-button-accent'>
            Unlock
          </button>
        </div>
      </form>
    </div>
  );
}
