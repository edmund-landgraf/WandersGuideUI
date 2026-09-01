import { describe, expect, it } from 'vitest';
import { getCommonLog } from '@utils/common-log';
import { executeOperations } from './operations.main';

describe('executeOperations rejection', () => {
  it('logs unknown execution types to the common log then rethrows', async () => {
    await expect(executeOperations({ type: 'UNKNOWN' } as never)).rejects.toThrow('Unknown operation execution type');
    expect(getCommonLog().at(-1)).toMatchObject({
      source: 'operations',
      message: 'Unknown operation execution type',
    });
  });
});
