import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ENABLED_OAUTH_PROVIDERS,
  parseOAuthReturnError,
  signInWithEmail,
  signInWithOAuthProvider,
  type OAuthProvider,
} from './campaign-auth';

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Sign in with Google',
  discord: 'Sign in with Discord',
  github: 'Sign in with GitHub',
};

type CampaignSignInProps = {
  variant: 'phase0' | 'phase1';
};

export function CampaignSignIn({ variant }: CampaignSignInProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<OAuthProvider | null>(null);

  useEffect(() => {
    const oauthError = parseOAuthReturnError(searchParams.toString());
    if (!oauthError) return;
    setError(oauthError);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    setBusy(true);
    setError('');
    const result = await signInWithEmail(email, password);
    if (result.error) {
      if (result.error.code === 'invalid_credentials') {
        setError('Invalid email or password. Please try again.');
      } else {
        setError(result.error.message);
      }
    }
    setBusy(false);
  }

  async function handleOAuth(provider: OAuthProvider) {
    setOauthBusy(provider);
    setError('');
    const result = await signInWithOAuthProvider(provider);
    if (result.error) {
      setError(result.error.message);
      setOauthBusy(null);
    }
  }

  const isPhase0 = variant === 'phase0';
  const shellClass = isPhase0
    ? 'min-h-screen bg-slate-950 px-6 py-10 text-slate-100'
    : 'grid min-h-screen place-items-center bg-[#0d1114] px-6 text-[#e7ebed]';
  const formClass = isPhase0
    ? 'mx-auto max-w-md rounded-md border border-slate-800 bg-slate-900 p-6'
    : 'w-full max-w-sm border border-white/10 bg-[#11171a] p-7';
  const labelClass = isPhase0 ? 'mt-6 block text-sm text-slate-300' : 'mt-6 block text-xs text-[#89949a]';
  const inputClass = isPhase0
    ? 'mt-2 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3'
    : 'mt-2 h-10 w-full border border-white/10 bg-[#0b1012] px-3 text-white';
  const errorClass = isPhase0 ? 'mt-4 text-sm text-red-300' : 'mt-4 text-xs text-[#ef8f86]';
  const oauthButtonClass = isPhase0
    ? 'flex h-10 w-full items-center justify-center gap-3 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-900 disabled:opacity-50'
    : 'flex h-10 w-full items-center justify-center gap-3 border border-white/10 bg-[#0b1012] px-3 text-sm font-medium text-white transition hover:border-white/20 hover:bg-[#11171a] disabled:opacity-50';
  const dividerClass = isPhase0 ? 'my-5 border-t border-slate-800' : 'my-5 border-t border-white/10';
  const submitClass = isPhase0
    ? 'mt-6 h-10 w-full rounded-md bg-sky-600 font-semibold text-white hover:bg-sky-500 disabled:opacity-50'
    : 'mt-6 h-10 w-full bg-[#d6a85f] font-semibold text-[#15120d] hover:bg-[#e4ba76] disabled:opacity-50';
  const backLinkClass = isPhase0
    ? 'mt-5 block text-center text-sm text-slate-400 hover:text-slate-200'
    : 'mt-5 block text-center text-xs text-[#7f8a90] hover:text-white';

  return (
    <div className={shellClass}>
      <form className={formClass} method='post' autoComplete='on' onSubmit={submit}>
        {isPhase0 ? (
          <>
            <div className='inline-flex rounded-md border border-slate-700 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-400'>
              Phase 0 read-only
            </div>
            <h1 className='mt-4 text-2xl font-semibold'>Sign in to view campaigns</h1>
            <p className='mt-2 text-sm text-slate-400'>Use the same account as the UI on port 5193.</p>
          </>
        ) : (
          <>
            <div className='text-[10px] font-semibold uppercase text-[#d6a85f]'>Phase 1</div>
            <h1 className='mt-2 text-2xl font-semibold'>Sign in</h1>
            <p className='mt-2 text-sm text-[#7f8a90]'>This parallel UI uses the same account and backend.</p>
          </>
        )}

        <div className='mt-6 space-y-3'>
          {ENABLED_OAUTH_PROVIDERS.map((provider) => (
            <button
              key={provider}
              type='button'
              className={oauthButtonClass}
              disabled={Boolean(oauthBusy) || busy}
              onClick={() => handleOAuth(provider)}
            >
              {provider === 'google' && <GoogleMark />}
              {oauthBusy === provider ? 'Redirecting...' : PROVIDER_LABELS[provider]}
            </button>
          ))}
        </div>

        <div className={dividerClass} />

        <label className={labelClass}>
          Email
          <input
            className={inputClass}
            id='campaign-sign-in-email'
            name='email'
            type='email'
            required
            autoComplete='username'
            defaultValue=''
          />
        </label>
        <label className={isPhase0 ? 'mt-4 block text-sm text-slate-300' : 'mt-4 block text-xs text-[#89949a]'}>
          Password
          <input
            className={inputClass}
            id='campaign-sign-in-password'
            name='password'
            type='password'
            required
            autoComplete='current-password'
            defaultValue=''
          />
        </label>
        {error && <p className={errorClass}>{error}</p>}
        <button className={submitClass} disabled={busy || Boolean(oauthBusy)} type='submit'>
          {busy ? 'Signing in...' : 'Sign in with Email'}
        </button>
        <a href='/' className={backLinkClass}>
          Back to interface chooser
        </a>
      </form>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden='true' className='h-5 w-5 shrink-0' viewBox='0 0 24 24'>
      <path
        fill='#4285F4'
        d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
      />
      <path
        fill='#34A853'
        d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
      />
      <path
        fill='#FBBC05'
        d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
      />
      <path
        fill='#EA4335'
        d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
      />
    </svg>
  );
}
