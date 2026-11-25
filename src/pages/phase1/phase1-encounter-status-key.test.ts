import { describe, expect, it } from 'vitest';
import { encounterStatusSignature } from './phase1-encounter-status-key';

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
