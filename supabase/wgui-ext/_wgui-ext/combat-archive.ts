// Pure contract: no access tokens, chat HTML or arbitrary flags are accepted.
type RecordValue = Record<string, unknown>;
export class ArchiveContractError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function bad(message: string): never { throw new ArchiveContractError(400, 'INVALID_COMBAT_ARCHIVE', message); }
function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad(label + ' must be an object.');
  return value as RecordValue;
}
function keys(row: RecordValue, allowed: string[], label: string) {
  if (Object.keys(row).some((key) => !allowed.includes(key))) bad(label + ' contains unsupported fields.');
}
function str(value: unknown, max: number, label: string, optional = false): string | null {
  if (optional && value == null) return null;
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) bad(label + ' is invalid.');
  return value;
}
function date(value: unknown, label: string): string {
  const text = str(value, 40, label)!;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(text) || !Number.isFinite(Date.parse(text))) bad(label + ' must be an ISO UTC timestamp.');
  return text;
}
function number(value: unknown, label: string, optional = false): number | null {
  if (optional && value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1000000) bad(label + ' is invalid.');
  return value;
}
function round(value: unknown, label: string): number {
  const result = number(value, label)!;
  if (!Number.isInteger(result) || result < 0) bad(label + ' must be a nonnegative integer.');
  return result;
}
function list(value: unknown, max: number, label: string, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) bad(label + ' has an invalid number of entries.');
  return value;
}
function id(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0) return Number(value);
  return null;
}
export function validateCombatArchive(value: unknown, campaignId: number, encounterId: number) {
  const row = object(value, 'archive');
  if (new TextEncoder().encode(JSON.stringify(row)).length > 256 * 1024) bad('Combat archive exceeds 256 KiB.');
  keys(row, ['worldId','exportId','foundryCombatId','foundrySceneId','startedAt','endedAt','rounds','combatants','transcript','wguiCampaignId','wguiEncounterId'], 'archive');
  if (id(row.wguiCampaignId) !== campaignId || id(row.wguiEncounterId) !== encounterId) bad('Archive mapping does not match the requested campaign and encounter.');
  const startedAt = date(row.startedAt, 'startedAt');
  const endedAt = date(row.endedAt, 'endedAt');
  if (Date.parse(endedAt) < Date.parse(startedAt)) bad('Archive end precedes its start.');
  const combatants = list(row.combatants, 250, 'combatants').map((entry) => {
    const c = object(entry, 'combatant'); keys(c, ['foundryCombatantId','name','initiative'], 'combatant');
    return { foundryCombatantId: str(c.foundryCombatantId,128,'combatant id'), name: str(c.name,200,'combatant name'), initiative: number(c.initiative,'initiative',true) };
  });
  const transcript = list(row.transcript,100,'transcript',1).map((entry) => {
    const e = object(entry,'event'); keys(e,['messageId','at','round','speaker','rolls'],'event');
    const speaker = object(e.speaker,'speaker'); keys(speaker,['alias','actor','token'],'speaker');
    return { messageId: str(e.messageId,128,'messageId'), at: date(e.at,'event time'), round: round(e.round,'event round'),
      speaker: { alias: str(speaker.alias,100,'alias',true) ?? '', actor: str(speaker.actor,128,'actor',true), token: str(speaker.token,128,'token',true) },
      rolls: list(e.rolls,10,'rolls',1).map((entry) => {
        const r=object(entry,'roll'); keys(r,['total','formula'],'roll');
        return { total: number(r.total,'roll total'), formula: str(r.formula,160,'formula',true) ?? '' };
      }),
    };
  });
  if (new Set(transcript.map((row) => row.messageId)).size !== transcript.length) bad('Duplicate message ids in transcript.');
  return { worldId: str(row.worldId,128,'worldId')!, exportId: str(row.exportId,200,'exportId')!, foundryCombatId: str(row.foundryCombatId,128,'foundryCombatId'), foundrySceneId: str(row.foundrySceneId,128,'foundrySceneId',true),
    startedAt, endedAt, rounds: round(row.rounds,'rounds'), combatants, transcript, wguiCampaignId: campaignId, wguiEncounterId: encounterId };
}
export type CombatArchive = ReturnType<typeof validateCombatArchive>;
function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key)+':'+stable((value as RecordValue)[key])).join(',') + '}';
  return JSON.stringify(value ?? null);
}
/** Append only. Same key + same normalized contents is an idempotent receipt. */
export function appendCombatArchive(meta: RecordValue, archive: CombatArchive, receiptId: string, archivedAt: string) {
  const foundry = record(meta.foundry);
  const logs = foundry.combat_logs == null ? [] : foundry.combat_logs;
  if (!Array.isArray(logs)) throw new ArchiveContractError(409,'ARCHIVE_STORAGE_CONFLICT','Existing combat archive storage needs review.');
  const match = logs.find((entry) => record(entry).worldId === archive.worldId && record(entry).exportId === archive.exportId);
  if (match) {
    const { receiptId: previousReceipt, archivedAt: previousAt, ...previous } = record(match);
    if (stable(previous) !== stable(archive) || typeof previousReceipt !== 'string' || typeof previousAt !== 'string') {
      throw new ArchiveContractError(409,'ARCHIVE_ID_CONFLICT','Archive id already exists with different or unverified content.');
    }
    return { appended: false, meta, receipt: { receiptId: previousReceipt, archivedAt: previousAt } };
  }
  if (logs.length >= 50) throw new ArchiveContractError(409,'ARCHIVE_LIMIT','Combat archive limit reached. Export or review existing logs; nothing was deleted.');
  const next = { ...meta, foundry: { ...foundry, combat_logs: [...logs, { ...archive, receiptId, archivedAt }] } };
  if (new TextEncoder().encode(JSON.stringify(next.foundry.combat_logs)).length > 4 * 1024 * 1024) {
    throw new ArchiveContractError(409,'ARCHIVE_LIMIT','Combat archive storage limit reached. Nothing was deleted.');
  }
  return { appended: true, meta: next, receipt: { receiptId, archivedAt } };
}
export function withoutCombatArchives(meta: RecordValue): RecordValue {
  const foundry = record(meta.foundry);
  if (!Object.hasOwn(foundry,'combat_logs')) return meta;
  const { combat_logs: _private, ...rest } = foundry;
  return { ...meta, foundry: rest };
}
