import { HttpError } from '../_shared/http-errors.ts';

const invalid = () => new HttpError(400, 'Invalid or oversized public combat archive.', 'INVALID_COMBAT_ARCHIVE');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function keys(row: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(row).some(key => !allowed.includes(key))) throw invalid();
}
function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw invalid();
  return value;
}
function id(value: unknown, max = 160): string {
  const out = text(value, max);
  if (!/^[A-Za-z0-9_.:-]+$/.test(out)) throw invalid();
  return out;
}
function nullableId(value: unknown): string | null { return value == null ? null : id(value); }
function date(value: unknown): string {
  const out = text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(out) || !Number.isFinite(Date.parse(out))) throw invalid();
  return out;
}
function round(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100000) throw invalid();
  return value;
}
function rows(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) throw invalid();
  return value;
}
export function validateFoundryArchive(value: unknown) {
  const input = object(value);
  // Deliberately exclude arbitrary metadata, actor sheets, chat HTML, flags, credentials and combatants.
  keys(input, ['worldId','exportId','foundryCombatId','foundrySceneId','startedAt','endedAt','rounds','transcript']);
  const seen = new Set<string>();
  const transcript = rows(input.transcript, 100).map(item => {
    const event = object(item);
    keys(event, ['messageId','at','round','speaker','rolls']);
    const messageId = id(event.messageId);
    if (seen.has(messageId)) throw invalid();
    seen.add(messageId);
    const speaker = object(event.speaker);
    keys(speaker, ['alias','actor','token']);
    return {
      messageId, at: date(event.at), round: round(event.round),
      speaker: { alias: text(speaker.alias, 100, true), actor: nullableId(speaker.actor), token: nullableId(speaker.token) },
      rolls: rows(event.rolls, 10).map(item => {
        const roll = object(item); keys(roll, ['total','formula']);
        if (typeof roll.total !== 'number' || !Number.isFinite(roll.total)) throw invalid();
        return { total: roll.total, formula: text(roll.formula, 160, true) };
      }),
    };
  });
  const log = { worldId: id(input.worldId), exportId: id(input.exportId), foundryCombatId: id(input.foundryCombatId),
    foundrySceneId: nullableId(input.foundrySceneId), startedAt: date(input.startedAt), endedAt: date(input.endedAt),
    rounds: round(input.rounds), transcript };
  if (Date.parse(log.endedAt) < Date.parse(log.startedAt) || new TextEncoder().encode(JSON.stringify(log)).length > 60 * 1024) throw invalid();
  return log;
}
