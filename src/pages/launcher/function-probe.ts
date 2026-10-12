export type Probe = 'pending' | 'up' | 'unconfirmed' | 'down';

/** Green only when the worker itself returned a JSend body. A gateway reply that never reached a worker is unconfirmed. */
export function classifyFunctionProbe(status: number, body: string): Exclude<Probe, 'pending'> {
  if (status === 404 || /function not found|requested function was not found/i.test(body)) return 'down';
  try {
    const payload = JSON.parse(body) as { status?: unknown };
    if (payload?.status === 'success' || payload?.status === 'fail' || payload?.status === 'error') return 'up';
  } catch {
    // Non-JSON means the host answered without running the function.
  }
  return 'unconfirmed';
}
