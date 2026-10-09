import { supabase } from '../supabase-client';
import { assertParent, publishNode, unpublishNode, updateSnapshot, type SyndicatedKind, type SyndicatedNode } from './nodes';

const TABLE = 'syndicated_nodes';
const PUBLIC_VIEW = 'syndicated_public';

type Row = SyndicatedNode<unknown>;

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message);
}

export async function listOwned(contentKind: string) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('content_kind', contentKind)
    .order('name');
  fail(error);
  return (data ?? []) as Row[];
}

export async function insertNode<T>(input: {
  content_kind: string;
  kind: SyndicatedKind;
  name: string;
  parent_id: string | null;
  draft: T | null;
}) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  fail(userError);
  const userId = userData.user?.id;
  if (!userId) throw new Error('Sign in to save.');
  const existing = await listOwned(input.content_kind);
  assertParent(existing, input);
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      user_id: userId,
      content_kind: input.content_kind,
      kind: input.kind,
      name: input.name,
      parent_id: input.parent_id,
      draft: input.draft,
      published: false,
    })
    .select('*')
    .single();
  fail(error);
  return data as SyndicatedNode<T>;
}

export async function moveNode<T>(node: SyndicatedNode<T>, parentId: string | null) {
  const existing = await listOwned(node.content_kind);
  assertParent(existing, { kind: node.kind, parent_id: parentId, content_kind: node.content_kind });
  const { data, error } = await supabase
    .from(TABLE)
    .update({ parent_id: parentId })
    .eq('id', node.id)
    .select('*')
    .single();
  fail(error);
  return data as SyndicatedNode<T>;
}

async function writePublishState<T>(next: SyndicatedNode<T>) {
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      published: next.published,
      public_token: next.public_token,
      snapshot: next.snapshot,
      published_at: next.published_at,
    })
    .eq('id', next.id)
    .select('*')
    .single();
  fail(error);
  return data as SyndicatedNode<T>;
}

export function publishOwned<T>(node: SyndicatedNode<T>) {
  return writePublishState(publishNode(node));
}

export function unpublishOwned<T>(node: SyndicatedNode<T>) {
  return writePublishState(unpublishNode(node));
}

export function updateOwnedSnapshot<T>(node: SyndicatedNode<T>) {
  return writePublishState(updateSnapshot(node));
}

export async function patchOwnedDraft<T>(node: SyndicatedNode<T>, patch: Partial<T>) {
  if (node.draft == null) throw new Error('Nothing to update.');
  const draft = { ...node.draft, ...patch };
  const snapshot = node.published && node.snapshot ? { ...node.snapshot, ...patch } : node.snapshot;
  const { data, error } = await supabase
    .from(TABLE)
    .update({ draft, snapshot })
    .eq('id', node.id)
    .select('*')
    .single();
  fail(error);
  return data as SyndicatedNode<T>;
}

export async function deleteOwned(id: string) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  fail(error);
}

export async function readPublic<T>(contentKind: string, token: string) {
  const { data, error } = await supabase
    .from(PUBLIC_VIEW)
    .select('name, snapshot, published_at, content_kind')
    .eq('content_kind', contentKind)
    .eq('public_token', token)
    .maybeSingle();
  fail(error);
  if (!data?.snapshot) return null;
  return {
    name: data.name as string,
    snapshot: data.snapshot as T,
    published_at: (data.published_at as string | null) ?? null,
  };
}
