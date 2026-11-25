import { describe, expect, it, vi } from 'vitest';
import { campaignCopyAssetAction, migrateCampaignCopyAsset, stageCampaignCopyAssets } from './phase1-campaign-copy-art';

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

const png = new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
const oldUrl = 'https://amba.wandersguide.site/storage/v1/object/public/backgrounds/old/banner.png';
const newUrl = 'https://amba.wandersguide.site/storage/v1/object/public/backgrounds/new/banner.png';
const image = (bytes = png, mime = 'image/png') => new Response(bytes, { headers: { 'content-type': mime } });

describe('strict artwork transfer', () => {
  it('keeps intentional external links without fetch or upload', async () => {
    const fetchImage = vi.fn<typeof fetch>();
    const upload = vi.fn(async () => newUrl);
    await expect(migrateCampaignCopyAsset('https://cdn.example/banner.png', { fetchImage, upload })).resolves.toBe('https://cdn.example/banner.png');
    expect(fetchImage).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([403,404,500])('rejects source HTTP %s rather than falling back', async (status) => {
    const fetchImage = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    const upload = vi.fn(async () => newUrl);
    await expect(migrateCampaignCopyAsset('/backgrounds/banner.png', { fetchImage, upload })).rejects.toThrow('HTTP ' + status);
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports CORS/network failure and rejects unsupported or mislabeled data', async () => {
    const fetchImage = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const upload = vi.fn(async () => newUrl);
    await expect(migrateCampaignCopyAsset(oldUrl, { fetchImage, upload })).rejects.toThrow(/CORS/);
    fetchImage.mockResolvedValueOnce(image(png,'text/html')).mockResolvedValueOnce(image(new Uint8Array([1,2,3])));
    await expect(migrateCampaignCopyAsset(oldUrl, { fetchImage, upload })).rejects.toThrow(/PNG, JPEG, or WebP/);
    await expect(migrateCampaignCopyAsset(oldUrl, { fetchImage, upload })).rejects.toThrow(/does not match/);
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(['',oldUrl,oldUrl+'?download=1','https://other.example/storage/v1/object/public/backgrounds/new/banner.png'])('rejects invalid upload receipt %s', async (url) => {
    const fetchImage = vi.fn<typeof fetch>().mockResolvedValueOnce(image());
    await expect(migrateCampaignCopyAsset(oldUrl, { fetchImage, upload: async () => url })).rejects.toThrow(/upload/i);
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it('propagates uploader failure and rejects unreadable or different destination bytes', async () => {
    const fetchImage = vi.fn<typeof fetch>().mockResolvedValueOnce(image());
    await expect(migrateCampaignCopyAsset(oldUrl, { fetchImage, upload: async () => { throw new Error('quota exceeded'); } })).rejects.toThrow(/quota exceeded/);
    fetchImage.mockResolvedValueOnce(image()).mockResolvedValueOnce(new Response(null,{status:404}));
    await expect(migrateCampaignCopyAsset(oldUrl, { fetchImage, upload: async () => newUrl })).rejects.toThrow(/Uploaded artwork.*404/);
    fetchImage.mockResolvedValueOnce(image()).mockResolvedValueOnce(image(new Uint8Array([...png,4])));
    await expect(migrateCampaignCopyAsset(oldUrl, { fetchImage, upload: async () => newUrl })).rejects.toThrow(/differs/);
  });

  it('accepts a new anonymously readable object containing the same image', async () => {
    const fetchImage = vi.fn<typeof fetch>().mockResolvedValueOnce(image()).mockResolvedValueOnce(image());
    const upload = vi.fn(async () => newUrl);
    await expect(migrateCampaignCopyAsset('/backgrounds/banner.png', { fetchImage, upload })).resolves.toBe(newUrl);
    expect(upload).toHaveBeenCalledWith(png,'image/png','backgrounds');
    expect(fetchImage).toHaveBeenLastCalledWith(newUrl, expect.objectContaining({ credentials:'omit',cache:'no-store' }));
  });
});
