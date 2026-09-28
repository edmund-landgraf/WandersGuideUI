import { describe, expect, it } from 'vitest';
import { clampDie, diceCheckOverlayTitle, DICE_HIT_SOUNDS, dice3dRollConfig, dice3dThrowsFromCheckLog, dice3dThrowsFromInitiativeRound, placeDiceLabel } from './phase1-dice-3d';

describe('dice3dRollConfig', () => {
  it('maps one predetermined d20 per combatant with distinct shades', () => {
    const config = dice3dRollConfig([
      { name: 'Sister Mirela Voss', die: 2 },
      { name: 'Jacko', die: 7 },
      { name: 'Chilltix Clawfoot', die: 8 },
      { name: 'Old Varla', die: 9 },
      { name: 'Liora Veyne', die: 2 },
      { name: 'RANDOM', die: 18 },
      { name: 'Catman', die: 17 },
    ]);
    expect(config).toHaveLength(7);
    expect(config.every((die) => die.dice === 'd20')).toBe(true);
    expect(config.map((die) => die.rolled)).toEqual([2, 7, 8, 9, 2, 18, 17]);
    const shades = new Set(config.map((die) => die.diceColor));
    expect(shades.size).toBe(7);
  });

  it('keeps dice labels inside the overlay', () => {
    const viewport = { width: 1280, height: 720 };
    const label = { width: 140, height: 22 };
    const right = placeDiceLabel({ x: 1400, y: 40 }, viewport, label);
    expect(right.x + label.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(right.y - label.height / 2).toBeGreaterThanOrEqual(8);
    const left = placeDiceLabel({ x: -40, y: 800 }, viewport, label);
    expect(left.x).toBeGreaterThanOrEqual(8);
    expect(left.y + label.height / 2).toBeLessThanOrEqual(viewport.height - 8);
    const inside = placeDiceLabel({ x: 400, y: 300 }, viewport, label);
    expect(inside).toEqual({ x: 400, y: 300 });
  });

  it('builds overlay throws from a logged initiative round', () => {
    const throws = dice3dThrowsFromInitiativeRound(
      {
        entries: [
          { name: 'Ada', ally: true, calculation: 'd20 (18) + Perception (+4) = 22' },
          { name: 'Mudjaw Lurkbloom (2)', ally: false, calculation: 'd20 (7) = 7' },
          { name: 'Skipped Wolf', ally: true, calculation: 'Skipped' },
        ],
      },
      (entry) => (entry.ally ? entry.name : 'ML (2)'),
    );
    expect(throws).toEqual([
      { name: 'Ada', die: 18 },
      { name: 'ML (2)', die: 7 },
    ]);
  });

  it('titles a shared check overlay as DC vs the skill', () => {
    expect(diceCheckOverlayTitle(17, 'Stealth')).toBe('DC 17 vs Stealth');
    const throws = dice3dThrowsFromCheckLog(
      {
        entries: [
          { name: 'Ada', ally: true, calculation: 'd20 (14) + Stealth (+8) = 22 vs DC 17' },
          { name: 'Mudjaw', ally: false, calculation: 'Skipped' },
        ],
      },
      (entry) => (entry.ally ? entry.name : 'MJ'),
    );
    expect(throws).toEqual([{ name: 'Ada', die: 14 }]);
  });

  it('clamps invalid faces onto a d20', () => {
    expect(clampDie(0)).toBe(1);
    expect(clampDie(21)).toBe(20);
    expect(clampDie(Number.NaN)).toBe(1);
  });

  it('points the MIT collision player at hit clips', () => {
    expect(DICE_HIT_SOUNDS).toEqual([
      '/dice/plastic-1.mp3',
      '/dice/plastic-2.mp3',
      '/dice/plastic-3.mp3',
      '/dice/plastic-4.mp3',
      '/dice/plastic-5.mp3',
      '/dice/plastic-6.mp3',
    ]);
  });
});
