import type { TacticsAbility, TacticsChoice, TacticsCombatant, TacticsSpend } from './tactics-types';

const MAP = [0, -5, -10];
const AGILE_MAP = [0, -4, -8];

function num(value: number | undefined): string {
  return value == null || Number.isNaN(value) ? '?' : String(value);
}

function living(list: TacticsCombatant[]): TacticsCombatant[] {
  return list.filter((combatant) => combatant.hpCurrent == null || combatant.hpCurrent > 0);
}

function usesLeft(ability: TacticsAbility, actorId: string, spends: TacticsSpend[]): number | undefined {
  if (ability.usesMax == null) return undefined;
  const used = spends.find((spend) => spend.combatantId === actorId && spend.abilityId === ability.id)?.used ?? 0;
  return ability.usesMax - used;
}

function legal(ability: TacticsAbility, actor: TacticsCombatant, all: TacticsCombatant[], spends: TacticsSpend[]): boolean {
  const left = usesLeft(ability, actor.id, spends);
  if (left != null && left <= 0) return false;
  const allies = living(all).filter((combatant) => combatant.side === actor.side && combatant.id !== actor.id);
  const foes = living(all).filter((combatant) => combatant.side !== actor.side);
  if (ability.kind === 'heal') {
    const hurt = [...allies, actor].some((combatant) => combatant.hpMax > 0 && combatant.hpCurrent < combatant.hpMax);
    if (!hurt) return false;
  }
  if (ability.kind === 'buff' || ability.kind === 'aid' || /adjacent/.test(ability.description.toLowerCase())) {
    if (allies.length === 0 && ability.kind !== 'heal') return false;
  }
  if (ability.kind === 'strike' || ability.kind === 'skill' || ability.kind === 'area') {
    if (foes.length === 0 && ability.kind !== 'area') return false;
  }
  return ability.kind !== 'other' || ability.actions > 0;
}

function penalty(actor: TacticsCombatant): number {
  return actor.conditions.reduce((sum, condition) => {
    const name = condition.name.toLowerCase();
    if (name === 'frightened' || name === 'sickened' || name === 'clumsy' || name === 'enfeebled' || name === 'stupefied') {
      return sum + (condition.value ?? 1);
    }
    return sum;
  }, 0);
}

function offGuard(target: TacticsCombatant): boolean {
  return target.conditions.some((condition) => ['off-guard', 'flat-footed', 'prone'].includes(condition.name.toLowerCase()));
}

function strikeLine(ability: TacticsAbility, actor: TacticsCombatant, target: TacticsCombatant, mapIndex: number): string {
  const map = (ability.agile ? AGILE_MAP : MAP)[Math.min(mapIndex, 2)];
  const bonus = ability.attackBonus == null ? undefined : ability.attackBonus - penalty(actor) + map + (offGuard(target) ? 2 : 0);
  const range = ability.rangeFeet ? `Stay within ${ability.name} range, ${ability.rangeFeet} feet. ` : ability.rangeFeet === 0 ? '' : 'Melee reach. ';
  const flat = ability.hidden ? 'They are hidden: flat check DC 11 first. ' : ability.concealed ? 'They are concealed: flat check DC 5 first. ' : '';
  const mods: string[] = [];
  if (map !== 0) mods.push(`multiple attack penalty ${map}`);
  if (offGuard(target)) mods.push('off-guard +2');
  if (penalty(actor)) mods.push(`status penalty −${penalty(actor)}`);
  const bonusText = bonus == null ? '?' : `${bonus > 0 ? '+' : ''}${bonus}`;
  const extra = mods.length ? ` (${mods.join(', ')})` : '';
  const damage = ability.damage ? ` Damage ${ability.damage}.` : '';
  return `Attack ${target.name} with ${ability.name}. ${range}${flat}Attack roll vs AC. Their AC is ${num(target.ac)}. Your bonus is ${bonusText}${extra}.${damage}`;
}

function areaLine(ability: TacticsAbility, actor: TacticsCombatant): string {
  const shape = ability.areaShape && ability.areaFeet ? `${ability.areaFeet}-foot ${ability.areaShape}` : ability.areaShape ?? 'area';
  const save = ability.save ? `${ability.save[0].toUpperCase()}${ability.save.slice(1)} save` : 'Saving throw';
  const dc = ability.dc ?? (actor.level != null ? undefined : undefined);
  const effect = ability.fascinates ? ' Failure: fascinated.' : ability.damage ? ` Damage ${ability.damage}.` : '';
  const end = ability.fascinates
    ? ' A later Strike against a fascinated creature, or against one of their allies, ends fascination even if this creature is mindless.'
    : '';
  return `${ability.name}, ${shape}. ${save} vs your DC ${num(ability.dc ?? dc)}.${effect}${end}`;
}

