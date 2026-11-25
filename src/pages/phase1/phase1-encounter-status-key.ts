/** Cache identity includes every input to the live status calculator, not just combat HP. */
export function encounterStatusSignature(combatants: readonly {
  _id: string; type: string; access?: unknown; data?: unknown; hazard?: unknown; hazard_state?: unknown;
}[]): string {
  return JSON.stringify(combatants.map((combatant) => ({
    id: combatant._id,
    type: combatant.type,
    access: combatant.access,
    data: combatant.data,
    hazard: combatant.hazard,
    hazard_state: combatant.hazard_state,
  })));
}
