import { describe, expect, it } from 'vitest';
import {
  officialCharacterSummary,
  parseOfficialAuthUrl,
  trimOfficialCharacter,
} from './trim-official-character';

const fixture: Record<string, unknown> = {
  id: 221090,
  user_id: '3c90c3cc-0d44-4b50-8888-8dd25736052a',
  campaign_id: 9,
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-02T00:00:00Z',
  name: 'Public Fixture',
  level: 7,
  experience: 120,
  hero_points: 1,
  hp_current: 40,
  hp_temp: 0,
  stamina_current: 0,
  resolve_current: 0,
  inventory: { items: [{ id: 'sword' }], coins: { gp: 1 } },
  spells: { slots: [], list: [], focus_point_current: 0, innate_casts: [] },
  operation_data: { selections: { ancestry: 'human' }, notes: { feat: 'kept' } },
  options: { is_public: true },
  variants: { free_archetype: false },
  content_sources: { enabled: [1] },
  custom_operations: [],
  companions: { list: [] },
  notes: { pages: [{ name: 'session', contents: 'x'.repeat(4000) }] },
  roll_history: { rolls: ['x'.repeat(4000)] },
  details: {
    ancestry: { name: 'Human' },
    class: { name: 'Wizard' },
    info: { pronouns: 'they' },
    image_url: 'https://example.test/portrait.jpg',
    api_clients: { client_access: [{ clientId: 'secret', publicUserId: '1', addedAt: 1 }] },
    dice: { presets: ['x'.repeat(2000)] },
    sheet_theme: { color: '#fff' },
  },
  meta_data: {
    active_modes: ['explore'],
    given_item_ids: [4],
    reset_hp: true,
    calculated_stats: { hp_max: 99, ac: 18, profs: { acrobatics: { total: 9, type: 'T' } } },
  },
};

describe('parseOfficialAuthUrl', () => {
  it('reads user_id and client_id from the authorization template', () => {
    const parsed = parseOfficialAuthUrl(
      'https://wanderersguide.app/oauth/access?user_id=3c90c3cc-0d44-4b50-8888-8dd25736052a&client_id=client-1&character_id=<ID>'
    );
    expect(parsed).toEqual({
      userId: '3c90c3cc-0d44-4b50-8888-8dd25736052a',
      clientId: 'client-1',
    });
  });

  it('accepts the numeric public id from the authorization template', () => {
    const parsed = parseOfficialAuthUrl(
      'https://wanderersguide.app/oauth/access?user_id=80879&client_id=a4dac272&character_id=<ID>'
    );
    expect(parsed).toEqual({ userId: '80879', clientId: 'a4dac272' });
  });

  it('rejects a URL that is missing the account ids', () => {
    expect(parseOfficialAuthUrl('https://wanderersguide.app/sheet/221090')).toBeNull();
    expect(parseOfficialAuthUrl('not a url')).toBeNull();
  });
});

describe('trimOfficialCharacter', () => {
  const trimmed = trimOfficialCharacter(fixture);

  it('keeps the build and drops session bulk', () => {
    expect(trimmed.name).toBe('Public Fixture');
    expect(trimmed.level).toBe(7);
    expect(trimmed.operation_data).toEqual({ selections: { ancestry: 'human' }, notes: { feat: 'kept' } });
    expect(trimmed.details).toEqual({
      ancestry: { name: 'Human' },
      class: { name: 'Wizard' },
      info: { pronouns: 'they' },
      image_url: 'https://example.test/portrait.jpg',
    });
    expect(trimmed.meta_data).toEqual({ active_modes: ['explore'], given_item_ids: [4] });
    expect(trimmed).not.toHaveProperty('id');
    expect(trimmed).not.toHaveProperty('user_id');
    expect(trimmed).not.toHaveProperty('campaign_id');
    expect(trimmed).not.toHaveProperty('roll_history');
    expect(trimmed).not.toHaveProperty('notes');
    expect(JSON.stringify(trimmed.details)).not.toContain('api_clients');
    expect(JSON.stringify(trimmed.meta_data)).not.toContain('calculated_stats');
  });

  it('is smaller than the raw row', () => {
    expect(JSON.stringify(trimmed).length).toBeLessThan(JSON.stringify(fixture).length / 2);
  });
});

describe('official listing', () => {
  it('summarizes a listed row without requiring a per-character grant field', () => {
    expect(officialCharacterSummary(fixture)).toEqual({ id: 221090, name: 'Public Fixture', level: 7 });
  });
});
