import type { APIRequestContext, Page } from '@playwright/test';

export type E2eUser = { email: string; password: string };

function supabaseUrl() {
  const url = process.env.E2E_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!url) throw new Error('Set E2E_SUPABASE_URL or VITE_SUPABASE_URL for account signup.');
  return url.replace(/\/$/, '');
}

function anonKey() {
  const key = process.env.E2E_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY;
  if (!key) throw new Error('Set E2E_SUPABASE_ANON_KEY or VITE_SUPABASE_KEY for account signup.');
  return key;
}

export function uniqueUser(role: string): E2eUser {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `e2e.${role}.${stamp}@wanderersguide.test`,
    password: 'E2ePass123!',
  };
}

export async function ensureUser(request: APIRequestContext, user: E2eUser) {
  const response = await request.post(`${supabaseUrl()}/auth/v1/signup`, {
    headers: {
      apikey: anonKey(),
      Authorization: `Bearer ${anonKey()}`,
      'Content-Type': 'application/json',
    },
    data: { email: user.email, password: user.password },
  });
  if (response.ok()) return;
  const body = await response.text();
  if (response.status() === 422 && /already/i.test(body)) return;
  throw new Error(`signup ${user.email} failed (${response.status()}): ${body}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function invokeEdge<T>(request: APIRequestContext, functionName: string, body: Record<string, unknown>, accessToken: string): Promise<T> {
  const response = await withTimeout(
    request.post(`${supabaseUrl()}/functions/v1/${functionName}`, {
      headers: {
        apikey: anonKey(),
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: body,
    }),
    25_000,
    functionName
  );
  const json = await withTimeout(response.json(), 5_000, `${functionName} json`);
  if (!response.ok() || json?.status !== 'success') {
    throw new Error(`${functionName} failed (${response.status()}): ${JSON.stringify(json)}`);
  }
  return json.data as T;
}

export async function pageAccessToken(page: Page) {
  const token = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.includes('auth-token')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { access_token?: string };
        if (parsed.access_token) return parsed.access_token;
      } catch {
        // Keep scanning other keys.
      }
    }
    return null;
  });
  if (!token) throw new Error('No Supabase access token in page storage.');
  return token;
}

export async function signInPhase1(page: Page, user: E2eUser) {
  await page.goto('/phase1');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in with Email' }).click();
  await page.getByRole('heading', { name: 'Campaign workspace' }).waitFor({ timeout: 30_000 });
}
