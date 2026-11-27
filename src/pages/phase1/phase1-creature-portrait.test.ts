import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreaturePortrait } from './phase1-creature-portrait';
import { clearArtPassword, unlockMonsterArt } from './phase1-monster-image';

const publicUrl = 'https://portraits.example.test/coal.png';
const correctedUrl = 'https://portraits.example.test/corrected.png';
const signedUrl = 'https://pf2.unwhelm.online/api/monsters/-1011/image';
const calls: { path: string; init?: RequestInit }[] = [];
const broken = new Set<string>();
let thumbStatus = 404;
let fullStatus = 200;
let expireFirstImage = false;
let ambiguous = false;
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;

function response(status: number, body?: unknown, bytes?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob([bytes ?? 'fixture'], { type: 'image/png' }),
  } as Response;
}

class ProbeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  referrerPolicy = '';
  set src(value: string) {
    queueMicrotask(() => broken.has(value) ? this.onerror?.() : this.onload?.());
  }
}

// Mounted DOM consumer of the same hook used by the actual roster, inspector
// icon and packed stat cards. The only fakes are transport and image decode.
function Portrait({ name, source }: { name: string; source: string }) {
  const art = useCreaturePortrait(name, source);
  return art.src
    ? createElement('img', { key: art.src, src: art.src, onError: art.onError, referrerPolicy: 'no-referrer' })
    : createElement('span', { 'data-missing': 'true' }, 'No artwork');
}
async function render(name: string, source: string) {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Portrait, { name, source })));
  });
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  expect(predicate()).toBe(true);
}
const img = () => host.querySelector('img');
const src = () => img()?.getAttribute('src') ?? '';
const data = () => src().startsWith('data:image/png;base64,');
async function failRenderedImage() {
  expect(img()).not.toBeNull();
  await act(async () => { img()!.dispatchEvent(new Event('error')); });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  clearArtPassword();
  calls.length = 0;
  broken.clear();
  thumbStatus = 404;
  fullStatus = 200;
  expireFirstImage = false;
  ambiguous = false;
  vi.stubGlobal('Image', ProbeImage);
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'https://fixture.invalid');
    const path = url.pathname.replace(/^\/local-pf/, '');
    calls.push({ path, init });
    if (path === '/api/art/unlock') return response(200);
    if (path === '/api/monsters') return response(200, { rows: [{ MonsterId: -1011, Name: 'Animated Coal' }, { MonsterId: 4, Name: 'Greater Animated Coal' }] });
    if (path === '/api/npcs') return response(200, { rows: ambiguous ? [{ MonsterId: 99, Name: 'Animated Coal' }] : [] });
    if (path.startsWith('/api/user-monsters/1011/image')) {
      if (expireFirstImage) { expireFirstImage = false; return response(401); }
      return path.endsWith('/thumb') ? response(thumbStatus, undefined, 'thumb-fixture') : response(fullStatus, undefined, 'full-fixture');
    }
    throw new Error('Unexpected fetch ' + path);
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  clearArtPassword();
  vi.unstubAllGlobals();
});

describe('mounted creature portrait recovery (#64)', () => {
  it('validates public art without credentials, then recovers after a real render error', async () => {
    await render('Animated Coal', publicUrl);
    await until(() => src() === publicUrl);
    expect(calls).toHaveLength(0);
    await unlockMonsterArt('fixture-password');
    // A URL can pass the first probe and fail by the time the DOM renders it.
    await failRenderedImage();
    await until(data);
    expect(calls.map(call => call.path)).toContain('/api/user-monsters/1011/image/thumb');
    expect(calls.map(call => call.path)).toContain('/api/user-monsters/1011/image');
    expect(calls.every(call => !call.path.includes('/api/monsters/-1011'))).toBe(true);
    expect(img()?.getAttribute('referrerpolicy')).toBe('no-referrer');
    // A second error is bounded, rather than retrying forever.
    await failRenderedImage();
    await until(() => Boolean(host.querySelector('[data-missing]')));
    const before = calls.length;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
    expect(calls).toHaveLength(before);
    await render('Animated Coal', correctedUrl);
    await until(() => src() === correctedUrl);
  });

  it('does not put a protected raw URL in the DOM; unlock refreshes a cached miss and retries an expired session', async () => {
    await render('Animated Coal', signedUrl);
    expect(img()).toBeNull();
    await until(() => client.getQueryData(['phase1-creature-picker-art', 'Animated Coal', signedUrl]) === null);
    expect(calls).toHaveLength(0);
    await unlockMonsterArt('fixture-password');
    expireFirstImage = true;
    await act(async () => { await client.invalidateQueries({ queryKey: ['phase1-creature-picker-art'] }); });
    await until(data);
    expect(calls.filter(call => call.path === '/api/art/unlock')).toHaveLength(2);
    expect(calls.filter(call => call.path === '/api/user-monsters/1011/image/thumb')).toHaveLength(2);
    expect(calls.some(call => call.path === '/api/user-monsters/1011/image')).toBe(true);
    expect(calls.filter(call => call.path.includes('/image')).every(call => call.init?.credentials === 'include')).toBe(true);
    expect(calls.every(call => !call.path.includes('/api/monsters/-1011'))).toBe(true);
  });

  it('never substitutes partial or ambiguous identities when public art is broken', async () => {
    await unlockMonsterArt('fixture-password');
    ambiguous = true;
    broken.add(publicUrl);
    await render('Animated Coal', publicUrl);
    await until(() => client.getQueryData(['phase1-creature-picker-art', 'Animated Coal', publicUrl]) === null);
    expect(img()).toBeNull();
    expect(calls.some(call => call.path.includes('/image'))).toBe(false);
    await render('Unknown creature', publicUrl);
    await until(() => client.getQueryData(['phase1-creature-picker-art', 'Unknown creature', publicUrl]) === null);
    expect(img()).toBeNull();
    expect(calls.some(call => call.path.includes('/image'))).toBe(false);
  });

  it('uses the full variant when the thumbnail fails and never displays rejected bytes again', async () => {
    await unlockMonsterArt('fixture-password');
    await render('Animated Coal', signedUrl);
    await until(data);
    const first = src();
    // The cached full variant is now broken at render time. A new verified
    // thumbnail is available and should be selected, even if full returns 200.
    thumbStatus = 200;
    await failRenderedImage();
    await until(() => data() && src() !== first);
    expect(calls.filter(call => call.path.endsWith('/thumb'))).toHaveLength(2);
    expect(src()).toBe('data:image/png;base64,' + btoa('thumb-fixture'));
  });
});