function skillLine(ability: TacticsAbility, actor: TacticsCombatant, target: TacticsCombatant): string {
  const blob = `${ability.name} ${ability.description}`.toLowerCase();
  const bonus = ability.attackBonus == null ? undefined : ability.attackBonus - penalty(actor);
  const bonusText = bonus == null ? '?' : `${bonus > 0 ? '+' : ''}${bonus}`;
  if (/\bgrapple\b/.test(blob)) {
    return `Grapple ${target.name}. Athletics ${bonusText} vs their Fortitude DC ${num(target.fortitude == null ? undefined : 10 + target.fortitude)}.`;
  }
  if (/\bdemoralize\b/.test(blob)) {
    return `Demoralize ${target.name}. Intimidation ${bonusText} vs their Will DC ${num(target.will == null ? undefined : 10 + target.will)}.`;
  }
  const skill = ability.name;
  const dc = ability.dc ?? (target.will == null ? undefined : 10 + target.will);
  return `${skill} ${target.name}. ${skill} ${bonusText} vs DC ${num(dc)}.`;
}

function rangeHold(ability: TacticsAbility, allies: TacticsCombatant[]): string {
  if (ability.kind === 'buff' || ability.kind === 'aid' || /adjacent/.test(ability.description.toLowerCase())) {
    const ally = allies[0];
    return ally ? `End within 5 feet of ${ally.name}.` : '';
  }
  if (ability.rangeFeet) return `Stay within ${ability.rangeFeet} feet.`;
  return '';
}

type Script = { parts: string[]; score: number; tip: string; abilityIds: string[]; actions: number };

function push(scripts: Script[], script: Script) {
  if (script.actions <= 0 || script.actions > 3) return;
  if (scripts.some((item) => item.parts.join('|') === script.parts.join('|'))) return;
  scripts.push(script);
}

export function composeTurns(actor: TacticsCombatant, all: TacticsCombatant[], spends: TacticsSpend[]): TacticsChoice[] {
  const abilities = actor.abilities.filter((ability) => legal(ability, actor, all, spends));
  const foes = living(all).filter((combatant) => combatant.side !== actor.side);
  const allies = living(all).filter((combatant) => combatant.side === actor.side && combatant.id !== actor.id);
  const scripts: Script[] = [];
  const cluster = foes.length >= 2;

  for (const ability of abilities) {
    if (ability.kind === 'area') {
      const score = 40 + (cluster ? 25 : 0) + (ability.fascinates ? 8 : 0) - (ability.actions > 2 ? 4 : 0);
      push(scripts, {
        parts: [areaLine(ability, actor)],
        score,
        tip: cluster ? 'The area is built to catch several creatures.' : 'The area stays legal even against one creature.',
        abilityIds: [ability.id],
        actions: ability.actions,
      });
    }
    if (ability.kind === 'heal') {
      const patient = [...allies, actor].filter((c) => c.hpMax > 0 && c.hpCurrent < c.hpMax).sort((a, b) => a.hpCurrent / a.hpMax - b.hpCurrent / b.hpMax)[0];
      if (!patient) continue;
      const ratio = patient.hpCurrent / Math.max(1, patient.hpMax);
      const scratch = ratio > 0.85;
      push(scripts, {
        parts: [`Heal ${patient.name} with ${ability.name}. ${rangeHold(ability, allies)}`.trim()],
        score: scratch && cluster ? 8 : ratio < 0.35 ? 55 : 28,
        tip: scratch && cluster ? 'Healing a scratch while a cluster is standing in an area ranks low.' : 'An ally is below maximum hit points.',
        abilityIds: [ability.id],
        actions: ability.actions,
      });
    }
    if (ability.kind === 'buff' || ability.kind === 'aid') {
      const pays = /strike|attack|damage|off-guard|bonus/.test(ability.description.toLowerCase());
      push(scripts, {
        parts: [`${ability.name}. ${rangeHold(ability, allies)}`.trim()],
        score: pays ? 36 : 14,
        tip: pays ? 'The block pays off for staying next to that ally.' : 'Aid or a buff with nothing on the block that benefits ranks low.',
        abilityIds: [ability.id],
        actions: ability.actions,
      });
    }
    if (ability.kind === 'strike') {
      for (const target of foes) {
        const lines = [1, 2, 3].map((count) => {
          const bits = Array.from({ length: count }, (_, index) => strikeLine(ability, actor, target, index));
          const finished = target.hpMax > 0 && target.hpCurrent / target.hpMax <= 0.25;
          const third = count === 3;
          return {
            parts: bits,
            score: 30 - (count - 1) * 12 + (offGuard(target) ? 6 : 0) + (finished && third ? 10 : third ? -8 : 0),
            tip: third && !finished ? 'A third Strike takes the full multiple attack penalty and ranks near the bottom.' : offGuard(target) ? 'The target is off-guard.' : 'A Strike stays legal for each living player character.',
            abilityIds: Array.from({ length: count }, () => ability.id),
            actions: ability.actions * count,
          };
        });
        for (const line of lines) push(scripts, line);
        if (allies.length && ability.actions === 1) {
          push(scripts, {
            parts: [`Stride next to ${allies[0].name}, then ${strikeLine(ability, actor, target, 0)}`],
            score: /adjacent/.test(actor.abilities.map((item) => item.description).join(' ').toLowerCase()) ? 34 : 22,
            tip: 'Stride next to the other enemy, then Strike, only outranks a lone Strike when the block pays for that adjacency.',
            abilityIds: [ability.id],
            actions: 2,
          });
        }
      }
    }
    if (ability.kind === 'skill') {
      for (const target of foes) {
        push(scripts, {
          parts: [skillLine(ability, actor, target)],
          score: 26,
          tip: 'The check names both sides.',
          abilityIds: [ability.id],
          actions: ability.actions,
        });
      }
    }
  }

  const strike = abilities.find((ability) => ability.kind === 'strike');
  const area = abilities.find((ability) => ability.kind === 'area');
  if (area && strike && foes[0] && area.actions + strike.actions <= 3) {
    push(scripts, {
      parts: [areaLine(area, actor), strikeLine(strike, actor, foes[0], 0)],
      score: area.fascinates ? 18 : 24,
      tip: area.fascinates
        ? 'Cloud then Strike ends fascination. Cloud-then-wait keeps the condition the creature just applied.'
        : 'Area, then a Strike.',
      abilityIds: [area.id, strike.id],
      actions: area.actions + strike.actions,
    });
    if (area.fascinates && area.actions < 3) {
      push(scripts, {
        parts: [areaLine(area, actor), 'Wait. Do not Strike, or fascination ends.'],
        score: 48,
        tip: 'A later Strike by this creature on a fascinated player character ends fascination. Waiting keeps the condition.',
        abilityIds: [area.id],
        actions: 3,
      });
    }
  }

  return scripts
    .sort((a, b) => b.score - a.score || a.parts[0].localeCompare(b.parts[0]))
    .slice(0, 8)
    .map((script, index) => ({
      id: `${actor.id}-${index}`,
      text: script.parts.join(' '),
      score: script.score,
      tip: script.tip,
      abilityIds: script.abilityIds,
      source: 'menu' as const,
    }));
}

