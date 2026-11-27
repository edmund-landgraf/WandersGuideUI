import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { encounterStatusQueryKey, encounterStatusSignature } from './phase1-encounter-status-key';

describe('encounter status query key', () => {
  it('changes after a corrected import with unchanged live HP and UUID', () => {
    const source = { _id: 'coal-1', type: 'CREATURE', data: {
      hp_current: 30, hp_temp: 0, details: { conditions: [] }, level: 2,
      operations: [{ type: 'adjValue', data: { variable: 'AC_BONUS', value: 8 } }],
      meta_data: { calculated_stats: { ac: 18, hp_max: 30 } },
    } };
    const corrected = structuredClone(source);
    corrected.data.operations[0].data.value = 10;
    corrected.data.meta_data.calculated_stats.ac = 20;
    expect(encounterStatusSignature([corrected])).not.toBe(encounterStatusSignature([source]));
    expect(encounterStatusSignature([structuredClone(source)])).toBe(encounterStatusSignature([source]));
  });
});

describe('encounter status query cache', () => {
  it('recalculates changed creature or PC data with stable ids and HP, but reuses unchanged data', async () => {
    const client = new QueryClient();
    const original = [
      { _id: 'coal', type: 'CREATURE', data: { hp_current: 30, level: 2, ac: 18 } },
      { _id: 'pc', type: 'CHARACTER', data: { hp_current: 24, level: 2, ac: 17 } },
    ];
    const calculate = vi.fn(async (rows: typeof original) => rows.map(row => row.data.ac));
    const fetch = (rows: typeof original) => client.fetchQuery({
      queryKey: encounterStatusQueryKey(42, rows),
      queryFn: () => calculate(rows),
      staleTime: Infinity,
    });
    try {
      expect(await fetch(original)).toEqual([18, 17]);
      expect(await fetch(structuredClone(original))).toEqual([18, 17]);
      expect(calculate).toHaveBeenCalledTimes(1);
      const corrected = structuredClone(original);
      corrected[0].data.ac = 20;
      expect(await fetch(corrected)).toEqual([20, 17]);
      const updatedPc = structuredClone(corrected);
      updatedPc[1].data.ac = 19;
      expect(await fetch(updatedPc)).toEqual([20, 19]);
      expect(calculate).toHaveBeenCalledTimes(3);
    } finally { client.clear(); }
  });
  it('includes access and hazard state, but ignores unrelated top-level initiative', () => {
    const source = [{ _id: 'h', type: 'HAZARD', access: { details_revealed: false }, hazard: { level: 2 }, hazard_state: { disabled: false }, initiative: 4 }];
    expect(encounterStatusQueryKey(1, source.map(row => ({ ...row, initiative: 10 })))).toEqual(encounterStatusQueryKey(1, source));
    expect(encounterStatusQueryKey(1, source.map(row => ({ ...row, access: { details_revealed: true } })))).not.toEqual(encounterStatusQueryKey(1, source));
    expect(encounterStatusQueryKey(1, source.map(row => ({ ...row, hazard_state: { disabled: true } })))).not.toEqual(encounterStatusQueryKey(1, source));
    expect(encounterStatusQueryKey(2, source)).not.toEqual(encounterStatusQueryKey(1, source));
  });
});
