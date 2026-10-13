import type { TacticsAbility, TacticsChoice, TacticsCombatant, TacticsSpend } from './tactics-types';
import { annotatePenalties, choiceFaults, legalMenu, rankChoices, separateActions, unusedActions } from './tactics-legal';
import { readMemory, writeMemory } from './tactics-memory';

const MODEL = import.meta.env.VITE_OLLAMA_MODEL || 'llama3.1';
const CONTEXT_CHARS = Number(import.meta.env.VITE_OLLAMA_CONTEXT_CHARS) || 12000;

const BASIC_ACTIONS = ['stride', 'step', 'strike', 'seek', 'demoralize', 'grapple', 'trip', 'shove', 'disarm', 'raise a shield', 'take cover', 'stand', 'crawl', 'leap', 'ready', 'delay', 'aid', 'recall knowledge'];

const TURN_SYSTEM =
  'You offer three different Pathfinder 2e turns for the one creature named Acting. The first choice must be fully legal. Use only the names, action costs, and numbers in the user message. Do not copy an example and do not invent a creature, weapon, spell, bonus, or DC. Each line is exactly one action. A Strike names one attack from that creature\'s Strikes. Seek only looks for a hidden creature. The action costs on the first choice add up to 3. Reply as JSON {"choices":[{"lines":["..."],"tip":"...","abilityIds":["..."]},{"lines":["..."],"tip":"...","abilityIds":[]},{"lines":["..."],"tip":"...","abilityIds":[]}]}';

type ChatResult = { text: string } | { error: string; contextExceeded: boolean };

export type TurnStatus = {
  detail: string;
};

async function chat(system: string, user: string, onStatus?: (status: TurnStatus) => void, writing?: string): Promise<ChatResult> {
  try {
    const response = await fetch('/ollama/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      const error = data.error || String(response.status);
      return { error, contextExceeded: /context|num_ctx|token/i.test(error) };
    }
    if (!response.body) return { error: 'empty', contextExceeded: false };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let text = '';
    let lastReport = 0;
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      pending += decoder.decode(step.value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed) as { message?: { content?: string }; error?: string };
          if (data.error) return { error: data.error, contextExceeded: /context|num_ctx|token/i.test(data.error) };
          text += data.message?.content ?? '';
        } catch {
          text += trimmed;
        }
      }
      if (onStatus && text.length - lastReport >= 80) {
        lastReport = text.length;
        onStatus({ detail: `${writing ?? `${MODEL} is writing.`} ${text.length} characters so far.` });
      }
    }
    const trimmed = text.trim();
    if (!trimmed) return { error: 'empty', contextExceeded: false };
    return { text: trimmed };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'request failed', contextExceeded: false };
  }
}

function fits(text: string) {
  return text.length <= CONTEXT_CHARS;
}

function combatantLine(combatant: TacticsCombatant) {
  const conditions = combatant.conditions.map((condition) => (condition.value ? `${condition.name} ${condition.value}` : condition.name)).join(', ');
  return `${combatant.name} (${combatant.side}) HP ${combatant.hpCurrent}/${combatant.hpMax} AC ${combatant.ac ?? '?'} Fort ${combatant.fortitude ?? '?'} Ref ${combatant.reflex ?? '?'} Will ${combatant.will ?? '?'}${conditions ? ` [${conditions}]` : ''}`;
}

function abilityLine(ability: TacticsAbility, actorId: string, spends: TacticsSpend[]) {
  const used = spends.find((spend) => spend.combatantId === actorId && spend.abilityId === ability.id)?.used ?? 0;
  const left = ability.usesMax == null ? '' : ` uses left ${Math.max(0, ability.usesMax - used)}.`;
  return `${ability.name} (id ${ability.id}, ${ability.actions} action${ability.actions === 1 ? '' : 's'}).${left} ${ability.description}`;
}

function roster(combatants: TacticsCombatant[]) {
  return combatants.map(combatantLine).join('\n');
}

function fullBrief(actor: TacticsCombatant, combatants: TacticsCombatant[], spends: TacticsSpend[], catalog?: TacticsAbility[]) {
  const abilities = actor.abilities.map((ability) => abilityLine(ability, actor.id, spends)).join('\n');
  const description = actor.description?.trim() ? `\n\nDescription:\n${actor.description.trim()}` : '';
  return `Acting: ${actor.name}\n\nRoster:\n${roster(combatants)}${description}\n\nLegal actions:\n${legalMenu(actor, catalog)}\n\nAbilities:\n${abilities}`;
}

