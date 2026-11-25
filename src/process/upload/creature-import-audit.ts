/** Fail closed rather than treating an unavailable catalog as an empty catalog. */
export function requireCreatureCatalog(rows: unknown, sourceId: number, expectedCount?: number): Set<string> {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.name !== 'string' || !row.name.trim() ||
    row.content_source_id !== sourceId)) {
    throw new Error('Could not verify the existing creature catalog. No writes were attempted.');
  }
  if (typeof expectedCount === 'number' && rows.length < expectedCount) {
    throw new Error('Creature catalog read was incomplete. No writes were attempted.');
  }
  return new Set(rows.map(row => row.name.trim().toLowerCase()));
}
export function importFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown import failure';
  return message.slice(0, 500);
}
