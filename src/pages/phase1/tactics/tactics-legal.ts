import type { TacticsAbility, TacticsChoice, TacticsCombatant } from './tactics-types';

type BuiltIn = { name: string; actions: number; note: string };

const BUILT_INS: BuiltIn[] = [
  { name: 'Stride', actions: 1, note: 'Move up to your Speed.' },
  { name: 'Step', actions: 1, note: 'Move 5 feet without triggering reactions from movement.' },
  { name: 'Strike', actions: 1, note: 'One attack with a weapon or unarmed attack listed below. Attack roll vs AC.' },
  { name: 'Seek', actions: 1, note: 'Look for a hidden or undetected creature. This is not an attack and it is not a Grapple.' },
  { name: 'Demoralize', actions: 1, note: 'Intimidation vs Will DC. Does not take a multiple attack penalty.' },
  { name: 'Grapple', actions: 1, note: 'Athletics vs Fortitude DC. Has the attack trait.' },
  { name: 'Trip', actions: 1, note: 'Athletics vs Reflex DC. Has the attack trait.' },
  { name: 'Shove', actions: 1, note: 'Athletics vs Fortitude DC. Has the attack trait.' },
  { name: 'Take Cover', actions: 1, note: 'Gain cover if it is available.' },
  { name: 'Stand', actions: 1, note: 'Stand up from prone.' },
  { name: 'Crawl', actions: 1, note: 'Move 5 feet while prone.' },
  { name: 'Leap', actions: 1, note: 'Jump horizontally or vertically.' },
  { name: 'Ready', actions: 2, note: 'Prepare a reaction.' },
  { name: 'Recall Knowledge', actions: 1, note: 'Skill check to recall a fact.' },
  { name: 'Aid', actions: 1, note: 'Prepare to help an ally.' },
];

export function attacksOf(actor: TacticsCombatant): TacticsAbility[] {
  return actor.abilities.filter((ability) => ability.kind === 'strike');
}

function actionRoster(catalog: TacticsAbility[] | undefined): BuiltIn[] {
  if (!catalog?.length) return BUILT_INS;
  return catalog.map((ability) => ({
    name: ability.name,
    actions: ability.actions,
    note: ability.description.replace(/\s+/g, ' ').slice(0, 140),
  }));
}

export function legalMenu(actor: TacticsCombatant, catalog?: TacticsAbility[]): string {
  const attacks = attacksOf(actor);
  const attackLines = attacks.length
    ? attacks.map((ability) => {
        const bonus = ability.attackBonus == null ? 'bonus not on the sheet' : `bonus ${ability.attackBonus >= 0 ? '+' : ''}${ability.attackBonus}`;
        const damage = ability.damage ? `, damage ${ability.damage}` : '';
        return `- Strike with ${ability.name} (${ability.actions} action${ability.actions === 1 ? '' : 's'}). ${bonus}${damage}. ${ability.description}`;
      }).join('\n')
    : '- This creature has no listed Strike.';
  const specials = actor.abilities
    .filter((ability) => ability.kind !== 'strike')
    .map((ability) => {
      const cost = ability.actionsMax ? `${ability.actions} to ${ability.actionsMax} actions` : `${ability.actions} action${ability.actions === 1 ? '' : 's'}`;
      const frequency = ability.frequency ? ` Frequency: ${ability.frequency}.` : '';
      const uses = ability.usesMax == null ? '' : ` Maximum uses: ${ability.usesMax}.`;
      return `- ${ability.name} (${cost}).${frequency}${uses} ${ability.description}`;
    });
  const built = actionRoster(catalog).map((action) => {
    const cost = action.actions === 0 ? 'free' : `${action.actions} action${action.actions === 1 ? '' : 's'}`;
    return catalog?.length ? `- ${action.name} (${cost}).` : `- ${action.name} (${cost}). ${action.note}`;
  });
  return ['Special abilities on this creature:', ...(specials.length ? specials : ['- none']), '', 'Strikes from this creature:', attackLines, '', 'Actions any creature can take:', ...built].join('\n');
}

