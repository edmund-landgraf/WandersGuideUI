import { describe, expect, it } from 'vitest';
import { assertParent, publicSnapshot, publishNode, unpublishNode, updateSnapshot, type SyndicatedNode } from './nodes';

type Draft = { label: string };

function node(partial: Partial<SyndicatedNode<Draft>> & Pick<SyndicatedNode<Draft>, 'id' | 'kind'>): SyndicatedNode<Draft> {
  return {
    user_id: 'user',
    content_kind: 'shop',
    name: 'Counter',
    parent_id: null,
    draft: partial.kind === 'folder' ? null : { label: 'draft' },
    published: false,
    public_token: null,
    snapshot: null,
    published_at: null,
    ...partial,
  };
}

describe('syndication folders', () => {
  const folder = node({ id: 'folder', kind: 'folder', name: 'Town' });

  it('allows a shop at the root or in one root folder', () => {
    expect(() => assertParent([folder], { kind: 'entry', parent_id: null, content_kind: 'shop' })).not.toThrow();
    expect(() => assertParent([folder], { kind: 'entry', parent_id: 'folder', content_kind: 'shop' })).not.toThrow();
  });

  it('rejects a nested folder and a shop under a shop', () => {
    const shop = node({ id: 'shop', kind: 'entry' });
    expect(() => assertParent([folder], { kind: 'folder', parent_id: 'folder', content_kind: 'shop' })).toThrow(/root/);
    expect(() => assertParent([shop], { kind: 'entry', parent_id: 'shop', content_kind: 'shop' })).toThrow(/root folder/);
  });
});

describe('syndication snapshot', () => {
  it('publishes the draft and keeps the token across unpublish and update', () => {
    const saved = node({ id: 'shop', kind: 'entry', draft: { label: 'first' } });
    const published = publishNode(saved, '2026-10-09T00:00:00.000Z');
    expect(published.snapshot).toEqual({ label: 'first' });
    expect(published.public_token).toBeTruthy();
    expect(publicSnapshot(published)?.snapshot).toEqual({ label: 'first' });

    const hidden = unpublishNode({ ...published, draft: { label: 'second' } });
    expect(publicSnapshot(hidden)).toBeNull();
    expect(hidden.public_token).toBe(published.public_token);

    const updated = updateSnapshot({ ...hidden, published: true }, '2026-10-09T01:00:00.000Z');
    expect(updated.public_token).toBe(published.public_token);
    expect(updated.snapshot).toEqual({ label: 'second' });
    expect(publicSnapshot({ ...updated, draft: { label: 'unsaved' } })?.snapshot).toEqual({ label: 'second' });
  });
});
