import { afterEach, describe, expect, it, vi } from 'vitest';
import { proposeTurn } from './tactics-ollama';
import type { TacticsCombatant } from './tactics-types';

function enemy(): TacticsCombatant {
  return {
    id: 'nemeia',
    name: 'Nemeia',
    side: 'enemy',
    hpCurrent: 40,
    hpMax: 40,
    ac: 14,
    conditions: [],
    abilities: [
      {
        id: 'spade',
        name: 'Spade',
        actions: 1,
        traits: [],
        description: 'Melee Strike +7, Damage 1d6 piercing.',
        kind: 'strike',
        agile: false,
        concentrate: false,
        concealed: false,
        hidden: false,
        fascinates: false,
      },
    ],
  };
}

function ally(): TacticsCombatant {
  return { ...enemy(), id: 'ada', name: 'Ada', side: 'ally', ac: 18 };
}

function streamReply(content: string) {
  const encoder = new TextEncoder();
  const payload = `${JSON.stringify({ message: { content } })}\n${JSON.stringify({ done: true })}\n`;
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      },
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('proposeTurn', () => {
  it('waits for llama3.1 and uses that turn', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      streamReply(
        JSON.stringify({
          choices: [
            { lines: ['Stride to Ada.', 'Strike Ada with Spade. Attack roll vs AC 18, bonus +7. Damage 1d6 piercing.'], tip: 'One Strike, then movement already spent.', abilityIds: ['spade'] },
            { lines: ['Demoralize Ada.', 'Stride away.', 'Take cover.'], tip: 'Frighten, then leave.', abilityIds: [] },
            { lines: ['Step away from Ada.', 'Strike Ada with Spade. Attack roll vs AC 18.', 'Seek Nemeia.'], tip: 'A short step, then one Strike.', abilityIds: ['spade'] },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const statuses: string[] = [];
    const result = await proposeTurn({
      campaignId: 1,
      encounterId: 2,
      actor: enemy(),
      combatants: [enemy(), ally()],
      spends: [],
      onStatus: (status) => statuses.push(status.detail),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.model).toBe('llama3.1');
    expect(body.stream).toBe(true);
    expect(statuses[0]).toContain('Sent Nemeia');
    expect(statuses.at(-1)).toContain('finished writing');
    expect(result.modelDown).toBe(false);
    expect(result.choices).toHaveLength(3);
    expect(result.choices[0].lines[0]).toContain('Stride');
    expect(result.choices[0].lines.join(' ')).not.toContain('Three Strikes');
    expect(result.choices[0].abilityIds).toEqual(['spade']);
  });

  it('rejects an action that is not on the creature', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamReply(
          JSON.stringify({
            lines: ['Shikigami attempts to merge with its ward using Ward (id -1, 1 action).'],
            tip: 'Concentration DCs are usually the higher of the listed stat and ability modifier.',
            abilityIds: ['-1'],
          }),
        ),
      ),
    );
    const result = await proposeTurn({
      campaignId: 1,
      encounterId: 2,
      actor: { ...enemy(), name: 'Shikigami (1)' },
      combatants: [enemy(), ally()],
      spends: [],
    });
    expect(result.choices).toEqual([]);
    expect(result.comment).toContain('does not have Ward');
    expect(result.comment).toContain('Spade');
  });

  it('keeps a ward merge when the creature description describes it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamReply(
          JSON.stringify({
            lines: ['Shikigami (1) merges with its ward using Ward. One action, concentrate.', 'It stays merged and does not Stride.', 'It does not Strike.'],
            tip: 'Merged, it can sense but cannot move.',
            abilityIds: [],
          }),
        ),
      ),
    );
    const shikigami = {
      ...enemy(),
      name: 'Shikigami (1)',
      description: 'A kami can merge with or emerge from their ward as a single action, which has the concentrate trait.',
    };
    const result = await proposeTurn({
      campaignId: 1,
      encounterId: 2,
      actor: shikigami,
      combatants: [shikigami, ally()],
      spends: [],
    });
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].lines[0]).toContain('using Ward');
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1].body)) as { messages: { content: string }[] };
    expect(body.messages[1].content).toContain('merge with or emerge from their ward');
  });

  it('stores notes locally when the brief does not fit, then asks again', async () => {
    const bulky = enemy();
    bulky.abilities = Array.from({ length: 40 }, (_, index) => ({
      ...bulky.abilities[0],
      id: `ability-${index}`,
      name: `Ability ${index}`,
      description: 'x'.repeat(2000),
    }));
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { messages: { content: string }[] };
      const user = body.messages[1].content;
      if (user.startsWith('Acting:')) {
        return streamReply(
          JSON.stringify({
            choices: [0, 1, 2].map((index) => ({
              lines: [`Strike with Ability ${index} once.`, 'Stride away from Ada.'],
              tip: 'Built from saved notes.',
              abilityIds: [`ability-${index}`],
            })),
          }),
        );
      }
      return streamReply('Kept the numbers from this chunk.');
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await proposeTurn({
      campaignId: 1,
      encounterId: 2,
      actor: bulky,
      combatants: [bulky, ally()],
      spends: [],
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(localStorage.getItem('wgui-tactics-memory:1:2:nemeia')).toContain('Kept the numbers');
    expect(result.choices[0].lines[0]).toBe('Strike with Ability 0 once.');
    expect(result.comment).toBe('Built from saved notes.');
  });
});
