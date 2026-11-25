// Published PF2e 8.7.1 (2026-11-17), pinned to an immutable commit.
export const MONSTER_CORE_2_REF = '397f125aea87e6d6fa36e878c9c07d0e672826cf';
export const MONSTER_CORE_2_PACK = 'packs/pf2e/pathfinder-monster-core-2';

export async function downloadMonsterCore2Files(): Promise<File[]> {
  const index = await fetch('https://api.github.com/repos/foundryvtt/pf2e/contents/' + MONSTER_CORE_2_PACK + '?ref=' + MONSTER_CORE_2_REF);
  if (!index.ok) throw new Error('Monster Core 2 pack listing failed: ' + index.status);
  const rows = await index.json() as { name: string; type: string }[];
  if (!Array.isArray(rows)) throw new Error('Invalid Monster Core 2 pack listing');
  const entries = rows.filter(row => row.type === 'file' && /^[a-z0-9][a-z0-9._-]*\.json$/i.test(row.name));
  if (!entries.length) throw new Error('Monster Core 2 pack is empty');
  const files: File[] = [];
  // Bound concurrency, and download all files before making any catalog writes.
  for (let offset = 0; offset < entries.length; offset += 8) {
    const batch = await Promise.all(entries.slice(offset, offset + 8).map(async ({ name }) => {
      const response = await fetch('https://raw.githubusercontent.com/foundryvtt/pf2e/' + MONSTER_CORE_2_REF + '/' + MONSTER_CORE_2_PACK + '/' + name);
      if (!response.ok) throw new Error('Download failed: ' + name + ' (' + response.status + ')');
      const actor = await response.json();
      if (actor.type !== 'npc') return null;
      if (actor.system?.details?.publication?.title !== 'Pathfinder Monster Core 2' || actor.system?.details?.publication?.remaster !== true) {
        throw new Error('Unexpected publication: ' + name);
      }
      return new File([JSON.stringify(actor)], name, { type: 'application/json' });
    }));
    for (const file of batch) if (file) files.push(file);
  }
  if (!files.length) throw new Error('No Monster Core 2 NPCs in pack');
  return files;
}
