import { CampaignSignIn } from '@auth/CampaignSignIn';
import { signOut } from '@auth/campaign-auth';
import { useAuthSession } from '@auth/useAuthSession';
import { getPublicUser, readUserLogins } from '@auth/user-manager';
import { supabase } from '../../supabase-client';
import { GUIDE_BLUE } from '@constants/data';
import { PATREON_AUTH_URL } from '@constants/urls';
import { findApprovedContentUpdates } from '@content/content-update';
import { fetchContentSources, resetContentStore } from '@content/content-store';
import { clearStoragePreservingDisplayPrefs } from '@pages/phase1/display-prefs';
import { makeRequest } from '@requests/request-manager';
import type { Campaign, Character, PublicUser } from '@schemas/content';
import { toLabel } from '@utils/strings';
import { hasPatreonAccess } from '@utils/patreon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { WorkspaceHeader } from './Phase1Workspace';

const SWATCHES = [
  '#25262b', '#868e96', '#fa5252', '#e64980', '#be4bdb', '#8d69f5', '#577deb',
  GUIDE_BLUE, '#15aabf', '#12b886', '#40c057', '#82c91e', '#fab005', '#fd7e14',
];

export function Phase1AccountPage() {
  const session = useAuthSession();
  if (session === undefined) return <div className='grid min-h-screen place-items-center bg-p1-page text-sm text-p1-muted'>Loading...</div>;
  if (!session) return <CampaignSignIn variant='phase1' />;
  return (
    <div className='min-h-screen bg-p1-page text-p1-text'>
      <WorkspaceHeader label='Account' />
      <AccountCard userId={session.user.id} email={session.user.email} />
    </div>
  );
}

