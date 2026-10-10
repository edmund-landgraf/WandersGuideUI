import { describe, expect, it } from 'vitest';
import { browserSupabaseUrl } from './supabase-client';

describe('browserSupabaseUrl', () => {
  it('keeps local Kong on the page origin in dev so Firefox skips CORS', () => {
    expect(browserSupabaseUrl('http://localhost:8000', 'http://localhost:5194')).toBe('http://localhost:5194');
  });

  it('leaves a remote API URL alone', () => {
    expect(browserSupabaseUrl('https://amba.wandersguide.site', 'http://localhost:5194')).toBe(
      'https://amba.wandersguide.site'
    );
  });
});
