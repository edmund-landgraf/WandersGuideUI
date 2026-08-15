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
    const oauthError = parseOAuthReturnError(searchParams.toString()) || parseOAuthReturnError(window.location.hash.replace(/^#/, ''));
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
    : 'grid min-h-screen place-items-center bg-p1-page px-6 text-p1-text';
  const formClass = isPhase0
    ? 'mx-auto max-w-md rounded-md border border-slate-800 bg-slate-900 p-6'
    : 'w-full max-w-sm border border-p1-border bg-p1-surface p-7';
  const labelClass = isPhase0 ? 'mt-6 block text-sm text-slate-300' : 'mt-6 block text-xs text-p1-muted';
  const inputClass = isPhase0
    ? 'mt-2 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3'
    : 'mt-2 h-10 w-full border border-p1-border bg-p1-header px-3 text-p1-text';
  const errorClass = isPhase0 ? 'mt-4 text-sm text-red-300' : 'mt-4 text-xs text-p1-danger-soft';
  const oauthButtonClass = isPhase0
    ? 'flex h-10 w-full items-center justify-center gap-3 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-900 disabled:opacity-50'
    : 'flex h-10 w-full items-center justify-center gap-3 border border-p1-border bg-p1-header px-3 text-sm font-medium text-p1-text transition hover:border-p1-accent/40 hover:bg-p1-surface disabled:opacity-50';
  const dividerClass = isPhase0 ? 'my-5 border-t border-slate-800' : 'my-5 border-t border-p1-border';
  const submitClass = isPhase0
    ? 'mt-6 h-10 w-full rounded-md bg-sky-600 font-semibold text-white hover:bg-sky-500 disabled:opacity-50'
    : 'mt-6 h-10 w-full bg-p1-accent font-semibold text-p1-accent-ink hover:bg-p1-accent-soft disabled:opacity-50';
  const backLinkClass = isPhase0
    ? 'mt-5 block text-center text-sm text-slate-400 hover:text-slate-200'
    : 'mt-5 block text-center text-xs text-p1-muted hover:text-p1-text';

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
            <div className='text-[10px] font-semibold uppercase text-p1-accent'>Phase 1</div>
            <h1 className='mt-2 text-2xl font-semibold'>Sign in</h1>
            <p className='mt-2 text-sm text-p1-muted'>This parallel UI uses the same account and backend.</p>
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
              {provider === 'github' && <GitHubMark />}
              {provider === 'discord' && <DiscordMark />}
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
        <label className={isPhase0 ? 'mt-4 block text-sm text-slate-300' : 'mt-4 block text-xs text-p1-muted'}>
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

function DiscordMark() {
  return (
    <svg aria-hidden='true' className='h-5 w-5 shrink-0' viewBox='0 0 24 24' fill='#5865F2'>
      <path d='M20.32 4.37A19.8 19.8 0 0 0 15.89 3l-.2.37a18.3 18.3 0 0 1 4.64 1.5c-4.17-2-8.36-2-12.48 0A17.5 17.5 0 0 1 8.3 3.37L8.11 3A19.9 19.9 0 0 0 3.66 4.39C.5 9.14-.31 13.76.1 18.32A19.9 19.9 0 0 0 6.1 21l.4-.7a13 13 0 0 1-1.9-1.03l.38-.3c3.97 1.87 8.27 1.87 12.2 0l.37.3a12.7 12.7 0 0 1-1.9 1.04l.4.69a19.8 19.8 0 0 0 6-2.67c.48-5.32-.73-9.9-3.73-13.96ZM8.02 15.33c-1.18 0-2.16-1.1-2.16-2.45S6.82 10.44 8.02 10.44s2.18 1.1 2.16 2.44-.98 2.45-2.16 2.45Zm7.96 0c-1.18 0-2.16-1.1-2.16-2.45s.96-2.44 2.16-2.44 2.18 1.1 2.16 2.44-.98 2.45-2.16 2.45Z' />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg aria-hidden='true' className='h-5 w-5 shrink-0' viewBox='0 0 24 24' fill='currentColor'>
      <path d='M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A12 12 0 0 0 12 .3z' />
    </svg>
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