function AccountCard({ userId, email }: { userId: string; email?: string }) {
  const queryClient = useQueryClient();
  const loaded = useQuery({
    queryKey: ['phase1-account-self'],
    queryFn: () => getPublicUser(),
  });
  const [user, setUser] = useState<PublicUser | null>(null);
  const dirty = useRef(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.data && !dirty.current) setUser(loaded.data);
  }, [loaded.data]);

  useEffect(() => {
    if (!user || !dirty.current) return;
    const timer = window.setTimeout(() => {
      void makeRequest('update-user', {
        display_name: user.display_name,
        summary: user.summary,
        image_url: user.image_url,
        background_image_url: user.background_image_url,
        site_theme: user.site_theme,
        api: user.api,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [user]);

  const characters = useQuery({
    queryKey: ['phase1-account-characters', userId],
    queryFn: () => makeRequest<Character[]>('find-character', { user_id: userId }),
  });
  const campaigns = useQuery({
    queryKey: ['phase1-account-campaigns', userId],
    queryFn: () => makeRequest<Campaign[]>('find-campaign', { user_id: userId }),
  });
  const bundles = useQuery({
    queryKey: ['phase1-account-bundles', userId],
    queryFn: async () => {
      resetContentStore();
      return (await fetchContentSources('ALL-HOMEBREW-PUBLIC')).filter((source) => source.user_id === userId);
    },
  });
  const logins = useQuery({
    queryKey: ['phase1-account-logins', userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recent_logins');
      if (error || !Array.isArray(data)) return readUserLogins(userId).slice(0, 10);
      return data
        .map((row) => {
          if (typeof row === 'string') return row;
          if (row && typeof row === 'object' && 'logged_in_at' in row) {
            const at = (row as { logged_in_at?: string }).logged_in_at;
            return typeof at === 'string' ? at : '';
          }
          return '';
        })
        .filter(Boolean)
        .slice(0, 10);
    },
  });
  const updates = useQuery({
    queryKey: ['phase1-account-content-updates', user?.user_id],
    enabled: Boolean(user?.user_id),
    queryFn: () => findApprovedContentUpdates(user!.user_id),
  });
  const group = useQuery({
    queryKey: ['phase1-account-gm-group', user?.user_id],
    enabled: user?.patreon?.tier === 'GAME-MASTER',
    queryFn: () => makeRequest<PublicUser[]>('gm-users-in-group', {}),
  });

  function patch(next: PublicUser) {
    dirty.current = true;
    setUser(next);
  }

  if (!user) return <div className='grid min-h-[40vh] place-items-center text-sm text-p1-muted'>Loading account...</div>;

  const patron = patronLabel(user);
  const content = contentLabel(user, updates.data?.length);
  const shareUrl = `${window.location.origin}/gm-share/${user.user_id}?code=${user.patreon?.game_master?.access_code ?? ''}`;

  return (
    <main className='mx-auto w-full max-w-md px-4 py-6'>
      <section className='rounded-lg border border-p1-border bg-p1-surface px-4 py-5'>
        <NameField name={user.display_name} onChange={(display_name) => patch({ ...user, display_name })} />
        {email && <p className='mt-0.5 text-center text-xs text-p1-muted'>{email}</p>}
        {user.summary && <p className='mt-1 text-center text-xs italic text-p1-muted'>{user.summary}</p>}
        <div className='mt-4 grid grid-cols-3 text-center'>
          <Count label='Characters' value={characters.data?.length} />
          <Count label='Bundles' value={bundles.data?.length} />
          <Count label='Campaigns' value={campaigns.data?.length} />
        </div>
        <div className='mt-4 flex flex-wrap justify-center gap-1.5'>
          {user.deactivated && <Badge>Deactivated</Badge>}
          {user.is_admin && <Badge>Admin</Badge>}
          {user.is_mod && <Badge>Mod</Badge>}
          {user.is_developer && <Badge>Developer</Badge>}
          <Badge>{patron}</Badge>
          <Badge>{content}</Badge>
        </div>
      </section>

      <div className='mt-3 space-y-2'>
        <Fold title='Patreon' hint={user.patreon?.tier ? 'Connected' : 'Not connected'}>
          <a href={PATREON_AUTH_URL} className='inline-flex rounded-md border border-p1-border px-3 py-1.5 text-sm hover:bg-p1-hover'>
            {user.patreon?.tier ? 'Patreon connected' : 'Connect to Patreon'}
          </a>
          {user.patreon?.tier === 'GAME-MASTER' && (
            <div className='mt-3 space-y-2 text-sm'>
              <p>Users in your group ({group.data?.length ?? '…'} / 99)</p>
              <ul className='rounded border border-p1-border'>
                {(group.data ?? []).map((member) => (
                  <li key={member.user_id} className='flex items-center justify-between gap-2 border-b border-p1-border px-2 py-1 last:border-b-0'>
                    <span>{member.display_name}</span>
                    <button type='button' className='text-xs text-p1-muted hover:text-p1-text' onClick={() => {
                      if (!window.confirm(`Remove ${member.display_name} from your group?`)) return;
                      setBusy(true);
                      void makeRequest('gm-remove-from-group', { user_id: member.user_id }).then(() => group.refetch()).finally(() => setBusy(false));
                    }}>Remove</button>
                  </li>
                ))}
                {group.data?.length === 0 && <li className='px-2 py-2 text-p1-muted'>No one yet. Share your link.</li>}
              </ul>
              <p className='break-all text-xs text-p1-muted'>{shareUrl}</p>
              <div className='flex gap-2'>
                <button type='button' className='rounded-md border border-p1-border px-2 py-1 text-xs hover:bg-p1-hover' onClick={() => void navigator.clipboard.writeText(shareUrl)}>Copy</button>
                <button type='button' className='rounded-md border border-p1-border px-2 py-1 text-xs hover:bg-p1-hover' disabled={busy} onClick={() => {
                  setBusy(true);
                  void makeRequest('gm-regenerate-code', {}).then(async () => {
                    const next = await getPublicUser();
                    if (next) patch(next);
                  }).finally(() => setBusy(false));
                }}>Regenerate</button>
              </div>
            </div>
          )}
        </Fold>

        <Fold title='Appearance'>
          <label className='block text-sm'>Theme color</label>
          <div className='mt-2 flex flex-wrap gap-1.5'>
            {SWATCHES.map((color) => (
              <button
                key={color}
                type='button'
                aria-label={color}
                className='h-5 w-5 rounded-full border border-white/30'
                style={{ background: color, outline: (user.site_theme?.color || GUIDE_BLUE) === color ? '2px solid white' : undefined }}
                onClick={() => {
                  if (!hasPatreonAccess(user, 1)) {
                    setNotice('Theme color is available to patrons.');
                    return;
                  }
                  setNotice('');
                  patch({ ...user, site_theme: { ...user.site_theme, color } });
                }}
              />
            ))}
          </div>
          {notice && <p className='mt-2 text-xs text-p1-muted'>{notice}</p>}
          <Toggle
            label='Dyslexia font'
            checked={user.site_theme?.dyslexia_font ?? false}
            onChange={(dyslexia_font) => patch({ ...user, site_theme: { ...user.site_theme, dyslexia_font } })}
          />
          <label className='mt-3 block text-sm'>UI size <span className='text-p1-muted'>{(user.site_theme?.zoom ?? 1).toFixed(2)}</span></label>
          <input
            className='mt-1 w-full'
            type='range'
            min={0.75}
            max={1.5}
            step={0.01}
            value={user.site_theme?.zoom ?? 1}
            onChange={(event) => patch({ ...user, site_theme: { ...user.site_theme, zoom: Number(event.target.value) } })}
          />
        </Fold>

        <Fold title='Developer'>
          <Toggle
            label='View operations'
            checked={user.site_theme?.view_operations ?? false}
            onChange={(view_operations) => patch({ ...user, site_theme: { ...user.site_theme, view_operations } })}
          />
          <div className='mt-3 flex items-center justify-between'>
            <span className='text-sm'>API clients</span>
            <button type='button' className='text-sm text-p1-accent' onClick={() => {
              const clients = [...(user.api?.clients ?? []), {
                name: 'New Client',
                id: crypto.randomUUID().split('-')[0],
                api_key: crypto.randomUUID(),
                image_url: 'icon|||abstract064|||#359fdf',
              }];
              patch({ ...user, api: { ...user.api, clients } });
            }}>Add</button>
          </div>
          <div className='mt-2 space-y-2'>
            {(user.api?.clients ?? []).map((client) => {
              const authUrl = `${window.location.origin}/oauth/access?user_id=${user.id}&client_id=${client.id}&character_id=<ID>`;
              return (
                <div key={client.id} className='rounded border border-p1-border p-2 text-xs'>
                  <div className='flex items-center gap-2'>
                    <input
                      className='min-w-0 flex-1 rounded border border-p1-border bg-transparent px-2 py-1 text-sm'
                      value={client.name}
                      onChange={(event) => patch({
                        ...user,
                        api: { ...user.api, clients: user.api?.clients?.map((item) => item.id === client.id ? { ...item, name: event.target.value } : item) },
                      })}
                    />
                    <button type='button' className='shrink-0 rounded border border-red-800 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-800 hover:text-white' onClick={() => {
                      if (!window.confirm(`Delete API client “${client.name}”? Its key will stop working.`)) return;
                      patch({
                        ...user,
                        api: { ...user.api, clients: user.api?.clients?.filter((item) => item.id !== client.id) },
                      });
                    }}>Delete</button>
                  </div>
                  <CopyRow label='Key' value={client.api_key} />
                  <CopyRow label='Auth URL' value={authUrl} />
                </div>
              );
            })}
            {(user.api?.clients ?? []).length === 0 && <p className='text-xs text-p1-muted'>No API clients yet.</p>}
          </div>
        </Fold>

        <Fold title='Account'>
          <div className='flex flex-wrap gap-2'>
            <button type='button' className='rounded-md border border-p1-border px-3 py-1.5 text-sm hover:bg-p1-hover' onClick={() => void signOut()}>Sign out</button>
            <button type='button' className='rounded-md bg-red-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-900' onClick={() => {
              if (!window.confirm('Delete this account and all characters, homebrew, campaigns, and encounters?')) return;
              setBusy(true);
              void makeRequest('delete-user', {}).then((result) => {
                if (!result) {
                  setNotice('Could not delete the account. Ask for help on Discord.');
                  return;
                }
                void signOut();
                clearStoragePreservingDisplayPrefs();
                queryClient.clear();
              }).finally(() => setBusy(false));
            }}>Delete account</button>
          </div>
        </Fold>

        <Fold title='Logins'>
          <ul className='space-y-1 text-sm'>
            {(logins.data ?? []).length === 0 ? (
              <li className='text-p1-muted'>No logins recorded yet.</li>
            ) : (
              (logins.data ?? []).map((iso) => (
                <li key={iso}>
                  {new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </li>
              ))
            )}
          </ul>
        </Fold>
      </div>
    </main>
  );
}

function NameField({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        className='mx-auto block w-full max-w-[16rem] rounded border border-p1-border bg-transparent px-2 py-1 text-center text-lg'
        value={name}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => { if (event.key === 'Enter') setEditing(false); }}
      />
    );
  }
  return (
    <button type='button' className='mx-auto block text-lg font-medium' onClick={() => setEditing(true)}>
      {name || 'Unknown User'}
    </button>
  );
}

function Count({ label, value }: { label: string; value?: number }) {
  return (
    <div>
      <div className='text-xl font-semibold'>{value ?? '…'}</div>
      <div className='text-xs text-p1-muted'>{label}</div>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className='rounded-full border border-p1-border bg-p1-hover px-2 py-0.5 text-[11px]'>{children}</span>;
}

function Fold({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <details className='rounded-lg border border-p1-border bg-p1-surface px-3 py-2'>
      <summary className='flex cursor-pointer list-none items-center justify-between text-sm'>
        <span>{title}</span>
        {hint && <span className='text-xs text-p1-muted'>{hint}</span>}
      </summary>
      <div className='pt-3'>{children}</div>
    </details>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className='mt-2 flex items-start gap-2'>
      <p className='min-w-0 flex-1 break-all text-p1-muted'><span className='text-p1-text'>{label}: </span>{value}</p>
      <button
        type='button'
        className='shrink-0 rounded border border-p1-border px-2 py-0.5 text-xs text-p1-text hover:bg-p1-hover'
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className='mt-3 flex items-center justify-between gap-3 text-sm'>
      <span>{label}</span>
      <input type='checkbox' checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function patronLabel(user: PublicUser) {
  let label = toLabel(user.patreon?.tier) || 'Non-Patron';
  if ((label === 'Non-Patron' || label === 'Advocate') && user.patreon?.game_master?.virtual_tier?.game_master_user_id) {
    label = 'Wanderer (Virtual)';
  }
  return label;
}

function contentLabel(user: PublicUser, count?: number) {
  if (count == null) return 'New User';
  if (count >= 100 || user.is_community_paragon) return `Content Connoisseur (${count})`;
  if (count >= 50) return `Content Conservator (${count})`;
  if (count > 0) return `Content Contributor (${count})`;
  return 'New User';
}
