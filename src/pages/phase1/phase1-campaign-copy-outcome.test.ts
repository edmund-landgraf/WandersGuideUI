import { describe, expect, it } from 'vitest';
import { campaignArtCopyAction, campaignArtCopyOutcome } from './phase1-campaign-copy';

describe('copy artwork reporting', () => {
  const source = '/backgrounds/banner.png';
  const target = 'https://amba.wandersguide.site/storage/v1/object/public/backgrounds/new/banner.png';
  it('reports confirmed staged re-host separately from intentional external retention', () => {
    expect(campaignArtCopyOutcome(source,target,{[source]:target})).toBe('rehosted');
    expect(campaignArtCopyOutcome('https://cdn.example/art.png','https://cdn.example/art.png')).toBe('kept');
    expect(campaignArtCopyOutcome(source,target)).toBe('unverified');
    expect(campaignArtCopyOutcome(source,source,{[source]:source})).toBe('unverified');
    expect(campaignArtCopyOutcome('')).toBe('none');
  });
  it('uses the real transfer classifier for dry runs', () => {
    expect(campaignArtCopyAction('https://wgui.wandersguide.site/backgrounds/banner.png')).toBe('rehost');
    expect(campaignArtCopyAction('blob:temporary')).toBe('blocked');
    expect(campaignArtCopyAction('https://cdn.example/art.png')).toBe('keep');
  });
});
