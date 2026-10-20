// @ts-ignore
import { serve } from 'std/server';
import { connect, createServiceClient } from '../_shared/helpers.ts';
import { HttpError } from '../_shared/http-errors.ts';
import {
  type CombatantCommand,
  combatantsOf,
  loadAuthorizedEncounter,
  requireCampaignId,
  requireEncounterId,
  requireGm,
  requireRevision,
  saveCombatants,
} from '../_wgui-ext/encounter-command.ts';

type RollRequest = { combatant_id?: unknown; bonus?: unknown; source?: unknown };

type RollBody = {
  campaign_id?: unknown;
  encounter_id?: unknown;
  encounter_revision?: unknown;
  scope?: unknown;
  rolls?: unknown;
  client_request_id?: unknown;
};

type InitiativeLogEntry = {
  name: string;
  ally: boolean;
  initiative: number | null;
  calculation: string;
  combatant_id?: string;
};

type InitiativeLog = {
  id: string;
  round: number;
  entries: InitiativeLogEntry[];
  client_request_id?: string;
};

function d20(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return (bytes[0] % 20) + 1;
}

function signed(value: number): string {
  return value >= 0 ? '+' + value : String(value);
}

function calculation(die: number, bonus: number, source: string, total: number): string {
  const bonusText = source ? source + ' (' + signed(bonus) + ')' : bonus !== 0 ? signed(bonus) : '';
  const equation = bonusText ? 'd20 (' + die + ') + ' + bonusText : 'd20 (' + die + ')';
  return equation + ' = ' + total;
}

function displayName(combatant: CombatantCommand): string {
  const creature = combatant.creature;
  const data = combatant.data;
  const hazard = combatant.hazard as { name?: unknown } | undefined;
  const name = creature?.name ?? data?.name ?? hazard?.name;
  return typeof name === 'string' && name.trim() !== '' ? name : 'Combatant';
}

function isOut(combatant: CombatantCommand): boolean {
  return combatant.out === 'dead' || combatant.out === 'incapacitated';
}

function emptyInitiative(combatant: CombatantCommand): boolean {
  return typeof combatant.initiative !== 'number' || !Number.isFinite(combatant.initiative);
}

function initiativeLog(meta: Record<string, unknown> | null | undefined): InitiativeLog[] {
  const log = meta?.initiative_log;
  return Array.isArray(log) ? (log as InitiativeLog[]) : [];
}

function nextRound(log: InitiativeLog[]): number {
  const rounds = log.map((entry) => entry.round).filter((round) => Number.isFinite(round));
  if (rounds.length === 0) return 1;
  return Math.max(...rounds) + 1;
}

function parseRolls(value: unknown): Map<string, { bonus: number; source: string }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'rolls must list at least one combatant.', 'ROLLS_REQUIRED');
  }
  const rolls = new Map<string, { bonus: number; source: string }>();
  for (const item of value as RollRequest[]) {
    if (!item || typeof item !== 'object') {
      throw new HttpError(400, 'Each roll needs a combatant_id and bonus.', 'INVALID_ROLL');
    }
    if (typeof item.combatant_id !== 'string' || item.combatant_id.trim() === '') {
      throw new HttpError(400, 'Each roll needs a combatant_id.', 'COMBATANT_ID_REQUIRED');
    }
    if (typeof item.bonus !== 'number' || !Number.isFinite(item.bonus)) {
      throw new HttpError(400, 'Each roll bonus must be a finite number.', 'INVALID_BONUS');
    }
    const source = item.source === undefined || item.source === null ? '' : item.source;
    if (typeof source !== 'string') {
      throw new HttpError(400, 'Roll source must be a string.', 'INVALID_SOURCE');
    }
    const id = item.combatant_id.trim();
    if (rolls.has(id)) {
      throw new HttpError(400, 'Each combatant can be rolled once per request.', 'DUPLICATE_ROLL');
    }
    rolls.set(id, { bonus: item.bonus, source });
  }
  return rolls;
}

