import { useEffect, useState } from 'react';
import type { SyndicatedNode } from '../../syndication/nodes';
import { deleteOwned, insertNode, listOwned, moveNode, patchOwnedDraft, publishOwned, unpublishOwned, updateOwnedSnapshot } from '../../syndication/store';
import { LauncherHeader } from './launcher-header';
import { SHOP_CONTENT_KIND, shopPublicUrl, type ShopDraft, type ShopPageStyle } from './shops-syndicate';

type ShopNode = SyndicatedNode<ShopDraft>;

export function ShopsLibrary() {
  const [rows, setRows] = useState<ShopNode[]>([]);
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setRows((await listOwned(SHOP_CONTENT_KIND)) as ShopNode[]);
  };

  useEffect(() => {
    void reload().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not load shops.');
    });
  }, []);

  const folders = rows.filter((row) => row.kind === 'folder');
  const shops = rows.filter((row) => row.kind === 'entry');
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this shop.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='dark min-h-screen bg-background font-sans text-foreground antialiased'>
      <div className='bg-pattern' />
      <main className='relative z-10 min-h-screen bg-radial from-gray-800 to-gray-900'>
        <LauncherHeader />
        <section className='px-8 pt-10 pb-16'>
          <div className='mx-auto grid max-w-6xl gap-6'>
            <div className='flex flex-wrap items-end justify-between gap-4'>
              <div>
                <h1 className='font-heading text-4xl text-foreground'>Saved shops</h1>
                <p className='mt-3 max-w-xl text-sm leading-6 text-muted-foreground'>
                  Publish a shop to share a snapshot. Update replaces that snapshot and keeps the same link.
                </p>
              </div>
              <a className='text-sm text-muted-foreground underline' href='/shops'>
                Generate a shop
              </a>
            </div>
            <form
              className='flex flex-wrap items-end gap-3'
              onSubmit={(event) => {
                event.preventDefault();
                const name = folderName.trim();
                if (!name) return;
                void run(async () => {
                  await insertNode({ content_kind: SHOP_CONTENT_KIND, kind: 'folder', name, parent_id: null, draft: null });
                  setFolderName('');
                });
              }}
            >
              <label className='grid gap-2 text-sm text-muted-foreground'>
                New folder
                <input
                  className='rounded-lg bg-card px-3 py-2 text-foreground ring-1 ring-white/15'
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                />
              </label>
              <button className='rounded-lg bg-card px-4 py-2 text-sm text-foreground ring-1 ring-white/15' type='submit' disabled={busy}>
                Create folder
              </button>
            </form>
            {error && <p className='text-sm text-red-300'>{error}</p>}
            <div className='overflow-x-auto rounded-xl bg-white/5 ring-1 ring-white/20'>
              <table className='w-full text-left text-sm'>
                <thead className='text-muted-foreground'>
                  <tr>
                    <th className='px-4 py-3 font-medium'>Name</th>
                    <th className='px-4 py-3 font-medium'>Folder</th>
                    <th className='px-4 py-3 font-medium'>Status</th>
                    <th className='px-4 py-3 font-medium'>Style</th>
                    <th className='px-4 py-3 font-medium'>Actions</th>
                    <th className='px-4 py-3 font-medium'>External link</th>
                  </tr>
                </thead>
                <tbody>
                  {shops.length === 0 ? (
                    <tr>
                      <td className='px-4 py-6 text-muted-foreground' colSpan={6}>
                        No saved shops yet.
                      </td>
                    </tr>
                  ) : shops.map((shop) => (
                    <tr className='border-t border-white/10' key={shop.id}>
                      <td className='px-4 py-3'>
                        <a className='underline' href={`/shops?id=${encodeURIComponent(shop.id)}`}>{shop.name}</a>
                      </td>
                      <td className='px-4 py-3'>
                        <select
                          className='rounded-lg bg-card px-2 py-1 text-foreground ring-1 ring-white/15'
                          value={shop.parent_id ?? ''}
                          disabled={busy}
                          onChange={(event) => {
                            const parentId = event.target.value || null;
                            void run(() => moveNode(shop, parentId));
                          }}
                        >
                          <option value=''>Root</option>
                          {folders.map((folder) => (
                            <option key={folder.id} value={folder.id}>{folder.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className='px-4 py-3'>{shop.published ? 'Published' : 'Draft'}</td>
                      <td className='px-4 py-3'>
                        <select
                          className='rounded-lg bg-card px-2 py-1 text-foreground ring-1 ring-white/15'
                          value={shop.draft?.style ?? 'default'}
                          disabled={busy || !shop.draft}
                          onChange={(event) => {
                            const style = event.target.value as ShopPageStyle;
                            void run(() => patchOwnedDraft(shop, { style }));
                          }}
                        >
                          <option value='default'>Default</option>
                          <option value='homebrew-v3'>Homebrew V3</option>
                        </select>
                      </td>
                      <td className='px-4 py-3'>
                        <div className='flex flex-wrap gap-2'>
                          {shop.published ? (
                            <>
                              <button className='underline' type='button' disabled={busy} onClick={() => void run(() => updateOwnedSnapshot(shop))}>
                                Update
                              </button>
                              <button className='underline' type='button' disabled={busy} onClick={() => void run(() => unpublishOwned(shop))}>
                                Unpublish
                              </button>
                            </>
                          ) : (
                            <button className='underline' type='button' disabled={busy} onClick={() => void run(() => publishOwned(shop))}>
                              Publish
                            </button>
                          )}
                          <button
                            className='underline'
                            type='button'
                            disabled={busy}
                            onClick={() => {
                              const published = shop.published ? ' The public link will stop working.' : '';
                              if (!window.confirm(`Delete “${shop.name}”?${published}`)) return;
                              void run(() => deleteOwned(shop.id));
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                      <td className='px-4 py-3'>
                        <a className='underline' href={`/shops/view/${encodeURIComponent(shop.id)}`} target='_blank' rel='noreferrer'>
                          Preview
                        </a>
                        {shop.published && shop.public_token ? (
                          <>
                            {' · '}
                            <a className='underline' href={shopPublicUrl(shop.public_token)} target='_blank' rel='noreferrer'>
                              {shopPublicUrl(shop.public_token)}
                            </a>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
