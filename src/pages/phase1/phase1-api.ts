import type { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../../supabase-client';

type ApiEnvelope<T> = { status: 'success' | 'fail' | 'error'; data?: T; message?: string };

export async function phase1Request<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    let detail = error.message || 'Request to ' + functionName + ' failed';
    const context = (error as FunctionsHttpError).context;
    if (context) {
      try {
        const payload = await context.clone().json();
        detail = payload?.message || payload?.data?.message || detail;
      } catch {
        // Preserve the SDK message when the response body is not JSON.
      }
    }
    throw new Error(functionName + ': ' + detail);
  }
  const envelope = data as ApiEnvelope<T> | null;
  if (!envelope) throw new Error(functionName + ': empty response');
  if (envelope.status !== 'success') throw new Error(functionName + ': ' + (envelope.message || 'request failed'));
  return envelope.data as T;
}