export function sheetVetoReasons(actor: TacticsCombatant, all: TacticsCombatant[], choices: TacticsChoice[]): string[] {
  const reasons: string[] = [];
  const persistent = actor.conditions.find((condition) => /persistent/.test(condition.name.toLowerCase()));
  if (persistent) reasons.push(`Persistent ${persistent.name} comes before offense.`);
  const heavy = actor.conditions.find((condition) => {
    const name = condition.name.toLowerCase();
    return (name === 'frightened' || name === 'sickened') && (condition.value ?? 0) >= 2;
  });
  if (heavy) reasons.push(`${heavy.name} ${heavy.value} or higher comes before a ranked attack.`);
  const allies = living(all).filter((combatant) => combatant.side === actor.side && combatant.id !== actor.id);
  const critical = allies.find((combatant) => combatant.hpMax > 0 && combatant.hpCurrent / combatant.hpMax < 0.35);
  const font = actor.abilities.some((ability) => ability.kind === 'heal');
  if (critical && font) reasons.push(`${critical.name} is critical. Heal-font triage comes before a ranked attack.`);
  const staff = actor.abilities.some((ability) => /staff/.test(ability.name.toLowerCase()) && ability.kind !== 'strike');
  const staffStrike = choices.some((choice) => /staff/i.test(choice.text) && /Attack roll/.test(choice.text));
  if (staff && staffStrike) reasons.push('Cast from the staff before a staff Strike.');
  const third = choices.find((choice) => (choice.text.match(/Attack roll/g) ?? []).length >= 3);
  const nearly = living(all).some((combatant) => combatant.side !== actor.side && combatant.hpMax > 0 && combatant.hpCurrent / combatant.hpMax <= 0.25);
  if (third && !nearly) reasons.push('Do not take a third Strike unless the target is nearly finished.');
  const top = choices[0];
  const openActions = top ? 3 - Math.min(3, (top.text.match(/Attack roll|save vs|Stride|Heal /g) ?? []).length) : 0;
  if (openActions > 0 && actor.abilities.some((ability) => ability.actions === 1 && ability.kind === 'strike')) {
    reasons.push('Do not end the turn while a useful action remains.');
  }
  return reasons;
}
