import { useEffect, useState } from 'react';
import type { SyndicatedNode } from '../../syndication/nodes';
import { deleteOwned, insertNode, listOwned, moveNode, patchOwnedDraft, publishOwned, unpublishOwned, updateOwned, updateOwnedSnapshot } from '../../syndication/store';
import { LauncherHeader } from './launcher-header';
import { SHOP_CONTENT_KIND, shopPublicUrl, shopTraceStart, type ShopDraft, type ShopPageStyle } from './shops-syndicate';

type ShopNode = SyndicatedNode<ShopDraft>;

export function ShopsLibrary() {
  const [rows, setRows] = useState<ShopNode[]>([]);
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const reload = async () => {
    const done = shopTraceStart('library list');
    const rows = (await listOwned(SHOP_CONTENT_KIND)) as ShopNode[];
    done({ rows: rows.length });
    setRows(rows);
  };

  useEffect(() => {
    void reload().catch((cause: unknown) => {
      console.error('[wgui shops] library list failed', cause);
      setError(cause instanceof Error ? cause.message : 'Could not load shops.');
    });
  }, []);

  const folders = rows.filter((row) => row.kind === 'folder');
  const shops = rows.filter((row) => row.kind === 'entry');
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await work();
      await reload();
      setNote(done);
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
                }, 'Folder created.');
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
            {note && <p className='text-sm text-muted-foreground'>{note}</p>}
            <FolderTree
              folders={folders}
              shops={shops}
              busy={busy}
              dropTarget={dropTarget}
              renamingId={renamingId}
              renameDraft={renameDraft}
              onRenameDraft={setRenameDraft}
              onStartRename={(folder) => {
                setRenamingId(folder.id);
                setRenameDraft(folder.name);
              }}
              onCancelRename={() => setRenamingId(null)}
              onCommitRename={(folder) => {
                const name = renameDraft.trim();
                if (!name || name === folder.name) {
                  setRenamingId(null);
                  return;
                }
                void run(async () => {
                  await updateOwned(folder, { name });
                  setRenamingId(null);
                }, 'Folder renamed.');
              }}
              onDeleteFolder={(folder) => {
                const inside = shops.filter((shop) => shop.parent_id === folder.id);
                const extra = inside.length ? ` ${inside.length} shop${inside.length === 1 ? '' : 's'} inside will be deleted too.` : '';
                if (!window.confirm(`Delete folder “${folder.name}”?${extra}`)) return;
                void run(() => deleteOwned(folder.id), 'Folder deleted.');
              }}
              onDragTarget={setDropTarget}
              onDropShop={(folderId, folderName, shopId) => {
                const shop = shops.find((row) => row.id === shopId);
                if (!shop) return;
                const parentId = folderId || null;
                if ((shop.parent_id ?? null) === parentId) return;
                void run(() => moveNode(shop, parentId), parentId ? `Moved to ${folderName}.` : 'Moved to Root.');
              }}
            />
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
                        <a
                          className='cursor-grab underline active:cursor-grabbing'
                          href={`/shops?id=${encodeURIComponent(shop.id)}`}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData('application/x-wgui-shop', shop.id);
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                        >
                          {shop.name}
                        </a>
                      </td>
                      <td className='px-4 py-3'>
                        <select
                          className='rounded-lg bg-card px-2 py-1 text-foreground ring-1 ring-white/15'
                          value={shop.parent_id ?? ''}
                          disabled={busy}
                          onChange={(event) => {
                            const parentId = event.target.value || null;
                            void run(() => moveNode(shop, parentId), 'Folder updated.');
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
                            void run(() => patchOwnedDraft(shop, { style }), 'Style updated.');
                          }}
                        >
                          <option value='default'>Default</option>
                          <option value='homebrew-v3'>Homebrew V3</option>
                        </select>
                      </td>
                      <td className='px-4 py-3'>
                        <div className='flex flex-col items-start'>
                          {shop.published ? (
                            <>
                              <button className='shop-action' type='button' disabled={busy} onClick={() => void run(() => updateOwnedSnapshot(shop), 'Snapshot updated. The public link is unchanged.')}>
                                Update
                              </button>
                              <button className='shop-action' type='button' disabled={busy} onClick={() => void run(() => unpublishOwned(shop), 'Unpublished. The public link is off.')}>
                                Unpublish
                              </button>
                            </>
                          ) : (
                            <button className='shop-action' type='button' disabled={busy} onClick={() => void run(() => publishOwned(shop), 'Published.')}>
                              Publish
                            </button>
                          )}
                          <button
                            className='shop-action'
                            type='button'
                            disabled={busy}
                            onClick={() => {
                              const published = shop.published ? ' The public link will stop working.' : '';
                              if (!window.confirm(`Delete “${shop.name}”?${published}`)) return;
                              void run(() => deleteOwned(shop.id), 'Deleted.');
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

function FolderTree({
  folders,
  shops,
  busy,
  dropTarget,
  renamingId,
  renameDraft,
  onRenameDraft,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onDeleteFolder,
  onDragTarget,
  onDropShop,
}: {
  folders: ShopNode[];
  shops: ShopNode[];
  busy: boolean;
  dropTarget: string | null;
  renamingId: string | null;
  renameDraft: string;
  onRenameDraft: (value: string) => void;
  onStartRename: (folder: ShopNode) => void;
  onCancelRename: () => void;
  onCommitRename: (folder: ShopNode) => void;
  onDeleteFolder: (folder: ShopNode) => void;
  onDragTarget: (id: string | null) => void;
  onDropShop: (folderId: string, folderName: string, shopId: string) => void;
}) {
  const branches = [{ id: '', name: 'Root', node: null as ShopNode | null }, ...folders.map((folder) => ({ id: folder.id, name: folder.name, node: folder }))];
  return (
    <div className='max-w-md rounded-xl bg-white/5 p-3 ring-1 ring-white/20'>
      <p className='px-2 pb-2 text-xs uppercase tracking-wide text-muted-foreground'>Folders</p>
      <ul className='grid gap-1'>
        {branches.map((branch) => {
          const children = shops.filter((shop) => (shop.parent_id ?? '') === branch.id);
          return (
            <li key={branch.id || 'root'}>
              <div
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ring-1 ${dropTarget === branch.id ? 'bg-white/15 ring-white/50' : 'bg-card ring-white/15'}`}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes('application/x-wgui-shop')) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  onDragTarget(branch.id);
                }}
                onDragLeave={() => onDragTarget(dropTarget === branch.id ? null : dropTarget)}
                onDrop={(event) => {
                  event.preventDefault();
                  onDragTarget(null);
                  const shopId = event.dataTransfer.getData('application/x-wgui-shop');
                  if (shopId) onDropShop(branch.id, branch.name, shopId);
                }}
              >
                <span className='text-muted-foreground' aria-hidden>{children.length ? '▾' : '▸'}</span>
                {branch.node && renamingId === branch.node.id ? (
                  <input
                    className='min-w-0 flex-1 rounded bg-background px-2 py-1 text-foreground ring-1 ring-white/20'
                    value={renameDraft}
                    autoFocus
                    onChange={(event) => onRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onCommitRename(branch.node!);
                      if (event.key === 'Escape') onCancelRename();
                    }}
                  />
                ) : (
                  <span className='min-w-0 flex-1 truncate'>{branch.name}</span>
                )}
                <span className='text-xs text-muted-foreground'>{children.length}</span>
                {branch.node && renamingId === branch.node.id ? (
                  <>
                    <button className='text-xs underline' type='button' disabled={busy} onClick={() => onCommitRename(branch.node!)}>Save</button>
                    <button className='text-xs underline' type='button' onClick={onCancelRename}>Cancel</button>
                  </>
                ) : branch.node ? (
                  <>
                    <button className='text-xs underline' type='button' disabled={busy} onClick={() => onStartRename(branch.node!)}>Rename</button>
                    <button className='text-xs underline' type='button' disabled={busy} onClick={() => onDeleteFolder(branch.node!)}>Delete</button>
                  </>
                ) : null}
              </div>
              {children.length > 0 && (
                <ul className='ml-6 border-l border-white/15 py-1 pl-3'>
                  {children.map((shop) => (
                    <li key={shop.id} className='truncate py-0.5 text-sm text-muted-foreground'>
                      <a className='underline' href={`/shops?id=${encodeURIComponent(shop.id)}`}>{shop.name}</a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
