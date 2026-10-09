export type SyndicatedKind = 'folder' | 'entry';

export type SyndicatedNode<T> = {
  id: string;
  user_id: string;
  content_kind: string;
  kind: SyndicatedKind;
  name: string;
  parent_id: string | null;
  draft: T | null;
  published: boolean;
  public_token: string | null;
  snapshot: T | null;
  published_at: string | null;
};

export type PublicSnapshot<T> = {
  name: string;
  snapshot: T;
  published_at: string | null;
};

export function mintPublicToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function assertParent<T>(
  nodes: Pick<SyndicatedNode<T>, 'id' | 'kind' | 'parent_id' | 'content_kind'>[],
  next: { kind: SyndicatedKind; parent_id: string | null; content_kind: string },
) {
  if (next.kind === 'folder') {
    if (next.parent_id) throw new Error('Folders stay at the root.');
    return;
  }
  if (!next.parent_id) return;
  const parent = nodes.find((row) => row.id === next.parent_id);
  if (!parent || parent.kind !== 'folder' || parent.parent_id || parent.content_kind !== next.content_kind) {
    throw new Error('An entry can only sit in a root folder.');
  }
}

export function publishNode<T>(node: SyndicatedNode<T>, now = new Date().toISOString()): SyndicatedNode<T> {
  if (node.kind !== 'entry' || node.draft == null) throw new Error('Nothing to publish.');
  return {
    ...node,
    published: true,
    public_token: node.public_token ?? mintPublicToken(),
    snapshot: node.draft,
    published_at: now,
  };
}

export function unpublishNode<T>(node: SyndicatedNode<T>): SyndicatedNode<T> {
  return { ...node, published: false };
}

export function updateSnapshot<T>(node: SyndicatedNode<T>, now = new Date().toISOString()): SyndicatedNode<T> {
  if (!node.published) throw new Error('Publish the entry before updating it.');
  if (node.draft == null) throw new Error('Nothing to publish.');
  return { ...node, snapshot: node.draft, published_at: now, public_token: node.public_token ?? mintPublicToken() };
}

export function publicSnapshot<T>(node: Pick<SyndicatedNode<T>, 'name' | 'published' | 'snapshot' | 'published_at'> | null): PublicSnapshot<T> | null {
  if (!node?.published || node.snapshot == null) return null;
  return { name: node.name, snapshot: node.snapshot, published_at: node.published_at };
}

export function publicPath(prefix: string, token: string) {
  return `${prefix.replace(/\/$/, '')}/${token}`;
}