function namedAbilities(line: string, actor: TacticsCombatant): TacticsAbility[] {
  const found: TacticsAbility[] = [];
  let rest = line;
  const abilities = [...actor.abilities].sort((left, right) => right.name.length - left.name.length);
  for (const ability of abilities) {
    const pattern = new RegExp(`\\b${ability.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (!pattern.test(rest)) continue;
    found.push(ability);
    rest = rest.replace(pattern, ' ');
  }
  return found;
}

function costOnLine(line: string, ability: TacticsAbility): number {
  if (ability.actionsMax == null) return ability.actions;
  const stated = line.match(/\b([123])[- ]actions?\b/i) ?? line.match(/\b(one|two|three)[- ]actions?\b/i);
  const words: Record<string, number> = { one: 1, two: 2, three: 3 };
  const picked = stated ? words[stated[1].toLowerCase()] ?? Number(stated[1]) : ability.actions;
  if (picked >= ability.actions && picked <= ability.actionsMax) return picked;
  return ability.actions;
}

function mentioned(line: string, catalog?: TacticsAbility[]): BuiltIn[] {
  const roster = [...actionRoster(catalog)].sort((left, right) => right.name.length - left.name.length);
  let rest = line;
  const found: BuiltIn[] = [];
  for (const action of roster) {
    const pattern = new RegExp(`\\b${action.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (!pattern.test(rest)) continue;
    const negated = new RegExp(`\\b(?:does not|do not|don't|cannot|can't)\\s+${action.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (negated.test(line)) continue;
    found.push(action);
    rest = rest.replace(pattern, ' ');
  }
  return found;
}

function weaponOnLine(line: string, attacks: TacticsAbility[]): TacticsAbility | undefined {
  const named = attacks.filter((ability) => line.toLowerCase().includes(ability.name.toLowerCase()));
  if (named.length === 1) return named[0];
  const byDamage = attacks.filter((ability) => ability.damage && line.toLowerCase().includes(ability.damage.toLowerCase()));
  if (byDamage.length === 1) return byDamage[0];
  return named[0] ?? byDamage[0];
}

export function separateActions(lines: string[], actor: TacticsCombatant, catalog?: TacticsAbility[]): string[] {
  const separated: string[] = [];
  for (const line of lines) {
    const marks = [
      ...mentioned(line, catalog).map((action) => ({ name: action.name, index: line.toLowerCase().indexOf(action.name.toLowerCase()) })),
      ...namedAbilities(line, actor).filter((ability) => ability.kind !== 'strike').map((ability) => ({ name: ability.name, index: line.toLowerCase().indexOf(ability.name.toLowerCase()) })),
    ].filter((mark) => mark.index >= 0).sort((left, right) => left.index - right.index || right.name.length - left.name.length);
    const unique = marks.filter((mark, index) => marks.findIndex((item) => item.index === mark.index) === index);
    if (unique.length < 2) {
      separated.push(line);
      continue;
    }
    unique.forEach((mark, index) => {
      const end = unique[index + 1]?.index ?? line.length;
      const piece = line.slice(mark.index, end).replace(/^[,\s]+|[,\s]+$/g, '');
      if (piece) separated.push(piece);
    });
  }
  return separated;
}

export function choiceFaults(choice: TacticsChoice, actor: TacticsCombatant, catalog?: TacticsAbility[]): string[] {
  const faults: string[] = [];
  let spent = 0;
  const attacks = attacksOf(actor);
  const lines = separateActions(choice.lines, actor, catalog);
  for (const line of lines) {
    const specials = namedAbilities(line, actor).filter((ability) => ability.kind !== 'strike');
    const actions = mentioned(line, catalog).filter((action) => !specials.some((ability) => ability.name.toLowerCase() === action.name.toLowerCase()));
    const pieces = specials.length + actions.length;
    if (pieces > 1) {
      faults.push(`"${line}" combines ${[...specials.map((ability) => ability.name), ...actions.map((action) => action.name)].join(' and ')}. Each line is one action.`);
      continue;
    }
    if (specials.length === 1) {
      spent += costOnLine(line, specials[0]);
      continue;
    }
    if (actions.length === 1) {
      const action = actions[0];
      if (action.name === 'Strike') {
        const weapon = weaponOnLine(line, attacks);
        const names = [...new Set(attacks.map((ability) => ability.name))];
        if (!weapon) faults.push(`Strike must name one of: ${names.join(', ') || 'no attack on the sheet'}.`);
        else spent += weapon.actions || 1;
      } else {
        spent += action.actions;
      }
      continue;
    }
    if (/\bmerg(?:e|es|ing)\b/i.test(line) && /ward/i.test(`${line} ${actor.description ?? ''}`)) {
      spent += 1;
      continue;
    }
    faults.push(`"${line}" is not a built-in action or an ability on ${actor.name}.`);
  }
  if (spent > 3) faults.push(`The actions add up to ${spent}, and a turn has 3.`);
  return faults;
}

export function unusedActions(lines: string[], actor: TacticsCombatant, catalog?: TacticsAbility[]): number {
  let spent = 0;
  const attacks = attacksOf(actor);
  for (const line of separateActions(lines, actor, catalog)) {
    const specials = namedAbilities(line, actor).filter((ability) => ability.kind !== 'strike');
    const actions = mentioned(line, catalog).filter((action) => !specials.some((ability) => ability.name.toLowerCase() === action.name.toLowerCase()));
    if (specials.length + actions.length !== 1) continue;
    if (specials.length === 1) spent += costOnLine(line, specials[0]);
    else if (actions[0]?.name === 'Strike') spent += weaponOnLine(line, attacks)?.actions || 1;
    else if (actions[0]) spent += actions[0].actions;
    else if (/\bmerg(?:e|es|ing)\b/i.test(line)) spent += 1;
  }
  return Math.max(0, 3 - spent);
}

const ATTACK_ACTIONS = ['strike', 'grapple', 'trip', 'shove', 'disarm'];

function attackOnLine(line: string, actor: TacticsCombatant, catalog?: TacticsAbility[]): { agile: boolean } | null {
  if (/\bstrike\b/i.test(line)) {
    const weapon = weaponOnLine(line, attacksOf(actor));
    return { agile: Boolean(weapon?.agile) };
  }
  const named = (catalog ?? []).find((ability) => new RegExp(`\\b${ability.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(line) && ability.traits.some((trait) => trait.toLowerCase() === 'attack'));
  if (named) return { agile: named.traits.some((trait) => trait.toLowerCase() === 'agile') || named.agile };
  if (ATTACK_ACTIONS.some((name) => new RegExp(`\\b${name}\\b`, 'i').test(line))) return { agile: false };
  return null;
}

/** Remaster multiple attack penalty: −5 then −10, or −4 then −8 when this attack is agile. */
export function annotatePenalties(lines: string[], actor: TacticsCombatant, catalog?: TacticsAbility[]): string[] {
  let earlierAttacks = 0;
  return lines.map((line) => {
    const attack = attackOnLine(line, actor, catalog);
    if (!attack) return line.replace(/\s*Multiple attack penalty\s*[−-]?\d+\s*(\(agile\))?\./i, '').trim();
    earlierAttacks += 1;
    const cleaned = line.replace(/\s*Multiple attack penalty\s*[−-]?\d+\s*(\(agile\))?\./i, '').replace(/\.\s*$/, '').trim();
    if (earlierAttacks === 1) return cleaned.endsWith('.') ? cleaned : `${cleaned}.`;
    const penalty = earlierAttacks === 2 ? (attack.agile ? -4 : -5) : (attack.agile ? -8 : -10);
    return `${cleaned}. Multiple attack penalty −${Math.abs(penalty)}${attack.agile ? ' (agile)' : ''}.`;
  });
}

export function rankChoices(choices: TacticsChoice[], actor: TacticsCombatant, catalog?: TacticsAbility[]): TacticsChoice[] {
  return [...choices].sort((left, right) => choiceFaults(left, actor, catalog).length - choiceFaults(right, actor, catalog).length);
}
