import { describe, expect, it, vi } from 'vitest';
import { campaignCopyAssetAction, stageCampaignCopyAssets } from './phase1-campaign-copy-art';

describe('campaign copy artwork', () => {
  it('keeps shared external and catalog references', () => {
    expect(campaignCopyAssetAction('https://cdn.example/monster.png')).toEqual({ kind: 'keep', url: 'https://cdn.example/monster.png' });
    expect(campaignCopyAssetAction('/api/monsters/123/image/thumb').kind).toBe('keep');
  });

  it('rehosts site-relative and public storage assets', () => {
    expect(campaignCopyAssetAction('/backgrounds/map.webp')).toMatchObject({ kind: 'upload', category: 'backgrounds' });
    expect(campaignCopyAssetAction('http://kong:8000/storage/v1/object/public/portraits/old/a.png')).toMatchObject({ kind: 'upload', category: 'portraits' });
    expect(() => campaignCopyAssetAction('/storage/v1/object/sign/portraits/old/a.png')).toThrow(/Private or signed/);
    expect(() => campaignCopyAssetAction('blob:temporary')).toThrow();
  });

  it('deduplicates artwork and resumes after a failed upload', async () => {
    const staged: Record<string, string> = {};
    const persist = vi.fn();
    const migrate = vi.fn(async (url: string) => 'new:' + url);
    migrate.mockRejectedValueOnce(new Error('unavailable'));
    await expect(stageCampaignCopyAssets(['a', 'a', 'b'], staged, persist, migrate)).rejects.toThrow(/1 of 2/);
    expect(staged).toEqual({});
    await stageCampaignCopyAssets(['a', 'a'], staged, persist, migrate);
    migrate.mockRejectedValueOnce(new Error('upload failed'));
    await expect(stageCampaignCopyAssets(['a', 'b'], staged, persist, migrate)).rejects.toThrow(/2 of 2/);
    expect(staged).toEqual({ a: 'new:a' });
    await stageCampaignCopyAssets(['a', 'b', 'b'], staged, persist, migrate);
    expect(staged).toEqual({ a: 'new:a', b: 'new:b' });
    expect(migrate.mock.calls.map(([url]) => url)).toEqual(['a', 'a', 'b', 'b']);
    expect(persist).toHaveBeenCalledTimes(2);
  });
});
