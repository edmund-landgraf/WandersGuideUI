export type AnimistModeCandidate = {
  id: number;
  name: string;
};

function toVariableLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * A fresh WG character records attuned Animist apparitions in MODE_IDS, but
 * does not record the first primary apparition in ACTIVE_MODES. The operation
 * engine otherwise (correctly) leaves mode operations disabled. For export,
 * infer only that first primary apparition; never activate ordinary modes or
 * override an explicit active-mode selection.
 */
export function inferAnimistPrimaryMode(
  className: string | undefined,
  activeModes: string[],
  selectedModeIds: string[],
  modes: AnimistModeCandidate[]
) {
  if (className?.trim().toLowerCase() !== 'animist' || activeModes.length > 0) {
    return activeModes;
  }

  for (const selectedId of selectedModeIds) {
    const mode = modes.find((candidate) => `${candidate.id}` === selectedId && /-\s*primary\s*$/i.test(candidate.name));
    if (mode) return [toVariableLabel(mode.name)];
  }

  return activeModes;
}