serve(async (req: Request) => {
  return await connect<RollBody>(req, async (client, body, token) => {
    const campaignId = requireCampaignId(body ?? {});
    const encounterId = requireEncounterId(body ?? {});
    const revision = requireRevision(body ?? {});
    const scope = body?.scope;
    if (scope !== 'empty' && scope !== 'all') {
      throw new HttpError(400, 'scope must be empty or all.', 'INVALID_SCOPE');
    }
    const requestId =
      typeof body?.client_request_id === 'string' && body.client_request_id.trim() !== ''
        ? body.client_request_id.trim()
        : undefined;
    const rolls = parseRolls(body?.rolls);

    const admin = createServiceClient();
    const { access, encounter } = await loadAuthorizedEncounter(
      client,
      admin,
      token,
      campaignId,
      encounterId
    );
    requireGm(access.isGm);

    const meta = (encounter.meta_data ?? {}) as Record<string, unknown>;
    const existingLog = initiativeLog(meta);
    if (requestId) {
      const prior = existingLog.find((entry) => entry.client_request_id === requestId);
      if (prior) {
        return {
          status: 'success',
          data: {
            rolled: [],
            initiative_log_entry: prior,
            encounter_revision: typeof meta.encounter_revision === 'number' ? meta.encounter_revision : 0,
            idempotent: true,
          },
        };
      }
    }

    const list = combatantsOf(encounter);
    const byId = new Map(list.map((combatant) => [combatant._id, combatant]));
    for (const id of rolls.keys()) {
      if (!byId.has(id)) throw new HttpError(404, 'Combatant not found.', 'COMBATANT_NOT_FOUND');
    }

    const targets = [...rolls.keys()].filter((id) => {
      const combatant = byId.get(id);
      return combatant && (scope === 'all' || emptyInitiative(combatant));
    });
    if (targets.length === 0) {
      throw new HttpError(400, 'No combatants matched this initiative roll.', 'NO_INITIATIVE_TARGETS');
    }

    const rolledIds = new Set(targets);
    const rolled: CombatantCommand[] = [];
    const nextList = list.map((combatant) => {
      if (!combatant._id || !rolledIds.has(combatant._id)) return combatant;
      const choice = rolls.get(combatant._id);
      if (!choice) return combatant;
      const die = d20();
      const total = die + choice.bonus;
      const next = {
        ...combatant,
        initiative: total,
        initiative_roll: { die, bonus: choice.bonus, source: choice.source },
      };
      rolled.push(next);
      return next;
    });

    const entries: InitiativeLogEntry[] = nextList
      .filter((combatant) => combatant._id && !isOut(combatant))
      .map((combatant) => {
        const id = combatant._id as string;
        if (rolledIds.has(id) && combatant.initiative_roll && typeof combatant.initiative === 'number') {
          const roll = combatant.initiative_roll as { die: number; bonus: number; source: string };
          return {
            name: displayName(combatant),
            ally: Boolean(combatant.ally),
            initiative: combatant.initiative,
            calculation: calculation(roll.die, roll.bonus, roll.source ?? '', combatant.initiative),
            combatant_id: id,
          };
        }
        return {
          name: displayName(combatant),
          ally: Boolean(combatant.ally),
          initiative: typeof combatant.initiative === 'number' ? combatant.initiative : null,
          calculation: 'Skipped',
          combatant_id: id,
        };
      });

    const logEntry: InitiativeLog = {
      id: crypto.randomUUID(),
      round: nextRound(existingLog),
      entries,
      ...(requestId ? { client_request_id: requestId } : {}),
    };

    const saved = await saveCombatants(admin, encounterId, encounter, nextList, revision, {
      initiative_log: [...existingLog, logEntry],
    });

    return {
      status: 'success',
      data: {
        rolled: saved.list.filter((combatant) => combatant._id && rolledIds.has(combatant._id)),
        initiative_log_entry: logEntry,
        encounter_revision: saved.revision,
        idempotent: false,
      },
    };
  });
});
