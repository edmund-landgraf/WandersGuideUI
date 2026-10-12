import { describe, expect, it } from 'vitest';
import { classifyFunctionProbe } from './function-probe';

describe('classifyFunctionProbe', () => {
  it('treats a validation envelope as the worker answering', () => {
    const body = JSON.stringify({ status: 'fail', data: { message: 'A campaign_id is required.', code: 'CAMPAIGN_ID_REQUIRED' } });
    expect(classifyFunctionProbe(400, body)).toBe('up');
  });

  it('treats a worker that never started as unconfirmed', () => {
    expect(classifyFunctionProbe(500, '{"msg":"InvalidWorkerCreation: channel closed"}')).toBe('unconfirmed');
  });

  it('treats a missing route as down', () => {
    expect(classifyFunctionProbe(404, 'function not found')).toBe('down');
  });
});
