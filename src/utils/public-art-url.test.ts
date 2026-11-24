import { describe, expect, it } from 'vitest';
import { isSiteRelativeArtPath, publicArtSrc, publicStorageObjectUrl } from './public-art-url';

const ORIGIN = 'https://wgui.wandersguide.site';

describe('publicArtSrc', () => {
  it('expands site-relative portrait files onto the public asset host', () => {
    expect(publicArtSrc('/portraits/thalanis-reed.jpg', ORIGIN)).toBe(
      'https://wgui.wandersguide.site/portraits/thalanis-reed.jpg',
    );
    expect(publicArtSrc('  /backgrounds/woods.webp  ', ORIGIN)).toBe(
      'https://wgui.wandersguide.site/backgrounds/woods.webp',
    );
  });

  it('leaves absolute links and non-art paths alone', () => {
    expect(publicArtSrc('https://cdn.example/portraits/a.png', ORIGIN)).toBe('https://cdn.example/portraits/a.png');
    expect(publicArtSrc('//evil.example/portraits/a.jpg', ORIGIN)).toBe('//evil.example/portraits/a.jpg');
    expect(publicArtSrc('/sheet/134', ORIGIN)).toBe('/sheet/134');
    expect(publicArtSrc('/portraits/../auth/v1', ORIGIN)).toBe('/portraits/../auth/v1');
    expect(isSiteRelativeArtPath('/portraits/thalanis-reed.jpg')).toBe(true);
    expect(isSiteRelativeArtPath('/sheet/134')).toBe(false);
  });

  it('rewrites internal storage hosts and keeps the object path', () => {
    const internal = 'http://kong:8000/storage/v1/object/public/portraits/user/a%20b.jpeg?download=1';
    const expected = 'https://amba.wandersguide.site/storage/v1/object/public/portraits/user/a%20b.jpeg?download=1';
    expect(publicStorageObjectUrl(internal, 'https://amba.wandersguide.site')).toBe(expected);
    expect(publicArtSrc(internal, ORIGIN, 'https://amba.wandersguide.site')).toBe(expected);
    expect(publicStorageObjectUrl('https://api.wanderersguide.app/storage/v1/object/public/portraits/default/Fayden.jpg', 'https://amba.wandersguide.site'))
      .toBe('https://api.wanderersguide.app/storage/v1/object/public/portraits/default/Fayden.jpg');
    expect(publicStorageObjectUrl('https://cdn.example/portraits/a.png', 'https://amba.wandersguide.site')).toBe('https://cdn.example/portraits/a.png');
    expect(publicStorageObjectUrl('http://127.0.0.1:8000/storage/v1/object/public/portraits/a.png', 'https://amba.wandersguide.site'))
      .toBe('http://127.0.0.1:8000/storage/v1/object/public/portraits/a.png');
  });
});