function abilityChunks(actor: TacticsCombatant, spends: TacticsSpend[]): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const ability of actor.abilities) {
    const line = abilityLine(ability, actor.id, spends);
    if (current && current.length + line.length + 1 > Math.floor(CONTEXT_CHARS / 2)) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : ['This creature has no listed abilities.'];
}

function onSheet(name: string, actor: TacticsCombatant): boolean {
  const blob = [actor.description ?? '', ...actor.abilities.flatMap((ability) => [ability.name, ability.description])].join('\n');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(blob);
}

function inventedActions(lines: string[], actor: TacticsCombatant): string[] {
  const invented: string[] = [];
  for (const line of lines) {
    const named = line.match(/\busing\s+([^.(]+)/i)?.[1]?.trim();
    if (!named) continue;
    if (BASIC_ACTIONS.includes(named.toLowerCase()) || onSheet(named, actor)) continue;
    invented.push(named);
  }
  return invented;
}

function playableLine(line: string, catalog?: TacticsAbility[], actor?: TacticsCombatant): boolean {
  const words = line.trim().split(/\s+/);
  if (words.length < 2) return false;
  if (/^(ac|dc|hp)\b/i.test(line.trim())) return false;
  const names = (catalog?.length ? catalog.map((ability) => ability.name.toLowerCase()) : BASIC_ACTIONS)
    .concat((actor?.abilities ?? []).map((ability) => ability.name.toLowerCase()))
    .concat(['merge', 'merges', 'merging', 'emerge', 'emerges', 'attack']);
  return names.some((verb) => new RegExp(`\\b${verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(line));
}

function oneChoice(raw: { lines?: string[]; tip?: string; abilityIds?: string[] }, actor: TacticsCombatant, index: number, catalog?: TacticsAbility[]): { choice: TacticsChoice } | { rejected: string } | null {
  const rawLines = (raw.lines ?? []).map((line) => line.trim()).filter(Boolean);
  const invented = inventedActions(rawLines, actor);
  if (invented.length) {
    const listed = actor.abilities.map((ability) => ability.name).join(', ') || 'no special actions';
    return { rejected: `${actor.name} does not have ${invented.join(', ')}. The sheet lists: ${listed}.` };
  }
  const lines = annotatePenalties(separateActions(rawLines, actor, catalog).filter((line) => playableLine(line, catalog, actor)), actor, catalog);
  if (lines.length < 2) return null;
  const abilityIds = (raw.abilityIds ?? []).filter((id) => actor.abilities.some((ability) => ability.id === id));
  const unused = unusedActions(lines, actor, catalog);
  const unusedNote = unused ? `${unused} action${unused === 1 ? '' : 's'} unused.` : '';
  return {
    choice: {
      id: `${actor.id}-model-${index}`,
      text: lines.join(' '),
      lines,
      score: 0,
      tip: [raw.tip?.trim(), unusedNote].filter(Boolean).join(' ') || 'Proposed from the encounter notes.',
      abilityIds,
      source: 'menu',
    },
  };
}

function parseTurn(raw: string, actor: TacticsCombatant, catalog?: TacticsAbility[]): { choices: TacticsChoice[] } | { rejected: string } | null {
  const json = raw.match(/\{[\s\S]*\}/);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json[0]) as { lines?: string[]; tip?: string; abilityIds?: string[]; choices?: { lines?: string[]; tip?: string; abilityIds?: string[] }[] };
    const items = parsed.choices?.length ? parsed.choices : [parsed];
    const choices: TacticsChoice[] = [];
    const rejections: string[] = [];
    for (const item of items) {
      const result = oneChoice(item, actor, choices.length, catalog);
      if (!result) continue;
      if ('rejected' in result) rejections.push(result.rejected);
      else choices.push(result.choice);
    }
    if (!choices.length && rejections.length) return { rejected: rejections[0] };
    if (!choices.length) return null;
    return { choices: rankChoices(choices, actor, catalog) };
  } catch {
    return null;
  }
}

export async function proposeTurn(input: {
  campaignId: number;
  encounterId: number;
  actor: TacticsCombatant;
  combatants: TacticsCombatant[];
  spends: TacticsSpend[];
  catalog?: TacticsAbility[];
  onStatus?: (status: TurnStatus) => void;
}): Promise<{ choices: TacticsChoice[]; comment: string; modelDown: boolean }> {
  const { campaignId, encounterId, actor, combatants, spends, catalog, onStatus } = input;
  const brief = fullBrief(actor, combatants, spends, catalog);
  const report = (detail: string) => onStatus?.({ detail });
  if (!fits(brief)) {
    report(`${actor.name}'s sheet is ${brief.length.toLocaleString()} characters, past one ${MODEL} context window. Saving notes in parts.`);
  } else {
    report(`Sent ${actor.name}'s sheet to ${MODEL} (${brief.length.toLocaleString()} characters). Waiting for the first words.`);
  }
  const direct = fits(brief) ? await chat(TURN_SYSTEM, brief, onStatus, `${MODEL} is writing ${actor.name}'s turn.`) : { error: 'context', contextExceeded: true };
  if ('text' in direct) {
    report(`${MODEL} finished writing. Reading the turn.`);
    const parsed = await enoughChoices(direct.text, actor, brief, catalog, onStatus, report);
    if (parsed && 'choices' in parsed && parsed.choices.length) return { choices: parsed.choices, comment: parsed.note || `${parsed.choices.length} turns for ${actor.name}. Pick one.`, modelDown: false };
    if (parsed && 'rejected' in parsed) return { choices: [], comment: parsed.rejected, modelDown: false };
    return { choices: [], comment: 'The model replied, but the turn was not usable.', modelDown: false };
  }
  if (!direct.contextExceeded && direct.error !== 'context') {
    return { choices: [], comment: `${MODEL} stopped: ${direct.error}`, modelDown: true };
  }

  let notes = readMemory(campaignId, encounterId, actor.id);
  const chunks = abilityChunks(actor, spends);
  if (notes) report(`Found saved notes for ${actor.name}. Continuing from those.`);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const prompt = `Roster:\n${roster(combatants)}\n\nNotes so far:\n${notes || '(none)'}\n\nNext abilities:\n${chunk}\n\nRewrite the notes so a later call can choose this creature's turn. Keep numbers. Drop nothing that changes the action. Reply with notes only.`;
    report(`Reading abilities into local notes, part ${index + 1} of ${chunks.length}.`);
    if (!fits(prompt)) {
      notes = `${notes}\n${chunk}`.trim();
      writeMemory(campaignId, encounterId, actor.id, notes);
      report(`Part ${index + 1} was stored without a model call. The notes are still too long to send.`);
      continue;
    }
    const remembered = await chat(
      'Compress Pathfinder 2e encounter notes for a later turn decision. Do not choose the turn yet. Do not invent numbers.',
      prompt,
      onStatus,
      `${MODEL} is writing notes, part ${index + 1} of ${chunks.length}.`,
    );
    if ('error' in remembered) {
      notes = `${notes}\n${chunk}`.trim();
      report(`Part ${index + 1} failed (${remembered.error}). The raw text was saved instead.`);
    } else {
      notes = remembered.text;
      report(`Part ${index + 1} of ${chunks.length} is saved.`);
    }
    writeMemory(campaignId, encounterId, actor.id, notes);
  }

  report(`Asking ${MODEL} for ${actor.name}'s turn from the saved notes.`);
  const finaleBrief = `Acting: ${actor.name}\n\nRoster:\n${roster(combatants)}\n\nLegal actions:\n${legalMenu(actor, catalog)}\n\nNotes:\n${notes}`;
  const finale = await chat(TURN_SYSTEM, finaleBrief, onStatus, `${MODEL} is writing ${actor.name}'s turn from the saved notes.`);
  if ('error' in finale) return { choices: [], comment: `${MODEL} stopped while reading the saved notes: ${finale.error}`, modelDown: true };
  report(`${MODEL} finished writing. Reading the turn.`);
  const parsed = await enoughChoices(finale.text, actor, finaleBrief, catalog, onStatus, report);
  if (parsed && 'choices' in parsed && parsed.choices.length) return { choices: parsed.choices, comment: parsed.note || `${parsed.choices.length} turns for ${actor.name}. Pick one.`, modelDown: false };
  if (parsed && 'rejected' in parsed) return { choices: [], comment: parsed.rejected, modelDown: false };
  return { choices: [], comment: 'The model replied from the saved notes, but the turn was not usable.', modelDown: false };
}

async function enoughChoices(
  raw: string,
  actor: TacticsCombatant,
  brief: string,
  catalog: TacticsAbility[] | undefined,
  onStatus: ((status: TurnStatus) => void) | undefined,
  report: (detail: string) => void,
): Promise<{ choices: TacticsChoice[]; note?: string } | { rejected: string } | null> {
  let current = parseTurn(raw, actor, catalog);
  if (!current) {
    report(`${MODEL} replied, but it was not a turn. Asking for the turn in the required shape.`);
    const shaped = await chat(TURN_SYSTEM, `${brief}\n\nReply with only the JSON object of three turns. No notes.`, onStatus, `${MODEL} is rewriting ${actor.name}'s turn.`);
    if ('text' in shaped) current = parseTurn(shaped.text, actor, catalog);
  }
  if (current && 'choices' in current && current.choices.length < 3) {
    report(`${MODEL} offered ${current.choices.length}. Asking for three different turns.`);
    const again = await chat(TURN_SYSTEM, `${brief}\n\nOffer three different turns. Do not repeat a turn you already gave.`, onStatus, `${MODEL} is writing more turns for ${actor.name}.`);
    if ('text' in again) {
      const second = parseTurn(again.text, actor, catalog);
      if (second && 'choices' in second) {
        const seen = new Set(current.choices.map((choice) => choice.text));
        const merged = [...current.choices];
        for (const choice of second.choices) {
          if (seen.has(choice.text)) continue;
          seen.add(choice.text);
          merged.push({ ...choice, id: `${actor.id}-model-${merged.length}` });
        }
        current = { choices: rankChoices(merged, actor, catalog).slice(0, 3) };
      }
    }
  }
  if (!current || 'rejected' in current) return current;
  const faults = choiceFaults(current.choices[0], actor, catalog);
  if (!faults.length) return current;
  report(`The top turn is not legal: ${faults[0]} Asking again.`);
  const repaired = await chat(
    TURN_SYSTEM,
    `${brief}\n\nThe top turn was rejected:\n${faults.map((fault) => `- ${fault}`).join('\n')}\n\nReply again. The first choice must be a legal turn from the Legal actions list.`,
    onStatus,
    `${MODEL} is rewriting the top turn for ${actor.name}.`,
  );
  if ('error' in repaired) return { choices: current.choices, note: faults.join(' ') };
  const next = parseTurn(repaired.text, actor, catalog);
  if (!next || 'rejected' in next || !next.choices.length) return { choices: current.choices, note: faults.join(' ') };
  const ranked = rankChoices(next.choices, actor, catalog);
  const still = choiceFaults(ranked[0], actor, catalog);
  return { choices: ranked, note: still[0] };
}

export async function ollamaComment(facts: string[], encounterBlock: string): Promise<{ text: string; modelDown: boolean }> {
  if (facts.length === 0) {
    return { text: 'No sheet veto applies to this turn.', modelDown: false };
  }
  try {
    const response = await fetch('/ollama/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'You comment on a finished Pathfinder 2e enemy turn. Use only the facts given. Do not choose actions. Write two or three sentences. Do not invent numbers.',
          },
          { role: 'user', content: `Facts:\n${facts.map((fact) => `- ${fact}`).join('\n')}\n\nEncounter:\n${encounterBlock}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as { message?: { content?: string } };
    const text = data.message?.content?.trim();
    if (!text) throw new Error('empty');
    return { text, modelDown: false };
  } catch {
    return {
      text: `${facts.join(' ')} The model went away.`,
      modelDown: true,
    };
  }
}

export async function ollamaDesign(sentence: string, encounterBlock: string): Promise<{ line: string; comment: string; modelDown: boolean }> {
  try {
    const response = await fetch('/ollama/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'A GM described an enemy turn. Say if the actions do not add up, or name the catch (multiple attack penalty, Reactive Strike on a retreat, ending fascination). Then propose one rules line. Do not invent numbers that are missing from the encounter block. Reply as JSON {"comment":"...","line":"..."}.',
          },
          { role: 'user', content: `Turn: ${sentence}\n\nEncounter:\n${encounterBlock}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as { message?: { content?: string } };
    const raw = data.message?.content?.trim() ?? '';
    const json = raw.match(/\{[\s\S]*\}/);
    if (!json) throw new Error('no json');
    const parsed = JSON.parse(json[0]) as { comment?: string; line?: string };
    if (!parsed.line) throw new Error('no line');
    return { line: parsed.line, comment: parsed.comment || 'Rules check finished.', modelDown: false };
  } catch {
    return {
      line: sentence,
      comment: 'The rules check did not run.',
      modelDown: true,
    };
  }
}
