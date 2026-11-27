export function reconcilePartyAutoSync(
  present: ReadonlySet<number>,
  inParty: ReadonlySet<number>,
  pendingAdds: Set<number>,
  pendingRemovals: Set<number>,
): void {
  for (const id of [...pendingAdds]) {
    if (present.has(id) || !inParty.has(id)) pendingAdds.delete(id);
  }
  for (const id of [...pendingRemovals]) {
    if (!inParty.has(id)) pendingRemovals.delete(id);
  }
}

export function missingPartyCharacterIds(
  playerIds: readonly number[],
  present: ReadonlySet<number>,
  inParty: ReadonlySet<number>,
  pendingAdds: ReadonlySet<number>,
  pendingRemovals: ReadonlySet<number>,
): number[] {
  return playerIds.filter((id) => (
    inParty.has(id)
    && !present.has(id)
    && !pendingAdds.has(id)
    && !pendingRemovals.has(id)
  ));
}
